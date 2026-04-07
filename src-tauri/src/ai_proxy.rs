//! AI Proxy — routes Tauri commands through the HTTP daemon.
//!
//! Replaces ai_bridge.rs by forwarding requests to the long-running
//! Node.js HTTP daemon managed by AIDaemon.

use crate::ai_daemon::AIDaemon;
use crate::keyring_store;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Inject API key from OS keyring into provider config.
fn inject_auth(mut provider: Value) -> Value {
    let provider_id = provider.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let provider_type = provider
        .get("providerType")
        .or_else(|| provider.get("provider_type"))
        .and_then(|v| v.as_str())
        .unwrap_or("openai-compatible")
        .to_string();

    if let Ok(Some(api_key)) = keyring_store::get_api_key(&provider_id) {
        if let Some(obj) = provider.as_object_mut() {
            obj.insert("apiKey".to_string(), json!(api_key));

            match provider_type.as_str() {
                "anthropic" => {
                    let headers = obj.entry("headers").or_insert(json!({}));
                    if let Some(h) = headers.as_object_mut() {
                        h.insert("x-api-key".to_string(), json!(api_key));
                    }
                }
                "google" => {
                    let headers = obj.entry("headers").or_insert(json!({}));
                    if let Some(h) = headers.as_object_mut() {
                        h.insert("x-goog-api-key".to_string(), json!(api_key));
                    }
                }
                _ => {}
            }
        }
    }

    provider
}

/// Build an HTTP client with the daemon's shared secret.
fn build_client(daemon: &AIDaemon) -> Result<(reqwest::blocking::Client, String), String> {
    let base = daemon
        .base_url()
        .ok_or("AI daemon not running")?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(600)) // 10 min max
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    Ok((client, base))
}

/// POST JSON to daemon and return JSON response.
fn post_json(daemon: &AIDaemon, path: &str, body: &Value) -> Result<Value, String> {
    let (client, base) = build_client(daemon)?;
    let url = format!("{base}{path}");

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", daemon.shared_secret()))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(|e| format!("Daemon request failed: {e}"))?;

    let status = resp.status();
    let text = resp.text().map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        let err: Value = serde_json::from_str(&text).unwrap_or(json!({"error": text}));
        return Err(err["error"].as_str().unwrap_or(&text).to_string());
    }

    serde_json::from_str(&text).map_err(|e| format!("Invalid JSON response: {e}"))
}

// ─── Public API ───

/// Fetch models from provider via daemon.
pub fn fetch_models(daemon: &AIDaemon, provider_type: &str, base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    daemon.ensure_running()?;

    let body = json!({
        "baseURL": base_url,
        "apiKey": api_key,
        "providerType": provider_type,
    });

    let resp = post_json(daemon, "/api/models", &body)?;
    let models = resp["models"]
        .as_array()
        .ok_or("Invalid models response")?
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect();

    Ok(models)
}

/// Run context compaction via daemon.
pub fn run_compact(
    daemon: &AIDaemon,
    provider: Value,
    parameters: Value,
    messages: Vec<Value>,
) -> Result<String, String> {
    daemon.ensure_running()?;

    let body = json!({
        "provider": inject_auth(provider),
        "parameters": parameters,
        "messages": messages,
    });

    let resp = post_json(daemon, "/api/compact", &body)?;
    Ok(resp["content"].as_str().unwrap_or("").to_string())
}

/// Run text extraction via daemon.
pub fn run_extract(
    daemon: &AIDaemon,
    provider: Value,
    parameters: Value,
    text: String,
) -> Result<Value, String> {
    daemon.ensure_running()?;

    let body = json!({
        "provider": inject_auth(provider),
        "parameters": parameters,
        "text": text,
    });

    post_json(daemon, "/api/extract", &body)
}

/// Run text transformation via daemon.
pub fn run_transform(
    daemon: &AIDaemon,
    provider: Value,
    parameters: Value,
    text: String,
    action: String,
    style: Option<String>,
) -> Result<String, String> {
    daemon.ensure_running()?;

    let mut body = json!({
        "provider": inject_auth(provider),
        "parameters": parameters,
        "text": text,
        "action": action,
    });

    if let Some(s) = style {
        body["style"] = json!(s);
    }

    let sse_text = post_sse(daemon, "/api/transform", &body)?;
    parse_sse_content(&sse_text)
}

// NOTE: ai_chat and ai_complete still use ai_bridge (legacy JSONL) because:
// - ai_chat needs Rust-side tool execution (read/write/append/search/rag)
// - ai_complete needs AtomicBool cancel support
// These will migrate to daemon once the Rust tool execution HTTP server is implemented.

/// Send POST request to SSE endpoint, check status, then parse.
fn post_sse(daemon: &AIDaemon, path: &str, body: &Value) -> Result<String, String> {
    let (client, base) = build_client(daemon)?;
    let url = format!("{base}{path}");

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", daemon.shared_secret()))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .map_err(|e| format!("Daemon request failed: {e}"))?;

    let status = resp.status();

    // Handle non-2xx before attempting SSE parse
    if !status.is_success() && !status.is_informational() {
        let text = resp.text().unwrap_or_default();
        // Try to extract error from JSON response
        if let Ok(err_json) = serde_json::from_str::<Value>(&text) {
            if let Some(msg) = err_json["error"].as_str() {
                return Err(msg.to_string());
            }
        }
        return Err(format!("Daemon returned status {status}: {text}"));
    }

    resp.text().map_err(|e| format!("Failed to read response: {e}"))
}

// ─── SSE Parsing Helpers ───

/// Parse SSE text and extract content from the done event.
fn parse_sse_content(sse_text: &str) -> Result<String, String> {
    for line in sse_text.lines() {
        let data = match line.strip_prefix("data: ").or_else(|| line.strip_prefix("data:")) {
            Some(d) => d.trim(),
            None => continue,
        };

        if let Ok(event) = serde_json::from_str::<Value>(data) {
            match event["type"].as_str() {
                Some("done") => {
                    return Ok(event["content"].as_str().unwrap_or("").to_string());
                }
                Some("error") => {
                    return Err(event["message"].as_str().unwrap_or("Unknown error").to_string());
                }
                _ => continue,
            }
        }
    }

    Err("No done/error event in SSE response".to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_auth_openai() {
        let provider = json!({
            "id": "test",
            "providerType": "openai-compatible",
        });
        // No keyring entry → apiKey not set, but should not panic
        let result = inject_auth(provider);
        assert!(result["id"].as_str() == Some("test"));
    }

    #[test]
    fn test_parse_sse_content_done() {
        let sse = "data: {\"type\":\"text_delta\",\"content\":\"hello\"}\n\ndata: {\"type\":\"done\",\"content\":\"hello world\"}\n\n";
        let result = parse_sse_content(sse).unwrap();
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_parse_sse_content_error() {
        let sse = "data: {\"type\":\"error\",\"message\":\"Provider failed\"}\n\n";
        let result = parse_sse_content(sse);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Provider failed"));
    }

    #[test]
    fn test_parse_sse_content_no_events() {
        let result = parse_sse_content("no events here");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_sse_content_with_text_deltas() {
        let sse = "data: {\"type\":\"text_delta\",\"content\":\"hi\"}\n\ndata: {\"type\":\"done\",\"content\":\"hi there\"}\n\n";
        let result = parse_sse_content(sse).unwrap();
        assert_eq!(result, "hi there");
    }
}
