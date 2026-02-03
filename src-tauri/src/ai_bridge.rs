use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::file_ops::{append, list, read, search, write};
use crate::project::ChapterIndex;
use crate::session::{SessionMode, ToolCall, ToolCallStatus};
use crate::{rag, security::validate_path, summary};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallStartEvent {
    pub id: String,
    pub name: String,
    pub args: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallEndEvent {
    pub id: String,
    pub result: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct ChatEventHandler {
    pub on_tool_call_start: Arc<dyn Fn(ToolCallStartEvent) + Send + Sync>,
    pub on_tool_call_end: Arc<dyn Fn(ToolCallEndEvent) + Send + Sync>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub provider: Value,
    pub parameters: Value,
    pub system_prompt: String,
    pub messages: Vec<Value>,
    pub project_dir: String,
    pub mode: SessionMode,
    pub chapter_id: Option<String>,
    pub allow_write: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
}

fn chat_timeout() -> Duration {
    const DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
    let raw = std::env::var("CREATORAI_AI_CHAT_TIMEOUT_MS").ok();
    match raw
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u64>().ok())
    {
        Some(ms) if ms > 0 => Duration::from_millis(ms),
        _ => Duration::from_millis(DEFAULT_TIMEOUT_MS),
    }
}

fn dev_repo_root_dir() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.to_path_buf())
}

fn current_exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
}

fn find_ai_engine_in_dir(dir: &Path) -> Option<PathBuf> {
    let direct_names = if cfg!(windows) {
        vec!["ai-engine.exe".to_string(), "ai-engine".to_string()]
    } else {
        vec!["ai-engine".to_string()]
    };

    for name in direct_names {
        let p = dir.join(&name);
        if p.exists() {
            return Some(p);
        }
    }

    // Tauri may rename external binaries with a target triple suffix; best-effort scan.
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if name.starts_with("ai-engine") && path.is_file() {
            return Some(path);
        }
    }
    None
}

fn find_bundled_ai_engine() -> Option<PathBuf> {
    let exe_dir = current_exe_dir()?;
    let candidates = [
        exe_dir.clone(),
        exe_dir.join("../Resources"),
        exe_dir.join("../Resources/bin"),
        exe_dir.join("../MacOS"),
        exe_dir.join("../bin"),
    ];
    for dir in candidates {
        if let Some(found) = find_ai_engine_in_dir(&dir) {
            return Some(found);
        }
    }
    None
}

fn find_dev_sidecar_ai_engine() -> Option<PathBuf> {
    let root = dev_repo_root_dir()?;
    let dir = root.join("src-tauri/bin");
    if !dir.exists() {
        return None;
    }
    find_ai_engine_in_dir(&dir)
}

fn get_ai_engine_path() -> Result<PathBuf, String> {
    let mut override_error: Option<String> = None;
    if let Ok(raw) = std::env::var("CREATORAI_AI_ENGINE_CLI_PATH") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            let resolved = if candidate.is_absolute() {
                candidate
            } else {
                dev_repo_root_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(candidate)
            };
            if !resolved.exists() {
                override_error = Some(format!(
                    "ai-engine CLI override not found: {}",
                    resolved.display()
                ));
            } else {
                return Ok(resolved);
            }
        }
    }

    if let Some(path) = find_bundled_ai_engine() {
        return Ok(path);
    }

    if let Some(path) = find_dev_sidecar_ai_engine() {
        return Ok(path);
    }

    if let Some(root) = dev_repo_root_dir() {
        let ai_engine_path = root.join("packages/ai-engine/src/cli.ts");
        if ai_engine_path.exists() {
            return Ok(ai_engine_path);
        }
    }

    let mut message =
        "ai-engine CLI not found. If you're running a packaged build, reinstall/update the app. If you're running from source, ensure `packages/ai-engine/src/cli.ts` exists, or run `npm run ai-engine:build`, or set `CREATORAI_AI_ENGINE_CLI_PATH`."
            .to_string();
    if let Some(prefix) = override_error {
        message = format!("{prefix}\n\n{message}");
    }
    Err(message)
}

fn is_script_path(path: &Path) -> bool {
    matches!(path.extension().and_then(|s| s.to_str()), Some("ts" | "js"))
}

