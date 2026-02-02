use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::file_ops::{append, list, read, search, write};

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatRequest {
    pub provider: Value,
    pub parameters: Value,
    pub system_prompt: String,
    pub messages: Vec<Value>,
    pub project_dir: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChatResponse {
    pub content: String,
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

fn format_tool_runs(runs: Vec<(String, String, Value, Result<String, String>)>) -> String {
    let mut out = String::new();
    for (id, name, args, result) in runs {
        let args_json = serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_string());
        out.push_str(&format!("[tool] {name}\n"));
        out.push_str(&format!("id: {id}\n"));
        out.push_str(&format!("args: {args_json}\n"));
        match result {
            Ok(value) => out.push_str(&format!("result: {value}\n\n")),
            Err(err) => out.push_str(&format!("error: {err}\n\n")),
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
                return Ok(ChatResponse { content });
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

                let mut runs: Vec<(String, String, Value, Result<String, String>)> = Vec::new();
                for call in calls {
                    let name = call["name"].as_str().unwrap_or("").to_string();
                    let args = call["args"].clone();
                    let id = call["id"].as_str().unwrap_or("").to_string();

                    let result = execute_tool(&request.project_dir, &name, &args);
                    runs.push((id, name, args, result));
                }

                if direct_return_tool_results {
                    let content = format_tool_runs(runs);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Ok(ChatResponse { content });
                }

                let mut results = Vec::new();
                for (id, _name, _args, result) in runs {
                    match result {
                        Ok(value) => results.push(json!({ "id": id, "result": value })),
                        Err(err) => results.push(json!({ "id": id, "result": "", "error": err })),
                    }
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

fn execute_tool(project_dir: &str, name: &str, args: &Value) -> Result<String, String> {
    let project_root = Path::new(project_dir);
    match name {
        "read" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let offset = as_u32(&args["offset"]);
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
        _ => Err(format!("Unknown tool: {name}")),
    }
}
