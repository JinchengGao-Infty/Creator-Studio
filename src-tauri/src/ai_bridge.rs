use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::time::Instant;

use crate::file_ops::{append, list, read, search, write};
use crate::project::ChapterIndex;
use crate::session::{SessionMode, ToolCall, ToolCallStatus};
use crate::{security::validate_path, summary};

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

fn get_repo_root_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Failed to resolve repo root directory".to_string())
}

fn get_ai_engine_cli_path() -> Result<PathBuf, String> {
    let root = get_repo_root_dir()?;
    let ai_engine_path = root.join("packages/ai-engine/src/cli.ts");
    if !ai_engine_path.exists() {
        return Err(format!(
            "ai-engine CLI not found: {}",
            ai_engine_path.display()
        ));
    }
    Ok(ai_engine_path)
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

pub fn fetch_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let repo_root = get_repo_root_dir()?;
    let ai_engine_path = get_ai_engine_cli_path()?;

    let mut child = Command::new("bun")
        .arg("run")
        .arg(&ai_engine_path)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn ai-engine: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

    let request = json!({
        "type": "fetch_models",
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

pub fn run_chat(request: ChatRequest) -> Result<ChatResponse, String> {
    run_chat_with_events(request, None)
}

pub fn run_chat_with_events(
    request: ChatRequest,
    events: Option<ChatEventHandler>,
) -> Result<ChatResponse, String> {
    // 使用仓库根目录定位 ai-engine，使用 project_dir 作为工具执行的项目根目录。
    let repo_root = get_repo_root_dir()?;
    let ai_engine_path = get_ai_engine_cli_path()?;

    let provider_base_url = request
        .provider
        .get("baseURL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // geminicli/v1 目前在多轮 tool calling 的第二次请求会要求 thought_signature（OpenAI tool_calls 不包含），
    // 因此在该端点下我们只执行工具并直接返回结果。
    let direct_return_tool_results = provider_base_url.contains("/geminicli/v1");

    // 启动 bun 运行 ai-engine
    let mut child = Command::new("bun")
        .arg("run")
        .arg(&ai_engine_path)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn ai-engine: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

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

    // 循环处理响应
    loop {
        let mut line = String::new();
        let read_bytes = reader
            .read_line(&mut line)
            .map_err(|e| format!("Failed to read from stdout: {e}"))?;

        if read_bytes == 0 {
            let status = child
                .wait()
                .map_err(|e| format!("Failed to wait for ai-engine: {e}"))?;
            return Err(format!("ai-engine exited unexpectedly: {status}"));
        }

        let response: Value = serde_json::from_str(&line)
            .map_err(|e| format!("Failed to parse response: {e}. line={line:?}"))?;

        match response["type"].as_str() {
            Some("done") => {
                let content = response["content"].as_str().unwrap_or("").to_string();
                let _ = child.wait();
                return Ok(ChatResponse { content, tool_calls });
            }
            Some("error") => {
                let message = response["message"].as_str().unwrap_or("Unknown error");
                let _ = child.wait();
                return Err(message.to_string());
            }
            Some("tool_call") => {
                let calls = response["calls"]
                    .as_array()
                    .ok_or("Invalid tool_call format")?;

                let mut results = Vec::new();

                for call in calls {
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
        _ => Err(format!("Unknown tool: {name}")),
    }
}