fn spawn_ai_engine(path: &Path) -> Result<std::process::Child, String> {
    let mut cmd = if is_script_path(path) {
        let mut c = Command::new("bun");
        c.arg("run").arg(path);

        // For script execution, keep a stable cwd (prefer repo root when available).
        if let Some(root) = dev_repo_root_dir().filter(|p| p.exists()) {
            c.current_dir(root);
        } else if let Some(parent) = path.parent() {
            c.current_dir(parent);
        }
        c
    } else {
        Command::new(path)
    };

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| {
            if is_script_path(path) && matches!(e.kind(), std::io::ErrorKind::NotFound) {
                return format!(
                    "Failed to spawn ai-engine: {e}. `bun` is required to run `{}`. Install Bun or build the bundled sidecar via `npm run ai-engine:build`.",
                    path.display()
                );
            }
            format!("Failed to spawn ai-engine: {e}")
        })
}

fn format_tool_runs(runs: &[ToolCall]) -> String {
    let mut out = String::new();
    for run in runs {
        let args_json = serde_json::to_string(&run.args).unwrap_or_else(|_| "{}".to_string());
        out.push_str(&format!("[tool] {}\n", run.name));
        out.push_str(&format!("id: {}\n", run.id));
        out.push_str(&format!("args: {args_json}\n"));
        if let Some(value) = &run.result {
            out.push_str(&format!("result: {value}\n\n"));
        } else if let Some(err) = &run.error {
            out.push_str(&format!("error: {err}\n\n"));
        }
    }
    out.trim_end().to_string()
}

pub fn fetch_models(
    provider_type: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let ai_engine_path = get_ai_engine_path()?;

    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

    let request = json!({
        "type": "fetch_models",
        "providerType": provider_type,
        "baseURL": base_url,
        "apiKey": api_key,
    });

    writeln!(stdin, "{}", request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    drop(stdin);

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("Failed to read from stdout: {e}"))?;

    let response: Value = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;

    match response["type"].as_str() {
        Some("models") => {
            let models = response["models"]
                .as_array()
                .ok_or("Invalid models format")?
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>();
            let _ = child.wait();
            Ok(models)
        }
        Some("error") => {
            let _ = child.wait();
            Err(response["message"].as_str().unwrap_or("Unknown error").to_string())
        }
        _ => {
            let _ = child.wait();
            Err(format!("Unknown response: {line}"))
        }
    }
}

pub fn generate_compact_summary(
    provider: Value,
    parameters: Value,
    messages: Vec<Value>,
) -> Result<String, String> {
    let ai_engine_path = get_ai_engine_path()?;

    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

    let request = json!({
        "type": "compact",
        "provider": provider,
        "parameters": parameters,
        "messages": messages,
    });

    writeln!(stdin, "{}", request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    stdin
        .flush()
        .map_err(|e| format!("Failed to flush stdin: {e}"))?;
    drop(stdin);

    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| format!("Failed to read from stdout: {e}"))?;

    let response: Value = serde_json::from_str(&line)
        .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;

    match response["type"].as_str() {
        Some("compact_summary") => {
            let content = response["content"].as_str().unwrap_or("").to_string();
            let _ = child.wait();
            Ok(content)
        }
        Some("error") => {
            let _ = child.wait();
            Err(response["message"].as_str().unwrap_or("Unknown error").to_string())
        }
        _ => {
            let _ = child.wait();
            Err(format!("Unknown response: {line}"))
        }
    }
}

fn complete_timeout() -> Duration {
    const DEFAULT_TIMEOUT_MS: u64 = 30_000;
    let raw = std::env::var("CREATORAI_AI_COMPLETE_TIMEOUT_MS").ok();
    match raw
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u64>().ok())
    {
        Some(ms) if ms > 0 => Duration::from_millis(ms),
        _ => Duration::from_millis(DEFAULT_TIMEOUT_MS),
    }
}

