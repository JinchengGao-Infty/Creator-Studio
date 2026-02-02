fn main() {
    ensure_ai_engine_sidecar();
    tauri_build::build()
}

fn ensure_ai_engine_sidecar() {
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default());
    let target = std::env::var("TARGET").unwrap_or_default();
    if manifest_dir.as_os_str().is_empty() || target.trim().is_empty() {
        return;
    }

    let is_windows = target.contains("windows");
    let exe_suffix = if is_windows { ".exe" } else { "" };
    let out_path = manifest_dir
        .join("bin")
        .join(format!("ai-engine-{target}{exe_suffix}"));

    if out_path.exists() {
        return;
    }

    let repo_root = manifest_dir.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    if repo_root.as_os_str().is_empty() {
        return;
    }
    let ai_engine_dir = repo_root.join("packages").join("ai-engine");
    if !ai_engine_dir.exists() {
        return;
    }

    let _ = std::fs::create_dir_all(out_path.parent().unwrap_or(&manifest_dir));

    // Install deps (once) + compile standalone sidecar binary via Bun.
    // This avoids relying on the repo layout at runtime for packaged builds.
    let install = Command::new("bun")
        .arg("install")
        .arg("--frozen-lockfile")
        .current_dir(&ai_engine_dir)
        .status();
    if let Ok(status) = install {
        if !status.success() {
            println!(
                "cargo:warning=Failed to run bun install for ai-engine (status={status}). AI features may not work."
            );
        }
    } else {
        println!("cargo:warning=Failed to spawn bun. AI features may not work.");
        return;
    }

    let build = Command::new("bun")
        .arg("build")
        .arg("src/cli.ts")
        .arg("--compile")
        .arg("--outfile")
        .arg(&out_path)
        .current_dir(&ai_engine_dir)
        .status();

    match build {
        Ok(status) if status.success() => {}
        Ok(status) => println!(
            "cargo:warning=Failed to compile ai-engine sidecar (status={status}). AI features may not work."
        ),
        Err(err) => println!(
            "cargo:warning=Failed to spawn bun build for ai-engine ({err}). AI features may not work."
        ),
    }
}
