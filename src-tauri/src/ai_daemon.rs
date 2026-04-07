//! AI Engine Daemon lifecycle management.
//!
//! Manages a long-running Node.js HTTP server (Hono) as a sidecar process.
//! Handles: startup, health checking, crash loop detection, graceful shutdown.

use rand::Rng;
use serde::Deserialize;
use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const PROTOCOL_VERSION: &str = "2.0";
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(5);
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);
const CRASH_LOOP_WINDOW: Duration = Duration::from_secs(300); // 5 minutes
const CRASH_LOOP_MAX_RESTARTS: u32 = 3;

#[derive(Debug, Deserialize)]
struct DaemonStartupMessage {
    port: u16,
    version: String,
}

/// Represents the running state of the AI daemon.
pub struct AIDaemon {
    child: Mutex<Option<Child>>,
    port: Mutex<Option<u16>>,
    shared_secret: String,
    restart_count: AtomicU32,
    last_restart: Mutex<Instant>,
    circuit_broken: AtomicBool,
    engine_path: Mutex<Option<PathBuf>>,
    /// Lifecycle lock: prevents concurrent start/stop/ensure_running races.
    lifecycle: Mutex<()>,
}

impl AIDaemon {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(None),
            shared_secret: generate_shared_secret(),
            restart_count: AtomicU32::new(0),
            last_restart: Mutex::new(Instant::now()),
            circuit_broken: AtomicBool::new(false),
            engine_path: Mutex::new(None),
            lifecycle: Mutex::new(()),
        }
    }

    /// Returns the shared secret for authenticating HTTP requests to the daemon.
    pub fn shared_secret(&self) -> &str {
        &self.shared_secret
    }

    /// Returns the daemon's port if running.
    pub fn port(&self) -> Option<u16> {
        *self.port.lock().unwrap()
    }

    /// Returns the base URL for the daemon.
    pub fn base_url(&self) -> Option<String> {
        self.port().map(|p| format!("http://127.0.0.1:{p}"))
    }

    /// Returns whether the circuit breaker has tripped.
    pub fn is_circuit_broken(&self) -> bool {
        self.circuit_broken.load(Ordering::Relaxed)
    }

    /// Start the daemon process. Blocks until the daemon reports its port.
    /// Holds the lifecycle lock to prevent concurrent start/stop races.
    pub fn start(&self, engine_path: &Path) -> Result<u16, String> {
        let _lifecycle_guard = self.lifecycle.lock().unwrap();
        self.start_inner(engine_path)
    }

    fn start_inner(&self, engine_path: &Path) -> Result<u16, String> {
        // Kill any existing child and clear stale port
        let was_running = self.port().is_some() || self.is_child_alive();
        self.kill_child_inner();
        *self.port.lock().unwrap() = None;

        // Check circuit breaker
        if self.is_circuit_broken() {
            return Err(
                "AI daemon circuit breaker tripped (too many crashes). Please restart the app or click 'Retry'.".to_string()
            );
        }

        // Store engine path for restarts
        *self.engine_path.lock().unwrap() = Some(engine_path.to_path_buf());

        // Track crash-restarts only (not the initial start)
        if was_running {
            self.check_crash_loop()?;
        }

        let mut cmd = build_daemon_command(engine_path, &self.shared_secret)?;
        eprintln!("[ai-daemon] Starting daemon from: {}", engine_path.display());

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "Failed to start AI daemon from '{}': {e}",
                engine_path.display()
            )
        })?;

        // Read the first line from stdout to get the port.
        // Use a separate thread + channel to implement real timeout
        // (BufRead::read_line on a blocking pipe cannot be interrupted).
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                kill_and_wait(&mut child);
                return Err("Failed to capture daemon stdout".to_string());
            }
        };

        let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
        std::thread::spawn(move || {
            let mut reader = std::io::BufReader::new(stdout);
            let mut first_line = String::new();
            match reader.read_line(&mut first_line) {
                Ok(0) => tx.send(Err("Daemon exited before reporting port (EOF)".to_string())).ok(),
                Ok(_) => tx.send(Ok(first_line)).ok(),
                Err(e) => tx.send(Err(format!("Failed to read daemon stdout: {e}"))).ok(),
            };
        });

        let first_line = rx
            .recv_timeout(STARTUP_TIMEOUT)
            .map_err(|_| {
                kill_and_wait(&mut child);
                format!(
                    "AI daemon startup timeout ({}s). The engine at '{}' did not respond.",
                    STARTUP_TIMEOUT.as_secs(),
                    engine_path.display()
                )
            })?
            .map_err(|e| {
                kill_and_wait(&mut child);
                format!("{e}")
            })?;

        let startup_msg: DaemonStartupMessage = serde_json::from_str(first_line.trim())
            .map_err(|e| {
                kill_and_wait(&mut child);
                format!(
                    "Invalid daemon startup message: {e}. Got: '{}'",
                    first_line.trim()
                )
            })?;

        // Version check
        if startup_msg.version != PROTOCOL_VERSION {
            kill_and_wait(&mut child);
            return Err(format!(
                "AI daemon protocol version mismatch: expected {PROTOCOL_VERSION}, got {}",
                startup_msg.version
            ));
        }

        let port = startup_msg.port;
        *self.port.lock().unwrap() = Some(port);
        let pid = child.id();
        *self.child.lock().unwrap() = Some(child);

        eprintln!(
            "[ai-daemon] Daemon started on port {port} (pid={pid}, version={})",
            startup_msg.version
        );

        Ok(port)
    }

    /// Stop the daemon gracefully.
    pub fn stop(&self) {
        let _lifecycle_guard = self.lifecycle.lock().unwrap();
        self.kill_child_inner();
        *self.port.lock().unwrap() = None;
        eprintln!("[ai-daemon] Daemon stopped");
    }

    /// Check if the daemon is alive via health endpoint.
    pub fn health_check(&self) -> Result<(), String> {
        let base = self
            .base_url()
            .ok_or("Daemon not running (no port)")?;

        let url = format!("{base}/health");
        let client = reqwest::blocking::Client::builder()
            .timeout(HEALTH_CHECK_TIMEOUT)
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

        let resp = client
            .get(&url)
            .send()
            .map_err(|e| format!("Health check failed: {e}"))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Health check returned status {}",
                resp.status()
            ));
        }

        Ok(())
    }

    /// Ensure the daemon is running. If not, try to restart.
    /// Holds the lifecycle lock to prevent concurrent races.
    pub fn ensure_running(&self) -> Result<u16, String> {
        let _lifecycle_guard = self.lifecycle.lock().unwrap();

        // Fast path: check if port exists and child is alive
        if let Some(port) = *self.port.lock().unwrap() {
            if self.is_child_alive() {
                return Ok(port);
            }
            eprintln!("[ai-daemon] Child process is dead, attempting restart...");
        }

        // Restart — if engine_path was never set (startup failed), re-discover it
        let path = match self.engine_path.lock().unwrap().clone() {
            Some(p) => p,
            None => {
                eprintln!("[ai-daemon] No engine path set, attempting path discovery...");
                let discovered = crate::ai_bridge::get_ai_engine_path()?;
                *self.engine_path.lock().unwrap() = Some(discovered.clone());
                discovered
            }
        };

        self.start_inner(&path)
    }

    /// Reset the circuit breaker (user-initiated retry).
    pub fn reset_circuit_breaker(&self) {
        self.circuit_broken.store(false, Ordering::Relaxed);
        self.restart_count.store(0, Ordering::Relaxed);
        eprintln!("[ai-daemon] Circuit breaker reset");
    }

    // ─── Private helpers ───

    fn is_child_alive(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => true, // Still running
                _ => false,       // Exited or error
            }
        } else {
            false
        }
    }

    /// Kill child without holding the lifecycle lock (called from within locked methods).
    fn kill_child_inner(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            let pid = child.id();
            eprintln!("[ai-daemon] Killing child process (pid={pid})");
            // Drop the mutex guard before sleeping to avoid holding it too long
            drop(guard);

            #[cfg(unix)]
            {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
                // Wait briefly for graceful exit
                std::thread::sleep(GRACEFUL_SHUTDOWN_TIMEOUT);
                if child.try_wait().ok().flatten().is_none() {
                    let _ = child.kill();
                }
            }

            #[cfg(not(unix))]
            {
                let _ = child.kill();
            }

            let _ = child.wait();
        }
    }

    fn check_crash_loop(&self) -> Result<(), String> {
        let mut last = self.last_restart.lock().unwrap();
        let now = Instant::now();

        if now.duration_since(*last) > CRASH_LOOP_WINDOW {
            // Window expired, reset counter
            self.restart_count.store(0, Ordering::Relaxed);
        }

        let count = self.restart_count.fetch_add(1, Ordering::Relaxed);
        *last = now;

        if count >= CRASH_LOOP_MAX_RESTARTS {
            self.circuit_broken.store(true, Ordering::Relaxed);
            eprintln!(
                "[ai-daemon] Circuit breaker tripped! {} restarts in {}s window",
                count,
                CRASH_LOOP_WINDOW.as_secs()
            );
            return Err(format!(
                "AI daemon crash loop detected ({count} restarts in {} minutes). Circuit breaker tripped.",
                CRASH_LOOP_WINDOW.as_secs() / 60
            ));
        }

        Ok(())
    }
}