pub fn run_complete(
    provider: Value,
    parameters: Value,
    system_prompt: String,
    messages: Vec<Value>,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<String, String> {
    let ai_engine_path = get_ai_engine_path()?;

    let cancel_flag = cancel.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let timeout = complete_timeout();

    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;

    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let reader_cancel = cancel_flag.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            if reader_cancel.load(Ordering::Relaxed) {
                break;
            }
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = tx.send(Err("EOF".to_string()));
                    break;
                }
                Ok(_) => {
                    if tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Failed to read from stdout: {e}")));
                    break;
                }
            }
        }
    });

    let init_request = json!({
        "type": "complete",
        "provider": provider,
        "parameters": parameters,
        "systemPrompt": system_prompt,
        "messages": messages,
    });

    writeln!(stdin, "{}", init_request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    stdin.flush()
        .map_err(|e| format!("Failed to flush stdin: {e}"))?;

    let started = Instant::now();
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err("已停止生成".to_string());
        }
        if started.elapsed() > timeout {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err("补全请求超时（请重试或更换模型/Provider）".to_string());
        }

        let line = match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(Ok(line)) => line,
            Ok(Err(err)) => {
                drop(stdin);
                let status = child
                    .wait()
                    .map_err(|e| format!("Failed to wait for ai-engine: {e}"))?;
                return Err(format!("ai-engine exited unexpectedly: {status}. {err}"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                drop(stdin);
                let status = child
                    .wait()
                    .map_err(|e| format!("Failed to wait for ai-engine: {e}"))?;
                return Err(format!("ai-engine exited unexpectedly: {status}"));
            }
        };

        let response: Value = serde_json::from_str(&line)
            .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;

        match response["type"].as_str() {
            Some("done") => {
                let content = response["content"].as_str().unwrap_or("").to_string();
                drop(stdin);
                let _ = child.wait();
                return Ok(content);
            }
            Some("error") => {
                let message = response["message"].as_str().unwrap_or("Unknown error");
                drop(stdin);
                let _ = child.wait();
                return Err(message.to_string());
            }
            _ => {
                drop(stdin);
                let _ = child.wait();
                return Err(format!("Unknown response type: {line}"));
            }
        }
    }
}

pub fn run_chat(request: ChatRequest) -> Result<ChatResponse, String> {
    run_chat_with_events(request, None, None)
}

pub fn run_chat_with_events(
    request: ChatRequest,
    events: Option<ChatEventHandler>,
    cancel: Option<Arc<AtomicBool>>,
) -> Result<ChatResponse, String> {
    let ai_engine_path = get_ai_engine_path()?;

    let cancel_flag = cancel.unwrap_or_else(|| Arc::new(AtomicBool::new(false)));

    let provider_base_url = request
        .provider
        .get("baseURL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // geminicli/v1 目前在多轮 tool calling 的第二次请求会要求 thought_signature（OpenAI tool_calls 不包含），
    // 因此在该端点下我们只执行工具并直接返回结果。
    let direct_return_tool_results = provider_base_url.contains("/geminicli/v1");

    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    let reader_cancel = cancel_flag.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            if reader_cancel.load(Ordering::Relaxed) {
                break;
            }
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    let _ = tx.send(Err("EOF".to_string()));
                    break;
                }
                Ok(_) => {
                    if tx.send(Ok(line)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(format!("Failed to read from stdout: {e}")));
                    break;
                }
            }
        }
    });

    // 发送初始请求
    let init_request = json!({
        "type": "chat",
        "provider": request.provider,
        "parameters": request.parameters,
        "systemPrompt": request.system_prompt,
        "messages": request.messages,
    });

    writeln!(stdin, "{}", init_request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    stdin.flush()
        .map_err(|e| format!("Failed to flush stdin: {e}"))?;

    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let timeout = chat_timeout();
    let mut last_progress = Instant::now();

    // 循环处理响应
    loop {
        if cancel_flag.load(Ordering::SeqCst) {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err("已停止生成".to_string());
        }

        if last_progress.elapsed() > timeout {
            drop(stdin);
            let _ = child.kill();
            let _ = child.wait();
            return Err("AI 请求超时（请重试或更换模型/Provider）".to_string());
        }

        let line = match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(line)) => {
                last_progress = Instant::now();
                line
            }
            Ok(Err(err)) => {
                drop(stdin);
                let status = child
                    .wait()
                    .map_err(|e| format!("Failed to wait for ai-engine: {e}"))?;
                return Err(format!("ai-engine exited unexpectedly: {status}. {err}"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                drop(stdin);
                let status = child
                    .wait()
                    .map_err(|e| format!("Failed to wait for ai-engine: {e}"))?;
                return Err(format!("ai-engine exited unexpectedly: {status}"));
            }
        };

        let response: Value = serde_json::from_str(&line)
            .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;

        match response["type"].as_str() {
            Some("done") => {
                let content = response["content"].as_str().unwrap_or("").to_string();
                drop(stdin);
                let _ = child.wait();
                return Ok(ChatResponse { content, tool_calls });
            }
            Some("error") => {
                let message = response["message"].as_str().unwrap_or("Unknown error");
                drop(stdin);
                let _ = child.wait();
                return Err(message.to_string());
            }
            Some("tool_call") => {
                let calls = response["calls"]
                    .as_array()
                    .ok_or("Invalid tool_call format")?;

                let mut results = Vec::new();

                for call in calls {
                    if cancel_flag.load(Ordering::SeqCst) {
                        drop(stdin);
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("已停止生成".to_string());
                    }

                    let name = call["name"].as_str().unwrap_or("").to_string();
                    let args = call["args"].clone();
                    let id = call["id"].as_str().unwrap_or("").to_string();

                    if let Some(handler) = &events {
                        (handler.on_tool_call_start)(ToolCallStartEvent {
                            id: id.clone(),
                            name: name.clone(),
                            args: args.clone(),
                        });
                    }

                    let started = Instant::now();
                    let result =
                        execute_tool(
                            &request.project_dir,
                            request.mode.clone(),
                            request.allow_write,
                            request.chapter_id.as_deref(),
                            &name,
                            &args,
                        );
                    let duration = started.elapsed().as_millis() as u64;

                    let (status, result_value, error_value) = match result {
                        Ok(value) => (ToolCallStatus::Success, Some(value), None),
                        Err(err) => (ToolCallStatus::Error, None, Some(err)),
                    };

                    if let Some(handler) = &events {
                        (handler.on_tool_call_end)(ToolCallEndEvent {
                            id: id.clone(),
                            result: result_value.clone(),
                            error: error_value.clone(),
                        });
                    }

                    tool_calls.push(ToolCall {
                        id: id.clone(),
                        name: name.clone(),
                        args: args.clone(),
                        status,
                        result: result_value.clone(),
                        error: error_value.clone(),
                        duration: Some(duration),
                    });

                    match (&result_value, &error_value) {
                        (Some(value), None) => results.push(json!({ "id": id, "result": value })),
                        (_, Some(err)) => {
                            results.push(json!({ "id": id, "result": "", "error": err }))
                        }
                        _ => results.push(json!({ "id": id, "result": "" })),
                    }
                }

                if direct_return_tool_results {
                    let content = format_tool_runs(&tool_calls);
                    drop(stdin);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(ChatResponse { content, tool_calls });
                }

                let tool_result = json!({
                    "type": "tool_result",
                    "results": results,
                });

                writeln!(stdin, "{}", tool_result.to_string())
                    .map_err(|e| format!("Failed to write tool result: {e}"))?;
                stdin.flush()
                    .map_err(|e| format!("Failed to flush tool result: {e}"))?;
            }
            _ => {
                drop(stdin);
                let _ = child.wait();
                return Err(format!("Unknown response type: {line}"));
            }
        }
    }
}

