use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
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
    // 使用项目目录定位 ai-engine（packages/ai-engine）
    let ai_engine_path = PathBuf::from(&request.project_dir).join("packages/ai-engine/src/cli.ts");
    if !ai_engine_path.exists() {
        return Err(format!(
            "ai-engine CLI not found: {}",
            ai_engine_path.display()
        ));
    }

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
        .current_dir(&request.project_dir)
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
            let result = read::file_read(project_dir.to_string(), params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        "write" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let content = args["content"].as_str().ok_or("Missing content")?;

            let params = write::WriteParams {
                path: path.to_string(),
                content: content.to_string(),
            };
            write::file_write(project_dir.to_string(), params)?;
            Ok("File written successfully".to_string())
        }
        "append" => {
            let path = args["path"].as_str().ok_or("Missing path")?;
            let content = args["content"].as_str().ok_or("Missing content")?;

            let params = append::AppendParams {
                path: path.to_string(),
                content: content.to_string(),
            };
            append::file_append(project_dir.to_string(), params)?;
            Ok("Content appended successfully".to_string())
        }
        "list" => {
            let path = args["path"].as_str().map(|s| s.to_string());

            let params = list::ListParams { path };
            let result = list::file_list(project_dir.to_string(), params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        "search" => {
            let query = args["query"].as_str().ok_or("Missing query")?;
            let path = args["path"].as_str().map(|s| s.to_string());

            let params = search::SearchParams {
                query: query.to_string(),
                path,
            };
            let result = search::file_search(project_dir.to_string(), params)?;
            serde_json::to_string(&result).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

#[cfg(test)]
mod t1_6_integration_tests {
    use super::{run_chat, ChatRequest};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;

    const PROJECT_DIR: &str = "/Users/link/Desktop/creatorai-v2";

    const SYSTEM_PROMPT: &str = r#"你是一个文件助手。你可以使用以下工具：
- read: 读取文件内容
- write: 写入文件内容
- append: 追加内容到文件
- list: 列出目录下的文件
- search: 搜索文件内容

当用户要求你操作文件时，请使用相应的工具。"#;

    fn run_user_message(user: &str) -> Result<String, String> {
        let request = ChatRequest {
            provider: json!({
                "id": "gemini",
                "name": "Gemini",
                "baseURL": "http://127.0.0.1:3002/geminicli/v1",
                "apiKey": "sk-XnbHbzBOmPYGHgL_4Mg8zRcoBIb2gVpJiuO0eSifyyCUV2Twz2c4SljcNCo",
                "models": ["gemini-3-flash-preview"],
                "providerType": "openai-compatible",
            }),
            parameters: json!({
                "model": "gemini-3-flash-preview",
                "temperature": 0.7,
                "maxTokens": 2000,
            }),
            system_prompt: SYSTEM_PROMPT.to_string(),
            messages: vec![json!({ "role": "user", "content": user })],
            project_dir: PROJECT_DIR.to_string(),
        };

        Ok(run_chat(request)?.content)
    }

    #[test]
    fn t1_6_end_to_end_file_tools() {
        let test_file = PathBuf::from(PROJECT_DIR).join("test.txt");
        let _ = fs::remove_file(&test_file);

        let list_out = run_user_message("列出当前目录的文件").expect("list should succeed");
        println!("\n[list]\n{list_out}\n");
        assert!(list_out.contains("README.md") || list_out.contains("src-tauri"));

        let read_out = run_user_message("读取 README.md 文件").expect("read should succeed");
        println!("\n[read]\n{read_out}\n");
        assert!(read_out.contains("Tauri + React + Typescript"));

        let write_out = run_user_message("创建一个 test.txt 文件，内容是 \"Hello CreatorAI\"")
            .expect("write should succeed");
        println!("\n[write]\n{write_out}\n");

        let written = fs::read_to_string(&test_file).expect("test.txt should exist after write");
        assert!(written.contains("Hello CreatorAI"));

        let append_out = run_user_message("在 test.txt 末尾追加一行 \"这是追加的内容\"")
            .expect("append should succeed");
        println!("\n[append]\n{append_out}\n");

        let appended = fs::read_to_string(&test_file).expect("test.txt should exist after append");
        assert!(appended.contains("Hello CreatorAI"));
        assert!(appended.contains("这是追加的内容"));

        let search_out =
            run_user_message("搜索包含 \"tauri\" 的文件").expect("search should succeed");
        println!("\n[search]\n{search_out}\n");
        assert!(search_out.to_lowercase().contains("tauri"));

        let safety = run_user_message("读取 /etc/passwd 文件");
        match safety {
            Ok(content) => {
                // 如果模型拒绝但没有触发工具错误，也视为拒绝通过
                println!("\n[path-safety]\n{content}\n");
                assert!(
                    content.contains("不允许")
                        || content.contains("拒绝")
                        || content.contains("Absolute paths are not allowed")
                        || content.contains("路径")
                );
            }
            Err(err) => {
                println!("\n[path-safety:error]\n{err}\n");
                assert!(
                    err.contains("Absolute paths are not allowed")
                        || err.contains("Path escapes project directory")
                        || err.contains("Parent directory")
                        || err.contains("not allowed")
                );
            }
        }

        let _ = fs::remove_file(&test_file);
    }
}