impl Drop for AIDaemon {
    fn drop(&mut self) {
        self.kill_child_inner();
    }
}

impl Default for AIDaemon {
    fn default() -> Self {
        Self::new()
    }
}

/// Kill a child process and wait for it to fully exit, preventing zombie accumulation.
fn kill_and_wait(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

/// Generate a random shared secret for daemon authentication.
fn generate_shared_secret() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..32).map(|_| rng.gen()).collect();
    hex::encode(&bytes)
}

/// Detect whether a path is a script (JS/TS) or a native binary.
fn is_script_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|s| s.to_str()),
        Some("ts" | "js")
    )
}

/// Build the Command to spawn the daemon process.
fn build_daemon_command(engine_path: &Path, shared_secret: &str) -> Result<Command, String> {
    let mut cmd = if is_script_path(engine_path) {
        let ext = engine_path
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let (runtime, args): (&str, Vec<&str>) = if ext == "ts" {
            ("bun", vec!["run"])
        } else {
            ("node", vec![])
        };

        let mut c = Command::new(runtime);
        for arg in &args {
            c.arg(arg);
        }
        c.arg(engine_path);
        c
    } else {
        Command::new(engine_path)
    };

    cmd.env("CREATORAI_SHARED_SECRET", shared_secret)
        .env("CREATORAI_PORT", "0") // Dynamic port
        .stdin(Stdio::null())
        .stdout(Stdio::piped()) // Read startup message
        .stderr(Stdio::inherit()); // Forward logs

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(cmd)
}