fn as_u32(value: &Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .or_else(|| value.as_f64().and_then(|v| (v as i64).try_into().ok()))
}

fn as_i64(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|v| i64::try_from(v).ok()))
        .or_else(|| value.as_f64().and_then(|v| if v.is_finite() { Some(v as i64) } else { None }))
}

fn now_unix_seconds() -> Result<u64, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn count_words(content: &str) -> u32 {
    content.chars().filter(|c| !c.is_whitespace()).count() as u32
}

fn maybe_update_chapter_index(project_root: &Path, relative_path: &str) -> Result<(), String> {
    if !relative_path.starts_with("chapters/") || !relative_path.ends_with(".txt") {
        return Ok(());
    }
    let filename = relative_path
        .rsplit('/')
        .next()
        .unwrap_or(relative_path);
    let Some(chapter_id) = filename.strip_suffix(".txt") else {
        return Ok(());
    };
    if !chapter_id.starts_with("chapter_")
        || !chapter_id["chapter_".len()..]
            .chars()
            .all(|c| c.is_ascii_digit())
    {
        return Ok(());
    }

    let index_path = validate_path(project_root, "chapters/index.json")?;
    if !index_path.exists() {
        return Ok(());
    }
    let bytes = std::fs::read(&index_path)
        .map_err(|e| format!("Failed to read chapters/index.json: {e}"))?;
    let mut index = serde_json::from_slice::<ChapterIndex>(&bytes)
        .map_err(|e| format!("Failed to parse chapters/index.json: {e}"))?;

    let Some(meta) = index.chapters.iter_mut().find(|c| c.id == chapter_id) else {
        return Ok(());
    };

    let chapter_path = validate_path(project_root, relative_path)?;
    let content = std::fs::read_to_string(&chapter_path)
        .map_err(|e| format!("Failed to read chapter content: {e}"))?;

    meta.updated = now_unix_seconds()?;
    meta.word_count = count_words(&content);

    let json = serde_json::to_string_pretty(&index)
        .map_err(|e| format!("Serialize JSON failed: {e}"))?;
    std::fs::write(&index_path, format!("{json}\n"))
        .map_err(|e| format!("Failed to write chapters/index.json: {e}"))?;
    Ok(())
}

fn normalize_chapter_id(value: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err("chapterId is empty".to_string());
    }
    if v.starts_with("chapter_") {
        let suffix = &v["chapter_".len()..];
        if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
            return Err("Invalid chapterId (expected 'chapter_XXX')".to_string());
        }
        return Ok(v.to_string());
    }
    if v.chars().all(|c| c.is_ascii_digit()) {
        // Accept "3" / "03" / "003"
        let n: u32 = v
            .parse()
            .map_err(|_| "Invalid chapterId (expected digits)".to_string())?;
        return Ok(format!("chapter_{n:03}"));
    }
    Err("Invalid chapterId".to_string())
}

fn execute_tool(
    project_dir: &str,
    mode: SessionMode,
    allow_write: bool,
    chapter_id: Option<&str>,
    name: &str,
    args: &Value,
) -> Result<String, String> {
    if matches!(mode, SessionMode::Discussion) && matches!(name, "write" | "append" | "save_summary") {
        return Err("Tool not allowed in Discussion mode".to_string());
    }
    if matches!(mode, SessionMode::Continue) && !allow_write && matches!(name, "write" | "append" | "save_summary") {
        return Err("Tool not allowed before user confirmation".to_string());
    }

    let project_root = Path::new(project_dir);
    match name {
        "read" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let offset = as_i64(&args["offset"]);
            let limit = as_u32(&args["limit"]);

            let params = read::ReadParams {
                path: path.to_string(),
                offset,
                limit,
            };
            let result = read::read_file(project_root, params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        "write" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let content = args["content"].as_str().ok_or("Missing content")?;

            let params = write::WriteParams {
                path: path.to_string(),
                content: content.to_string(),
            };
            write::write_file(project_root, params)?;
            Ok("File written successfully".to_string())
        }
        "append" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let content = args["content"].as_str().ok_or("Missing content")?;

            let params = append::AppendParams {
                path: path.to_string(),
                content: content.to_string(),
            };
            append::append_file(project_root, params)?;
            // Keep chapters/index.json wordCount in sync if we're appending to a chapter file.
            maybe_update_chapter_index(project_root, path)?;
            Ok("Content appended successfully".to_string())
        }
        "list" => {
            let path = args["path"].as_str().map(|s| s.to_string());

            let params = list::ListParams { path };
            let result = list::list_dir(project_root, params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        "search" => {
            let query = args["query"].as_str().ok_or("Missing query")?;
            let path = args["path"].as_str().map(|s| s.to_string());

            let params = search::SearchParams {
                query: query.to_string(),
                path,
            };
            let result = search::search_in_files(project_root, params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        "get_chapter_info" => {
            let Some(ch_id) = chapter_id else {
                return Err("No chapter selected".to_string());
            };
            let chapter_id = normalize_chapter_id(ch_id)?;
            let index_path = validate_path(project_root, "chapters/index.json")?;
            let bytes = std::fs::read(&index_path)
                .map_err(|e| format!("Failed to read chapters/index.json: {e}"))?;
            let index = serde_json::from_slice::<ChapterIndex>(&bytes)
                .map_err(|e| format!("Failed to parse chapters/index.json: {e}"))?;
            let meta = index
                .chapters
                .iter()
                .find(|c| c.id == chapter_id)
                .ok_or("Chapter not found")?;
            #[derive(serde::Serialize)]
            #[serde(rename_all = "camelCase")]
            struct ChapterInfo {
                chapter_id: String,
                title: String,
                path: String,
                word_count: u32,
                updated_at: u64,
            }
            let info = ChapterInfo {
                chapter_id: meta.id.clone(),
                title: meta.title.clone(),
                path: format!("chapters/{}.txt", meta.id),
                word_count: meta.word_count,
                updated_at: meta.updated,
            };
            serde_json::to_string(&info).map_err(|e| e.to_string())
        }
        "save_summary" => {
            let chapter_id_raw = args["chapterId"]
                .as_str()
                .or_else(|| args["chapter_id"].as_str())
                .ok_or("Missing chapterId")?;
            let chapter_id = normalize_chapter_id(chapter_id_raw)?;
            let summary_text = args["summary"].as_str().ok_or("Missing summary")?;
            let entry = summary::save_summary(
                project_root,
                chapter_id,
                summary_text.to_string(),
            )?;
            serde_json::to_string(&entry).map_err(|e| e.to_string())
        }
        "rag_search" => {
            let query = args["query"].as_str().ok_or("Missing query")?;
            let top_k = as_u32(&args["topK"])
                .or_else(|| as_u32(&args["top_k"]))
                .unwrap_or(5) as usize;
            let hits = rag::search(project_root, query, top_k)?;
            serde_json::to_string(&hits).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{ChapterIndex, ChapterMeta};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!("{prefix}-{ts}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn create_min_project(root: &Path) {
        fs::create_dir_all(root.join(".creatorai")).unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join(".creatorai/config.json"), "{}\n").unwrap();
        let index = ChapterIndex {
            chapters: Vec::new(),
            next_id: 1,
        };
        let json = serde_json::to_string_pretty(&index).unwrap();
        fs::write(root.join("chapters/index.json"), format!("{json}\n")).unwrap();
    }

    const MOCK_AI_ENGINE_CLI: &str = r#"#!/usr/bin/env bun
const stdinReader = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();
let stdinBuffer = "";

async function readJsonFromStdin() {
  while (true) {
    const newlineIndex = stdinBuffer.indexOf("\n");
    if (newlineIndex !== -1) {
      const line = stdinBuffer.slice(0, newlineIndex).trim();
      stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      return JSON.parse(line);
    }

    const { done, value } = await stdinReader.read();
    if (done) {
      throw new Error("EOF before complete JSON");
    }
    stdinBuffer += decoder.decode(value, { stream: true });
  }
}

function writeJson(output) {
  process.stdout.write(JSON.stringify(output) + "\n");
}

function scenarioFromMessages(messages) {
  const last = messages?.[messages.length - 1]?.content;
  if (typeof last !== "string") return "";
  if (last.includes("__SCENARIO_DISCUSSION_READ__")) return "discussion_read";
  if (last.includes("__SCENARIO_CONTINUE_APPLY__")) return "continue_apply";
  if (last.includes("__SCENARIO_READ_MISSING__")) return "read_missing";
  if (last.includes("__SCENARIO_DISCUSSION_APPEND__")) return "discussion_append";
  if (last.includes("__SCENARIO_CONTINUE_APPEND__")) return "continue_append";
  return "";
}

async function main() {
  const input = await readJsonFromStdin();
  if (input?.type !== "chat") {
    writeJson({ type: "error", message: "Unknown request type" });
    process.exit(1);
  }

  const scenario = scenarioFromMessages(input.messages);

  if (scenario === "discussion_read") {
    writeJson({
      type: "tool_call",
      calls: [
        { id: "call_read_1", name: "read", args: { path: "chapters/chapter_001.txt", offset: 0, limit: 20 } },
      ],
    });
    const toolResult = await readJsonFromStdin();
    const result = toolResult?.results?.find?.((r) => r.id === "call_read_1") ?? toolResult?.results?.[0];
    let excerpt = "";
    try {
      const parsed = JSON.parse(result?.result ?? "{}");
      const firstLine = String(parsed?.content ?? "").split("\n")[0] ?? "";
      excerpt = firstLine;
    } catch {
      excerpt = "";
    }
    writeJson({ type: "done", content: `我读到开头：${excerpt}` });
    return;
  }

  if (scenario === "continue_apply") {
    writeJson({
      type: "tool_call",
      calls: [
        { id: "call_append_1", name: "append", args: { path: "chapters/chapter_003.txt", content: "主角发现一个秘密。\n" } },
        { id: "call_save_summary_1", name: "save_summary", args: { chapterId: "003", summary: "第三章：主角发现秘密，为后续冲突埋伏笔。" } },
      ],
    });
    await readJsonFromStdin();
    writeJson({ type: "done", content: "已追加并保存摘要。" });
    return;
  }

  if (scenario === "read_missing") {
    writeJson({
      type: "tool_call",
      calls: [
        { id: "call_read_missing", name: "read", args: { path: "chapters/chapter_010.txt", offset: 0, limit: 20 } },
      ],
    });
    const toolResult = await readJsonFromStdin();
    const err = toolResult?.results?.[0]?.error ?? "";
    writeJson({ type: "done", content: err ? `文件不存在：${err}` : "文件不存在" });
    return;
  }

  if (scenario === "discussion_append") {
    writeJson({
      type: "tool_call",
      calls: [
        { id: "call_append_blocked", name: "append", args: { path: "chapters/chapter_001.txt", content: "world" } },
      ],
    });
    const toolResult = await readJsonFromStdin();
    const err = toolResult?.results?.[0]?.error ?? "";
    writeJson({ type: "done", content: err ? `append 失败：${err}` : "append 完成" });
    return;
  }

  if (scenario === "continue_append") {
    writeJson({
      type: "tool_call",
      calls: [
        { id: "call_append_blocked", name: "append", args: { path: "chapters/chapter_003.txt", content: "world" } },
      ],
    });
    const toolResult = await readJsonFromStdin();
    const err = toolResult?.results?.[0]?.error ?? "";
    writeJson({ type: "done", content: err ? `append 失败：${err}` : "append 完成" });
    return;
  }

  writeJson({ type: "done", content: "noop" });
}

main().catch((err) => {
  writeJson({ type: "error", message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
"#;

    fn ensure_mock_ai_engine_cli() {
        static PATH: OnceLock<PathBuf> = OnceLock::new();
        let path = PATH.get_or_init(|| {
            let p = std::env::temp_dir().join("creatorai-v2-mock-ai-engine-cli.ts");
            if let Ok(existing) = fs::read_to_string(&p) {
                if existing == MOCK_AI_ENGINE_CLI {
                    return p;
                }
            }
            fs::write(&p, MOCK_AI_ENGINE_CLI).expect("write mock ai-engine cli");
            p
        });
        std::env::set_var("CREATORAI_AI_ENGINE_CLI_PATH", path.to_string_lossy().to_string());
    }

    fn base_chat_request(project_dir: String, user_content: &str) -> ChatRequest {
        ensure_mock_ai_engine_cli();
        ChatRequest {
            provider: json!({
              "id": "mock",
              "name": "Mock Provider",
              "baseURL": "http://mock/v1",
              "apiKey": "test",
              "models": ["test-model"],
              "providerType": "openai-compatible",
            }),
            parameters: json!({
              "model": "test-model",
              "temperature": 0,
              "topP": 1,
              "maxTokens": 256,
            }),
            system_prompt: "test".to_string(),
            messages: vec![json!({ "role": "user", "content": user_content })],
            project_dir,
            mode: SessionMode::Discussion,
            chapter_id: None,
            allow_write: false,
        }
    }

    #[test]
    fn discussion_mode_can_read_and_quote_file() {
        let temp = TempDir::new("creatorai-v2-ai-bridge-discussion-read");
        fs::create_dir_all(temp.path.join("chapters")).unwrap();
        fs::write(
            temp.path.join("chapters/chapter_001.txt"),
            "第一行：开头要有钩子。\n第二行：铺垫冲突。\n",
        )
        .unwrap();

        let mut request = base_chat_request(
            temp.path.to_string_lossy().to_string(),
            "__SCENARIO_DISCUSSION_READ__",
        );
        request.mode = SessionMode::Discussion;

        let response = run_chat(request).expect("run_chat");
        assert_eq!(response.tool_calls.len(), 1);
        assert_eq!(response.tool_calls[0].name, "read");
        assert!(matches!(response.tool_calls[0].status, ToolCallStatus::Success));
        assert!(response.content.contains("我读到开头：00001| 第一行：开头要有钩子。"));
    }

    #[test]
    fn continue_mode_apply_can_append_and_save_summary() {
        let temp = TempDir::new("creatorai-v2-ai-bridge-continue-apply");
        create_min_project(&temp.path);

        let initial = "第三章：旧内容。\n";
        fs::write(temp.path.join("chapters/chapter_003.txt"), initial).unwrap();

        let index_path = temp.path.join("chapters/index.json");
        let index = ChapterIndex {
            chapters: vec![ChapterMeta {
                id: "chapter_003".to_string(),
                title: "第三章".to_string(),
                order: 3,
                created: 0,
                updated: 0,
                word_count: count_words(initial),
            }],
            next_id: 4,
        };
        let index_json = serde_json::to_string_pretty(&index).unwrap();
        fs::write(&index_path, format!("{index_json}\n")).unwrap();

        let appended = "主角发现一个秘密。\n";
        let summary_text = "第三章：主角发现秘密，为后续冲突埋伏笔。";

        let mut request =
            base_chat_request(temp.path.to_string_lossy().to_string(), "__SCENARIO_CONTINUE_APPLY__");
        request.mode = SessionMode::Continue;
        request.chapter_id = Some("chapter_003".to_string());
        request.allow_write = true;

        let response = run_chat(request).expect("run_chat");
        assert_eq!(response.tool_calls.len(), 2);
        assert!(response
            .tool_calls
            .iter()
            .any(|c| c.name == "append" && matches!(c.status, ToolCallStatus::Success)));
        assert!(response
            .tool_calls
            .iter()
            .any(|c| c.name == "save_summary" && matches!(c.status, ToolCallStatus::Success)));

        let updated_text = fs::read_to_string(temp.path.join("chapters/chapter_003.txt")).unwrap();
        assert!(updated_text.contains(initial));
        assert!(updated_text.contains(appended));

        // summaries.json should be created with the saved entry.
        let summaries = fs::read_to_string(temp.path.join("summaries.json")).unwrap();
        assert!(summaries.contains("\"chapterId\": \"chapter_003\""));
        assert!(summaries.contains(summary_text));

        // chapters/index.json should be updated (wordCount + updated timestamp).
        let updated_index_bytes = fs::read(&index_path).unwrap();
        let updated_index = serde_json::from_slice::<ChapterIndex>(&updated_index_bytes).unwrap();
        let meta = updated_index
            .chapters
            .iter()
            .find(|c| c.id == "chapter_003")
            .unwrap();
        assert_eq!(meta.word_count, count_words(&updated_text));
        assert!(meta.updated > 0);
    }

    #[test]
    fn tool_errors_are_reported_in_tool_calls_and_user_feedback() {
        let temp = TempDir::new("creatorai-v2-ai-bridge-tool-error");
        fs::create_dir_all(temp.path.join("chapters")).unwrap();

        let mut request =
            base_chat_request(temp.path.to_string_lossy().to_string(), "__SCENARIO_READ_MISSING__");
        request.mode = SessionMode::Discussion;

        let response = run_chat(request).expect("run_chat");
        assert_eq!(response.tool_calls.len(), 1);
        assert!(matches!(response.tool_calls[0].status, ToolCallStatus::Error));
        assert!(response.tool_calls[0]
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Failed to open file 'chapters/chapter_010.txt'"));
        assert!(response.content.contains("文件不存在："));
    }

    #[test]
    fn discussion_mode_blocks_append() {
        let temp = TempDir::new("creatorai-v2-ai-bridge-discussion-blocks-append");
        fs::create_dir_all(temp.path.join("chapters")).unwrap();
        fs::write(temp.path.join("chapters/chapter_001.txt"), "hello\n").unwrap();

        let mut request = base_chat_request(
            temp.path.to_string_lossy().to_string(),
            "__SCENARIO_DISCUSSION_APPEND__",
        );
        request.mode = SessionMode::Discussion;
        request.allow_write = true;

        let response = run_chat(request).expect("run_chat");
        assert_eq!(response.tool_calls.len(), 1);
        assert!(matches!(response.tool_calls[0].status, ToolCallStatus::Error));
        assert_eq!(
            response.tool_calls[0].error.as_deref(),
            Some("Tool not allowed in Discussion mode")
        );
        let after = fs::read_to_string(temp.path.join("chapters/chapter_001.txt")).unwrap();
        assert_eq!(after, "hello\n");
    }

    #[test]
    fn continue_mode_blocks_write_tools_before_confirmation() {
        let temp = TempDir::new("creatorai-v2-ai-bridge-continue-blocks-before-confirm");
        create_min_project(&temp.path);
        fs::write(temp.path.join("chapters/chapter_003.txt"), "hello\n").unwrap();

        let mut request = base_chat_request(
            temp.path.to_string_lossy().to_string(),
            "__SCENARIO_CONTINUE_APPEND__",
        );
        request.mode = SessionMode::Continue;
        request.chapter_id = Some("chapter_003".to_string());
        request.allow_write = false;

        let response = run_chat(request).expect("run_chat");
        assert_eq!(response.tool_calls.len(), 1);
        assert!(matches!(response.tool_calls[0].status, ToolCallStatus::Error));
        assert_eq!(
            response.tool_calls[0].error.as_deref(),
            Some("Tool not allowed before user confirmation")
        );
        let after = fs::read_to_string(temp.path.join("chapters/chapter_003.txt")).unwrap();
        assert_eq!(after, "hello\n");
    }
}