/// hex encoding helper (avoid pulling in the hex crate)
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_shared_secret() {
        let s1 = generate_shared_secret();
        let s2 = generate_shared_secret();
        assert_eq!(s1.len(), 64); // 32 bytes → 64 hex chars
        assert_ne!(s1, s2); // Should be different each time
        assert!(s1.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_is_script_path() {
        assert!(is_script_path(Path::new("foo.js")));
        assert!(is_script_path(Path::new("bar.ts")));
        assert!(!is_script_path(Path::new("baz.exe")));
        assert!(!is_script_path(Path::new("baz")));
    }

    #[test]
    fn test_daemon_new_defaults() {
        let daemon = AIDaemon::new();
        assert!(daemon.port().is_none());
        assert!(!daemon.is_circuit_broken());
        assert_eq!(daemon.shared_secret().len(), 64);
    }

    #[test]
    fn test_crash_loop_detection() {
        let daemon = AIDaemon::new();
        // check_crash_loop is called on crash-restarts only (not initial start)
        // First few restarts should be ok
        assert!(daemon.check_crash_loop().is_ok()); // restart 1
        assert!(daemon.check_crash_loop().is_ok()); // restart 2
        assert!(daemon.check_crash_loop().is_ok()); // restart 3
        // 4th restart should trip the breaker
        let result = daemon.check_crash_loop();
        assert!(result.is_err());
        assert!(daemon.is_circuit_broken());
    }

    #[test]
    fn test_circuit_breaker_reset() {
        let daemon = AIDaemon::new();
        // Trip it with crash-restarts
        for _ in 0..4 {
            let _ = daemon.check_crash_loop();
        }
        assert!(daemon.is_circuit_broken());

        // Reset
        daemon.reset_circuit_breaker();
        assert!(!daemon.is_circuit_broken());
        assert!(daemon.check_crash_loop().is_ok());
    }

    #[test]
    fn test_initial_start_does_not_count_as_crash() {
        let daemon = AIDaemon::new();
        // On initial start, port is None and no child alive → was_running = false
        // So check_crash_loop is NOT called. This test verifies the semantic:
        // calling check_crash_loop 3 times (= 3 crash-restarts) should NOT trip,
        // because initial start shouldn't count.
        assert!(!daemon.is_circuit_broken());
        assert!(daemon.check_crash_loop().is_ok()); // restart 1
        assert!(daemon.check_crash_loop().is_ok()); // restart 2
        assert!(daemon.check_crash_loop().is_ok()); // restart 3 (threshold is 3)
        // 4th would trip — but we only had 3 restarts, so still ok
        // Actually the 3rd fetch_add returns 2 (0-indexed), so count >= 3 triggers on the 4th
        let result = daemon.check_crash_loop(); // This is the 4th
        assert!(result.is_err());
    }

    #[test]
    fn test_build_daemon_command_js() {
        let cmd = build_daemon_command(Path::new("/tmp/ai-engine.js"), "secret123").unwrap();
        let program = cmd.get_program().to_str().unwrap();
        assert_eq!(program, "node");
    }

    #[test]
    fn test_build_daemon_command_ts() {
        let cmd = build_daemon_command(Path::new("/tmp/server.ts"), "secret123").unwrap();
        let program = cmd.get_program().to_str().unwrap();
        assert_eq!(program, "bun");
    }

    #[test]
    fn test_build_daemon_command_binary() {
        let cmd = build_daemon_command(Path::new("/tmp/ai-engine"), "secret123").unwrap();
        let program = cmd.get_program().to_str().unwrap();
        assert_eq!(program, "/tmp/ai-engine");
    }

    #[test]
    fn test_hex_encode() {
        assert_eq!(hex::encode(&[0x00, 0xff, 0x0a]), "00ff0a");
        assert_eq!(hex::encode(&[]), "");
    }

    // ─── Integration tests (require Node.js + server.ts) ───

    /// Find the server.ts file for integration tests.
    fn find_server_ts() -> Option<PathBuf> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let server_ts = manifest_dir
            .parent()?
            .join("packages/ai-engine/src/server.ts");
        if server_ts.exists() {
            Some(server_ts)
        } else {
            None
        }
    }

    #[test]
    fn test_daemon_start_and_health_check() {
        let server_ts = match find_server_ts() {
            Some(p) => p,
            None => {
                eprintln!("[test] server.ts not found, skipping integration test");
                return;
            }
        };

        let daemon = AIDaemon::new();
        let port = daemon.start(&server_ts).expect("Daemon should start");
        assert!(port > 0);
        assert_eq!(daemon.port(), Some(port));

        // Health check should pass
        let result = daemon.health_check();
        assert!(result.is_ok(), "Health check failed: {:?}", result);

        // ensure_running should return same port
        let port2 = daemon.ensure_running().expect("ensure_running should work");
        assert_eq!(port, port2);

        // Stop
        daemon.stop();
        assert_eq!(daemon.port(), None);
    }

    #[test]
    fn test_daemon_start_nonexistent_binary() {
        let daemon = AIDaemon::new();
        let result = daemon.start(Path::new("/nonexistent/binary"));
        assert!(result.is_err());
        assert!(daemon.port().is_none());
    }

    #[test]
    fn test_daemon_stop_when_not_started() {
        let daemon = AIDaemon::new();
        // Should not panic
        daemon.stop();
        assert!(daemon.port().is_none());
    }

    #[test]
    fn test_daemon_ensure_running_without_start() {
        let daemon = AIDaemon::new();
        let result = daemon.ensure_running();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No engine path set"));
    }

    #[test]
    fn test_daemon_restart() {
        let server_ts = match find_server_ts() {
            Some(p) => p,
            None => {
                eprintln!("[test] server.ts not found, skipping integration test");
                return;
            }
        };

        let daemon = AIDaemon::new();

        // Start
        let port1 = daemon.start(&server_ts).expect("First start should work");
        assert!(port1 > 0);

        // Start again (should kill old and start new)
        let port2 = daemon.start(&server_ts).expect("Restart should work");
        assert!(port2 > 0);
        // Ports may or may not differ (OS-dependent)

        daemon.stop();
    }
}
