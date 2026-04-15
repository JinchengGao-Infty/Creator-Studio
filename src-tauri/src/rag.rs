use bincode;
use fastembed::{
    EmbeddingModel, InitOptions, InitOptionsUserDefined, Pooling, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::project::{ChapterIndex, ChapterMeta};
use crate::security::validate_path;
use crate::summary::{self, SummaryEntry};
use crate::write_protection;

const KNOWLEDGE_DIR: &str = "knowledge";
const RAG_DIR: &str = ".creatorai/rag";
const RAG_CONFIG_PATH: &str = ".creatorai/rag/config.json";
const RAG_INDEX_PATH: &str = ".creatorai/rag/index.bin";
const RAG_EMBEDDING_STATUS_PATH: &str = ".creatorai/rag/embedding-status.json";
const RAG_SCHEMA_VERSION: u32 = 1;
const LOCAL_EMBEDDING_MODEL_DIR: &str = ".creatorai/rag/models/Xenova/bge-small-zh-v1.5";
const LOCAL_EMBEDDING_MODEL_NAME: &str = "Xenova/bge-small-zh-v1.5";
const HF_CACHE_DIR: &str = ".creatorai/rag/hf-cache";
const HF_MIRROR_ENDPOINT: &str = "https://hf-mirror.com";
const RAG_API_SECRET_PREFIX: &str = "rag_embedding_api";

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn ensure_project_exists(project_root: &Path) -> Result<(), String> {
    if project_root.as_os_str().is_empty() {
        return Err("Project path is empty".to_string());
    }
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }
    let meta = fs::symlink_metadata(project_root)
        .map_err(|e| format!("Failed to stat project path: {e}"))?;
    if !meta.file_type().is_dir() {
        return Err("Project path is not a directory".to_string());
    }

    // Validate expected structure.
    let cfg = validate_path(project_root, ".creatorai/config.json")?;
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    let index = validate_path(project_root, "chapters/index.json")?;
    if !index.exists() {
        return Err("Not a valid project: missing chapters/index.json".to_string());
    }
    Ok(())
}

pub fn ensure_knowledge_dir(project_root: &Path) -> Result<PathBuf, String> {
    ensure_project_exists(project_root)?;
    let knowledge = validate_path(project_root, KNOWLEDGE_DIR)?;
    fs::create_dir_all(&knowledge)
        .map_err(|e| format!("Failed to create knowledge directory: {e}"))?;
    Ok(knowledge)
}

fn ensure_rag_dir(project_root: &Path) -> Result<PathBuf, String> {
    ensure_project_exists(project_root)?;
    let rag_dir = validate_path(project_root, RAG_DIR)?;
    fs::create_dir_all(&rag_dir).map_err(|e| format!("Failed to create RAG directory: {e}"))?;
    Ok(rag_dir)
}

fn config_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, RAG_CONFIG_PATH)
}

fn index_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, RAG_INDEX_PATH)
}

fn embedding_status_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, RAG_EMBEDDING_STATUS_PATH)
}

fn local_model_dir(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, LOCAL_EMBEDDING_MODEL_DIR)
}

fn hf_cache_dir(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, HF_CACHE_DIR)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct RagConfig {
    pub schema_version: u32,
    pub enabled_paths: Vec<String>,
    pub embedding_backend: String,
    pub api_base_url: String,
    pub api_model: String,
}

impl Default for RagConfig {
    fn default() -> Self {
        Self {
            schema_version: RAG_SCHEMA_VERSION,
            enabled_paths: Vec::new(),
            embedding_backend: "local".to_string(),
            api_base_url: String::new(),
            api_model: "text-embedding-3-small".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagConfigPayload {
    pub schema_version: u32,
    pub enabled_paths: Vec<String>,
    pub embedding_backend: String,
    pub api_base_url: String,
    pub api_model: String,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagConfigUpdate {
    pub embedding_backend: String,
    pub api_base_url: String,
    pub api_model: String,
    pub api_key: Option<String>,
}

#[cfg(test)]
fn unique_temp_project_dir(label: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    std::env::temp_dir().join(format!("creatorai-rag-{label}-{nanos}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagEmbeddingStatus {
    pub backend: String,
    pub installed: bool,
    pub source: String,
    pub model: String,
    pub local_model_dir: String,
    pub cache_dir: String,
    pub index_exists: bool,
    pub requires_download: bool,
    pub api_configured: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagEmbeddingMarker {
    backend: String,
    source: String,
    model: String,
    prepared_at: u64,
}

fn load_config(project_root: &Path) -> Result<RagConfig, String> {
    ensure_rag_dir(project_root)?;
    let path = config_path(project_root)?;
    if !path.exists() {
        return Ok(RagConfig::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read rag config: {e}"))?;
    serde_json::from_slice::<RagConfig>(&bytes)
        .map_err(|e| format!("Failed to parse rag config: {e}"))
}

fn current_rag_config(project_root: &Path) -> Result<RagConfigPayload, String> {
    let config = load_config(project_root)?;
    Ok(RagConfigPayload {
        schema_version: config.schema_version,
        enabled_paths: config.enabled_paths,
        embedding_backend: config.embedding_backend,
        api_base_url: config.api_base_url,
        api_model: config.api_model,
        has_api_key: embedding_api_key(project_root)?.is_some(),
    })
}

pub fn get_rag_config(project_root: &Path) -> Result<RagConfigPayload, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;
    current_rag_config(&project_root)
}

pub fn update_rag_config(project_root: &Path, update: RagConfigUpdate) -> Result<RagConfigPayload, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;

    let backend = normalize_embedding_backend(&update.embedding_backend)?;
    let mut config = load_config(&project_root)?;
    config.embedding_backend = backend;
    config.api_base_url = update.api_base_url.trim().to_string();
    config.api_model = update.api_model.trim().to_string();
    save_config(&project_root, &config)?;

    if let Some(api_key) = update.api_key {
        let trimmed = api_key.trim();
        if trimmed.is_empty() {
            let _ = crate::keyring_store::delete_api_key(&embedding_api_secret_id(&project_root)?);
        } else {
            crate::keyring_store::store_api_key(&embedding_api_secret_id(&project_root)?, trimmed)?;
        }
    }

    current_rag_config(&project_root)
}

fn save_config(project_root: &Path, config: &RagConfig) -> Result<(), String> {
    ensure_rag_dir(project_root)?;
    let path = config_path(project_root)?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize rag config failed: {e}"))?;
    write_protection::write_string_with_backup(project_root, &path, &format!("{json}\n"))
        .map(|_| ())
}

fn load_embedding_marker(project_root: &Path) -> Result<Option<RagEmbeddingMarker>, String> {
    ensure_rag_dir(project_root)?;
    let path = embedding_status_path(project_root)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read embedding marker: {e}"))?;
    serde_json::from_slice::<RagEmbeddingMarker>(&bytes)
        .map(Some)
        .map_err(|e| format!("Failed to parse embedding marker: {e}"))
}

fn save_embedding_marker(project_root: &Path, marker: &RagEmbeddingMarker) -> Result<(), String> {
    ensure_rag_dir(project_root)?;
    let path = embedding_status_path(project_root)?;
    let json = serde_json::to_string_pretty(marker)
        .map_err(|e| format!("Serialize embedding marker failed: {e}"))?;
    write_protection::write_string_with_backup(project_root, &path, &format!("{json}\n"))
        .map(|_| ())
}

fn normalize_embedding_backend(raw: &str) -> Result<String, String> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "local" => Ok("local".to_string()),
        "api" => Ok("api".to_string()),
        "disabled" => Ok("disabled".to_string()),
        other => Err(format!("Unsupported embedding backend: {other}")),
    }
}

fn normalize_openai_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

fn embedding_api_secret_id(project_root: &Path) -> Result<String, String> {
    let canonical = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    Ok(format!("{RAG_API_SECRET_PREFIX}_{digest}"))
}

fn embedding_api_key(project_root: &Path) -> Result<Option<String>, String> {
    let secret_id = embedding_api_secret_id(project_root)?;
    crate::keyring_store::get_api_key(&secret_id)
}

fn read_chapter_index(project_root: &Path) -> Result<ChapterIndex, String> {
    let index_path = validate_path(project_root, "chapters/index.json")?;
    let bytes =
        fs::read(&index_path).map_err(|e| format!("Failed to read chapters/index.json: {e}"))?;
    serde_json::from_slice::<ChapterIndex>(&bytes)
        .map_err(|e| format!("Failed to parse chapters/index.json: {e}"))
}

fn normalize_doc_path(relative: &str) -> Result<String, String> {
    let trimmed = relative.trim();
    if trimmed.is_empty() {
        return Err("docPath is empty".to_string());
    }
    if !trimmed.starts_with("knowledge/") {
        return Err("docPath must be under knowledge/".to_string());
    }
    Ok(trimmed.to_string())
}

fn is_supported_doc_path(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|s| s.to_str()) else {
        return false;
    };
    matches!(ext.to_ascii_lowercase().as_str(), "txt" | "md" | "markdown")
}

fn read_dir_recursive(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if meta.is_dir() {
                stack.push(path);
            } else if meta.is_file() {
                out.push(path);
            }
        }
    }
    Ok(out)
}

fn to_rel_path(project_root: &Path, abs: &Path) -> Result<String, String> {
    let rel = abs
        .strip_prefix(project_root)
        .map_err(|_| "Failed to compute relative path".to_string())?;
    let s = rel.to_string_lossy().replace('\\', "/");
    Ok(s)
}

fn file_modified_unix(path: &Path) -> u64 {
    let modified = fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDoc {
    pub path: String,
    pub name: String,
    pub bytes: u64,
    pub modified_at: u64,
    pub enabled: bool,
}

pub fn list_docs(project_root: &Path) -> Result<Vec<KnowledgeDoc>, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    let config = load_config(&project_root)?;
    let enabled: HashSet<String> = config.enabled_paths.into_iter().collect();

    let knowledge_abs = validate_path(&project_root, KNOWLEDGE_DIR)?;
    let mut docs = Vec::new();
    for abs in read_dir_recursive(&knowledge_abs)? {
        if !is_supported_doc_path(&abs) {
            continue;
        }
        let rel = to_rel_path(&project_root, &abs)?;
        let name = abs
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(&rel)
            .to_string();
        let meta = fs::metadata(&abs).map_err(|e| format!("Failed to stat file: {e}"))?;
        docs.push(KnowledgeDoc {
            path: rel.clone(),
            name,
            bytes: meta.len(),
            modified_at: file_modified_unix(&abs),
            enabled: enabled.is_empty() || enabled.contains(&rel),
        });
    }
    docs.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(docs)
}

pub fn set_doc_enabled(project_root: &Path, doc_path: &str, enabled: bool) -> Result<(), String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    let doc_path = normalize_doc_path(doc_path)?;
    let _ = validate_path(&project_root, &doc_path)?;

    let mut config = load_config(&project_root)?;
    let mut set: HashSet<String> = config.enabled_paths.into_iter().collect();
    if enabled {
        set.insert(doc_path);
    } else {
        set.remove(&doc_path);
    }
    config.enabled_paths = set.into_iter().collect();
    config.enabled_paths.sort();
    save_config(&project_root, &config)
}

pub fn read_doc(project_root: &Path, doc_path: &str) -> Result<String, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    let doc_path = normalize_doc_path(doc_path)?;
    let abs = validate_path(&project_root, &doc_path)?;
    if !abs.exists() {
        return Err("Doc not found".to_string());
    }
    fs::read_to_string(&abs).map_err(|e| format!("Failed to read doc: {e}"))
}

pub fn write_doc(project_root: &Path, doc_path: &str, content: &str) -> Result<(), String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    let doc_path = normalize_doc_path(doc_path)?;
    let abs = validate_path(&project_root, &doc_path)?;
    if !is_supported_doc_path(&abs) {
        return Err("Only .txt/.md files are supported".to_string());
    }
    write_protection::write_string_with_backup(&project_root, &abs, content).map(|_| ())
}

pub fn append_doc(project_root: &Path, doc_path: &str, content: &str) -> Result<(), String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    let doc_path = normalize_doc_path(doc_path)?;
    let abs = validate_path(&project_root, &doc_path)?;
    if !is_supported_doc_path(&abs) {
        return Err("Only .txt/.md files are supported".to_string());
    }
    let existing = if abs.exists() {
        fs::read_to_string(&abs).unwrap_or_default()
    } else {
        String::new()
    };
    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(content);
    if !next.ends_with('\n') {
        next.push('\n');
    }
    write_protection::write_string_with_backup(&project_root, &abs, &next).map(|_| ())
}

fn chunk_text(text: &str, chunk_size: usize, overlap: usize) -> Vec<String> {
    if text.trim().is_empty() {
        return Vec::new();
    }
    if chunk_size == 0 || chunk_size <= overlap {
        return vec![text.to_string()];
    }

    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < chars.len() {
        let end = std::cmp::min(chars.len(), start + chunk_size);
        let slice: String = chars[start..end].iter().collect();
        if !slice.trim().is_empty() {
            chunks.push(slice);
        }
        if end == chars.len() {
            break;
        }
        start = end.saturating_sub(overlap);
    }
    chunks
}

fn load_local_embedding_model(model_dir: &Path) -> Result<Option<TextEmbedding>, String> {
    if !model_dir.exists() {
        return Ok(None);
    }

    let onnx_path = model_dir.join("onnx/model.onnx");
    let tokenizer_path = model_dir.join("tokenizer.json");
    let config_path = model_dir.join("config.json");
    let special_tokens_map_path = model_dir.join("special_tokens_map.json");
    let tokenizer_config_path = model_dir.join("tokenizer_config.json");

    let required = [
        (&onnx_path, "onnx/model.onnx"),
        (&tokenizer_path, "tokenizer.json"),
        (&config_path, "config.json"),
        (&special_tokens_map_path, "special_tokens_map.json"),
        (&tokenizer_config_path, "tokenizer_config.json"),
    ];

    // If the directory exists but none of the expected files are present, treat it as "not configured"
    // and fall back to downloading.
    let any_present = required.iter().any(|(p, _)| p.exists());
    if !any_present {
        return Ok(None);
    }

    for (path, name) in required {
        if !path.exists() {
            return Err(format!(
                "Local embedding model directory is missing required file: {name}"
            ));
        }
    }

    let onnx_file = fs::read(&onnx_path).map_err(|e| format!("Failed to read {onnx_path:?}: {e}"))?;
    let tokenizer_files = TokenizerFiles {
        tokenizer_file: fs::read(&tokenizer_path)
            .map_err(|e| format!("Failed to read {tokenizer_path:?}: {e}"))?,
        config_file: fs::read(&config_path).map_err(|e| format!("Failed to read {config_path:?}: {e}"))?,
        special_tokens_map_file: fs::read(&special_tokens_map_path)
            .map_err(|e| format!("Failed to read {special_tokens_map_path:?}: {e}"))?,
        tokenizer_config_file: fs::read(&tokenizer_config_path)
            .map_err(|e| format!("Failed to read {tokenizer_config_path:?}: {e}"))?,
    };

    let model = UserDefinedEmbeddingModel::new(onnx_file, tokenizer_files).with_pooling(Pooling::Cls);
    TextEmbedding::try_new_from_user_defined(model, InitOptionsUserDefined::default())
        .map(Some)
        .map_err(|e| format!("Failed to init local embedding model: {e}"))
}

fn local_model_state(model_dir: &Path) -> Result<(bool, bool, Option<String>), String> {
    if !model_dir.exists() {
        return Ok((false, false, None));
    }

    let required = [
        model_dir.join("onnx/model.onnx"),
        model_dir.join("tokenizer.json"),
        model_dir.join("config.json"),
        model_dir.join("special_tokens_map.json"),
        model_dir.join("tokenizer_config.json"),
    ];

    let any_present = required.iter().any(|p| p.exists());
    if !any_present {
        return Ok((false, false, None));
    }

    let missing = [
        ("onnx/model.onnx", required[0].exists()),
        ("tokenizer.json", required[1].exists()),
        ("config.json", required[2].exists()),
        ("special_tokens_map.json", required[3].exists()),
        ("tokenizer_config.json", required[4].exists()),
    ]
    .into_iter()
    .find(|(_, exists)| !exists)
    .map(|(name, _)| name.to_string());

    if let Some(name) = missing {
        return Ok((false, true, Some(format!("本地嵌入模型目录缺少必要文件：{name}"))));
    }

    Ok((true, true, None))
}

fn init_cached_embedding_model(project_root: &Path) -> Result<TextEmbedding, String> {
    let cache_dir = hf_cache_dir(project_root)?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create hf cache dir: {e}"))?;

    let options = InitOptions::new(EmbeddingModel::BGESmallZHV15)
        .with_cache_dir(cache_dir)
        .with_show_download_progress(false);

    let prev_offline = std::env::var("HF_HUB_OFFLINE").ok();
    std::env::set_var("HF_HUB_OFFLINE", "1");
    let result = TextEmbedding::try_new(options)
        .map_err(|e| format!("Cached embedding model unavailable: {e}"));
    match prev_offline {
        Some(value) => std::env::set_var("HF_HUB_OFFLINE", value),
        None => std::env::remove_var("HF_HUB_OFFLINE"),
    }
    result
}

fn init_embedding_model(project_root: &Path, allow_download: bool) -> Result<TextEmbedding, String> {
    // Prefer local model files if provided by the user.
    let local_dir = local_model_dir(project_root)?;
    match load_local_embedding_model(&local_dir)? {
        Some(model) => return Ok(model),
        None => {}
    }

    if !allow_download {
        return init_cached_embedding_model(project_root).map_err(|_| {
            format!(
                "Embedding 模型尚未准备。请先在知识库面板点击“下载模型”，或手动把模型文件放到：{}",
                LOCAL_EMBEDDING_MODEL_DIR
            )
        });
    }

    // Otherwise, download via HuggingFace hub (can be mirrored via HF_ENDPOINT).
    let cache_dir = hf_cache_dir(project_root)?;
    fs::create_dir_all(&cache_dir).map_err(|e| format!("Failed to create hf cache dir: {e}"))?;

    let options = InitOptions::new(EmbeddingModel::BGESmallZHV15)
        .with_cache_dir(cache_dir)
        .with_show_download_progress(true);

    let had_custom_endpoint = std::env::var("HF_ENDPOINT")
        .ok()
        .is_some_and(|v| !v.trim().is_empty());

    match TextEmbedding::try_new(options.clone()) {
        Ok(model) => Ok(model),
        Err(err) => {
            if had_custom_endpoint {
                return Err(format!("Failed to init embedding model: {err}"));
            }

            // Retry once with a common mirror when the default endpoint is blocked.
            let prev = std::env::var("HF_ENDPOINT").ok();
            std::env::set_var("HF_ENDPOINT", HF_MIRROR_ENDPOINT);
            let retry = TextEmbedding::try_new(options);
            match retry {
                Ok(model) => {
                    // Restore previous state to avoid surprising global behavior.
                    match prev {
                        Some(value) => std::env::set_var("HF_ENDPOINT", value),
                        None => std::env::remove_var("HF_ENDPOINT"),
                    }
                    Ok(model)
                }
                Err(err2) => {
                    match prev {
                        Some(value) => std::env::set_var("HF_ENDPOINT", value),
                        None => std::env::remove_var("HF_ENDPOINT"),
                    }
                    Err(format!(
                        "Failed to init embedding model (HF). You can either:\n\
1) Set HF_ENDPOINT to a reachable mirror (e.g. {HF_MIRROR_ENDPOINT}) and retry; or\n\
2) Download the following files for {LOCAL_EMBEDDING_MODEL_NAME} (from HuggingFace, hf-mirror, ModelScope/魔搭等任意来源) and place them under:\n\
   {LOCAL_EMBEDDING_MODEL_DIR}/\n\
   - onnx/model.onnx\n\
   - tokenizer.json\n\
   - config.json\n\
   - special_tokens_map.json\n\
   - tokenizer_config.json\n\
\n\
Original error: {err}\n\
Mirror error: {err2}"
                    ))
                }
            }
        }
    }
}

fn embedder(project_root: &Path, allow_download: bool) -> Result<MutexGuard<'static, TextEmbedding>, String> {
    static EMBEDDER: OnceLock<Mutex<TextEmbedding>> = OnceLock::new();
    static INIT_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    if let Some(embedder) = EMBEDDER.get() {
        return embedder
            .lock()
            .map_err(|_| "Embedding model lock poisoned".to_string());
    }

    let lock = INIT_LOCK.get_or_init(|| Mutex::new(()));
    let _guard = lock
        .lock()
        .map_err(|_| "Embedding model init lock poisoned".to_string())?;

    if let Some(embedder) = EMBEDDER.get() {
        return embedder
            .lock()
            .map_err(|_| "Embedding model lock poisoned".to_string());
    }

    let model = init_embedding_model(project_root, allow_download)?;
    let _ = EMBEDDER.set(Mutex::new(model));
    EMBEDDER
        .get()
        .ok_or("Embedding model init failed".to_string())?
        .lock()
        .map_err(|_| "Embedding model lock poisoned".to_string())
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingItem {
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct OpenAIEmbeddingsResponse {
    data: Vec<OpenAIEmbeddingItem>,
}

fn embed_via_api(project_root: &Path, config: &RagConfig, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if inputs.is_empty() {
        return Ok(Vec::new());
    }

    let base_url = normalize_openai_base_url(&config.api_base_url);
    if base_url.is_empty() {
        return Err("API embedding backend 未配置 base URL".to_string());
    }
    let model = config.api_model.trim();
    if model.is_empty() {
        return Err("API embedding backend 未配置模型名".to_string());
    }
    let api_key = embedding_api_key(project_root)?
        .ok_or("API embedding backend 未配置 API Key".to_string())?;
    let endpoint = format!("{base_url}/embeddings");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to build embedding API client: {e}"))?;

    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": model,
            "input": inputs,
        }))
        .send()
        .map_err(|e| format!("Embedding API request failed: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("Failed to read embedding API response: {e}"))?;

    if !status.is_success() {
        let preview = body.chars().take(240).collect::<String>();
        return Err(format!("Embedding API returned {status}: {preview}"));
    }

    let parsed = serde_json::from_str::<OpenAIEmbeddingsResponse>(&body)
        .map_err(|e| format!("Invalid embedding API response: {e}"))?;
    Ok(parsed.data.into_iter().map(|item| item.embedding).collect())
}

fn embed_texts(project_root: &Path, texts: &[String], allow_download: bool) -> Result<Vec<Vec<f32>>, String> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let config = load_config(project_root)?;
    let backend = normalize_embedding_backend(&config.embedding_backend)?;
    match backend.as_str() {
        "disabled" => Err("当前项目的 embedding backend 已禁用".to_string()),
        "api" => embed_via_api(project_root, &config, texts),
        _ => {
            let mut embedder = embedder(project_root, allow_download)?;
            let inputs: Vec<&str> = texts.iter().map(|s| s.as_str()).collect();
            embedder
                .embed(inputs, None)
                .map_err(|e| format!("Embedding failed: {e}"))
        }
    }
}

pub fn embedding_status(project_root: &Path) -> Result<RagEmbeddingStatus, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;
    let config = load_config(&project_root)?;
    let backend = normalize_embedding_backend(&config.embedding_backend)?;
    let api_configured = !config.api_base_url.trim().is_empty()
        && !config.api_model.trim().is_empty()
        && embedding_api_key(&project_root)?.is_some();
    let local_dir = local_model_dir(&project_root)?;
    let marker = load_embedding_marker(&project_root)?;
    let (local_complete, local_touched, local_issue) = local_model_state(&local_dir)?;
    let index_exists = index_path(&project_root)?.exists();

    let (installed, source, message, requires_download) = match backend.as_str() {
        "disabled" => (
            false,
            "disabled".to_string(),
            Some("当前项目已禁用 embedding 检索。".to_string()),
            false,
        ),
        "api" => {
            let message = if api_configured {
                None
            } else {
                Some("API embedding backend 尚未配置完整。请填写 base URL、模型名和 API Key。".to_string())
            };
            (api_configured, "api".to_string(), message, false)
        }
        _ => {
            if local_complete {
                (true, "local-files".to_string(), None, false)
            } else if let Some(existing) = marker {
                (true, existing.source, None, false)
            } else if local_touched {
                (false, "local-files".to_string(), local_issue, true)
            } else {
                (
                    false,
                    "missing".to_string(),
                    Some("未安装 embedding 模型。主功能不受影响，需要语义检索时再下载即可。".to_string()),
                    true,
                )
            }
        }
    };

    Ok(RagEmbeddingStatus {
        backend,
        installed,
        source,
        model: if config.api_model.trim().is_empty() {
            LOCAL_EMBEDDING_MODEL_NAME.to_string()
        } else {
            config.api_model.clone()
        },
        local_model_dir: LOCAL_EMBEDDING_MODEL_DIR.to_string(),
        cache_dir: HF_CACHE_DIR.to_string(),
        index_exists,
        requires_download,
        api_configured,
        message,
    })
}

pub fn prepare_embedding_model(project_root: &Path) -> Result<RagEmbeddingStatus, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;
    let config = load_config(&project_root)?;
    let backend = normalize_embedding_backend(&config.embedding_backend)?;
    if backend != "local" {
        return Err("只有 local embedding backend 需要下载本地模型".to_string());
    }
    let _ = init_embedding_model(&project_root, true)?;
    save_embedding_marker(
        &project_root,
        &RagEmbeddingMarker {
            backend,
            source: "downloaded".to_string(),
            model: LOCAL_EMBEDDING_MODEL_NAME.to_string(),
            prepared_at: now_unix_seconds()?,
        },
    )?;
    embedding_status(&project_root)
}

fn normalize_embedding(mut v: Vec<f32>) -> (Vec<f32>, f32) {
    let norm = v.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>().sqrt() as f32;
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    (v, norm)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagDocState {
    path: String,
    modified_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagChunk {
    id: String,
    source_path: String,
    text: String,
    embedding: Vec<f32>,
    norm: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagIndex {
    schema_version: u32,
    model: String,
    created_at: u64,
    docs: Vec<RagDocState>,
    chunks: Vec<RagChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexSummary {
    pub created_at: u64,
    pub doc_count: usize,
    pub chunk_count: usize,
    pub model: String,
}

pub fn build_index(project_root: &Path) -> Result<RagIndexSummary, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;

    let docs = list_docs(&project_root)?;
    let enabled_docs: Vec<KnowledgeDoc> = docs.into_iter().filter(|d| d.enabled).collect();

    let mut doc_states = Vec::new();
    let mut chunk_sources = Vec::new();
    let mut chunk_texts = Vec::new();

    for doc in enabled_docs {
        let abs = validate_path(&project_root, &doc.path)?;
        let content = match fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(_) => continue,
        };
        doc_states.push(RagDocState {
            path: doc.path.clone(),
            modified_at: doc.modified_at,
        });

        let chunks = chunk_text(&content, 800, 120);
        for (i, chunk) in chunks.into_iter().enumerate() {
            let id = format!("{}#{}", doc.path, i);
            chunk_sources.push((id, doc.path.clone(), chunk.clone()));
            chunk_texts.push(chunk);
        }
    }

    let embeddings = embed_texts(&project_root, &chunk_texts, false)?;

    if embeddings.len() != chunk_sources.len() {
        return Err("Embedding count mismatch".to_string());
    }

    let mut chunks = Vec::new();
    for (i, emb) in embeddings.into_iter().enumerate() {
        let (embedding, norm) = normalize_embedding(emb);
        let (id, source_path, text) = &chunk_sources[i];
        chunks.push(RagChunk {
            id: id.clone(),
            source_path: source_path.clone(),
            text: text.clone(),
            embedding,
            norm,
        });
    }

    let created_at = now_unix_seconds()?;
    let index = RagIndex {
        schema_version: RAG_SCHEMA_VERSION,
        model: "bge-small-zh-v1.5".to_string(),
        created_at,
        docs: doc_states,
        chunks,
    };

    let bytes = bincode::serialize(&index)
        .map_err(|e| format!("Serialize RAG index failed: {e}"))?;
    let path = index_path(&project_root)?;
    write_protection::write_bytes_with_backup(&project_root, &path, &bytes)?;

    Ok(RagIndexSummary {
        created_at,
        doc_count: index.docs.len(),
        chunk_count: index.chunks.len(),
        model: index.model,
    })
}

fn load_index(project_root: &Path) -> Result<RagIndex, String> {
    ensure_rag_dir(project_root)?;
    let path = index_path(project_root)?;
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read RAG index: {e}"))?;
    bincode::deserialize::<RagIndex>(&bytes)
        .map_err(|e| format!("Failed to parse RAG index: {e}"))
}

fn is_index_stale(project_root: &Path, index: &RagIndex) -> Result<bool, String> {
    let docs = list_docs(project_root)?;
    let enabled: Vec<KnowledgeDoc> = docs.into_iter().filter(|d| d.enabled).collect();
    let current: HashSet<(String, u64)> = enabled
        .iter()
        .map(|d| (d.path.clone(), d.modified_at))
        .collect();
    let indexed: HashSet<(String, u64)> = index
        .docs
        .iter()
        .map(|d| (d.path.clone(), d.modified_at))
        .collect();
    Ok(current != indexed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagHit {
    pub path: String,
    pub score: f32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingContextSection {
    pub kind: String,
    pub source: String,
    pub title: String,
    pub text: String,
    pub score: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritingContextResult {
    pub backend: String,
    pub chapter_id: String,
    pub chapter_title: Option<String>,
    pub query: String,
    pub sections: Vec<WritingContextSection>,
    pub combined_context: String,
    pub warnings: Vec<String>,
}

fn chapter_meta_by_id(index: &ChapterIndex, chapter_id: &str) -> Option<ChapterMeta> {
    index.chapters.iter().find(|chapter| chapter.id == chapter_id).cloned()
}

fn chapter_tail_text(project_root: &Path, chapter_id: &str, max_chars: usize) -> Result<String, String> {
    let path = validate_path(project_root, &format!("chapters/{chapter_id}.txt"))?;
    if !path.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Failed to read chapter content: {e}"))?;
    let chars = content.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(max_chars);
    Ok(chars[start..].iter().collect::<String>())
}

fn latest_summary_by_chapter(summaries: &[SummaryEntry]) -> Vec<SummaryEntry> {
    let mut latest = std::collections::HashMap::<String, SummaryEntry>::new();
    for entry in summaries {
        let replace = latest
            .get(&entry.chapter_id)
            .map(|existing| entry.created_at >= existing.created_at)
            .unwrap_or(true);
        if replace {
            latest.insert(entry.chapter_id.clone(), entry.clone());
        }
    }
    latest.into_values().collect()
}

pub fn get_writing_context(
    project_root: &Path,
    chapter_id: String,
    query: String,
    top_k: usize,
) -> Result<WritingContextResult, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;

    let index = read_chapter_index(&project_root)?;
    let chapter_meta = chapter_meta_by_id(&index, &chapter_id)
        .ok_or_else(|| format!("Chapter not found: {chapter_id}"))?;

    let mut warnings = Vec::new();
    let mut sections = Vec::new();
    let backend = normalize_embedding_backend(&load_config(&project_root)?.embedding_backend)?;

    let chapter_tail = chapter_tail_text(&project_root, &chapter_id, 1800)?;
    if !chapter_tail.trim().is_empty() {
        sections.push(WritingContextSection {
            kind: "chapter-tail".to_string(),
            source: format!("chapters/{chapter_id}.txt"),
            title: "当前章节末尾".to_string(),
            text: chapter_tail,
            score: None,
        });
    }

    let summaries = summary::load_summaries(&project_root)?;
    let latest_summaries = latest_summary_by_chapter(&summaries);
    let mut ordered_chapters = index.chapters.clone();
    ordered_chapters.sort_by_key(|chapter| chapter.order);
    let current_order = chapter_meta.order;
    let recent_summary_sections = ordered_chapters
        .into_iter()
        .filter(|chapter| chapter.order <= current_order)
        .filter_map(|chapter| {
            latest_summaries
                .iter()
                .find(|entry| entry.chapter_id == chapter.id)
                .map(|entry| WritingContextSection {
                    kind: "summary".to_string(),
                    source: "summaries.json".to_string(),
                    title: format!("章节摘要 · {}", chapter.title),
                    text: entry.summary.clone(),
                    score: None,
                })
        })
        .rev()
        .take(4)
        .collect::<Vec<_>>();
    sections.extend(recent_summary_sections.into_iter().rev());

    let trimmed_query = query.trim().to_string();
    if !trimmed_query.is_empty() && backend != "disabled" {
        match search(&project_root, &trimmed_query, top_k.max(1)) {
            Ok(hits) => {
                for hit in hits {
                    sections.push(WritingContextSection {
                        kind: "retrieved".to_string(),
                        source: hit.path.clone(),
                        title: format!("知识检索 · {}", hit.path),
                        text: hit.text,
                        score: Some(hit.score),
                    });
                }
            }
            Err(error) => warnings.push(error),
        }
    } else if backend == "disabled" {
        warnings.push("当前项目已禁用 embedding 检索，仅注入章节上下文与摘要。".to_string());
    }

    let combined_context = sections
        .iter()
        .map(|section| {
            let mut header = format!("## {}", section.title);
            if let Some(score) = section.score {
                header.push_str(&format!(" (score={score:.3})"));
            }
            format!("{header}\n来源：{}\n\n{}", section.source, section.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    Ok(WritingContextResult {
        backend,
        chapter_id,
        chapter_title: Some(chapter_meta.title),
        query: trimmed_query,
        sections,
        combined_context,
        warnings,
    })
}

pub fn search(project_root: &Path, query: &str, top_k: usize) -> Result<Vec<RagHit>, String> {
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    ensure_knowledge_dir(&project_root)?;
    ensure_rag_dir(&project_root)?;

    let mut index = if index_path(&project_root)?.exists() {
        load_index(&project_root)?
    } else {
        let _ = build_index(&project_root)?;
        load_index(&project_root)?
    };

    if is_index_stale(&project_root, &index)? {
        let _ = build_index(&project_root)?;
        index = load_index(&project_root)?;
    }

    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let q_emb = embed_texts(&project_root, &[q.to_string()], false)?;
    let Some(first) = q_emb.into_iter().next() else {
        return Ok(Vec::new());
    };
    let (q_vec, q_norm) = normalize_embedding(first);
    if q_norm == 0.0 {
        return Ok(Vec::new());
    }

    let mut scored: Vec<(f32, &RagChunk)> = index
        .chunks
        .iter()
        .map(|c| {
            let dot = c
                .embedding
                .iter()
                .zip(q_vec.iter())
                .map(|(a, b)| a * b)
                .sum::<f32>();
            (dot, c)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut out = Vec::new();
    for (score, chunk) in scored.into_iter().take(top_k.max(1)) {
        out.push(RagHit {
            path: chunk.source_path.clone(),
            score,
            text: chunk.text.clone(),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_project(label: &str) -> PathBuf {
        let root = unique_temp_project_dir(label);
        fs::create_dir_all(root.join(".creatorai")).unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join(".creatorai/config.json"), "{\n  \"project\": \"test\"\n}\n").unwrap();
        fs::write(root.join("chapters/index.json"), "[]\n").unwrap();
        root
    }

    fn create_story_project(label: &str) -> PathBuf {
        let root = unique_temp_project_dir(label);
        fs::create_dir_all(root.join(".creatorai")).unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::create_dir_all(root.join("knowledge")).unwrap();
        fs::write(root.join(".creatorai/config.json"), "{\n  \"project\": \"story\"\n}\n").unwrap();
        fs::write(
            root.join("chapters/index.json"),
            r#"{
  "chapters": [
    {"id":"chapter_001","title":"第一章","order":1,"created":1,"updated":1,"wordCount":12},
    {"id":"chapter_002","title":"第二章","order":2,"created":2,"updated":2,"wordCount":20}
  ],
  "nextId": 3
}
"#,
        )
        .unwrap();
        fs::write(root.join("chapters/chapter_001.txt"), "第一章正文。\n主角第一次进入旧城区。").unwrap();
        fs::write(
            root.join("chapters/chapter_002.txt"),
            "第二章正文。\n他在雨夜里再次看见那个熟悉的背影，心里忽然一沉。",
        )
        .unwrap();
        fs::write(
            root.join("summaries.json"),
            r#"[
  {"chapterId":"chapter_001","summary":"第一章：主角进入旧城区，埋下陌生人线索。","createdAt":10},
  {"chapterId":"chapter_002","summary":"第二章：主角在雨夜重见旧人，警觉升级。","createdAt":20}
]
"#,
        )
        .unwrap();
        root
    }

    #[test]
    fn rag_config_missing_embedding_backend_uses_default_local() {
        let root = create_test_project("legacy-config");
        let rag_dir = root.join(".creatorai/rag");
        fs::create_dir_all(&rag_dir).unwrap();
        fs::write(
            rag_dir.join("config.json"),
            "{\n  \"schemaVersion\": 1,\n  \"enabledPaths\": [\"knowledge/story.md\"]\n}\n",
        )
        .unwrap();

        let config = load_config(&root).unwrap();
        assert_eq!(config.embedding_backend, "local");
        assert_eq!(config.enabled_paths, vec!["knowledge/story.md".to_string()]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn embedding_status_reports_missing_model_without_error() {
        let root = create_test_project("missing-model");

        let status = embedding_status(&root).unwrap();
        assert_eq!(status.backend, "local");
        assert!(!status.installed);
        assert!(status.requires_download);
        assert_eq!(status.source, "missing");
        assert!(status.message.unwrap_or_default().contains("未安装 embedding 模型"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn embedding_status_reports_partial_local_model_directory() {
        let root = create_test_project("partial-local");
        let model_dir = root.join(LOCAL_EMBEDDING_MODEL_DIR);
        fs::create_dir_all(&model_dir).unwrap();
        fs::write(model_dir.join("tokenizer.json"), "{}").unwrap();

        let status = embedding_status(&root).unwrap();
        assert!(!status.installed);
        assert!(status.requires_download);
        assert_eq!(status.source, "local-files");
        assert!(status
            .message
            .unwrap_or_default()
            .contains("本地嵌入模型目录缺少必要文件"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn update_rag_config_persists_api_backend_without_key() {
        let root = create_test_project("api-config");

        let saved = update_rag_config(
            &root,
            RagConfigUpdate {
                embedding_backend: "api".to_string(),
                api_base_url: "https://example.com/v1".to_string(),
                api_model: "embed-small".to_string(),
                api_key: None,
            },
        )
        .unwrap();

        assert_eq!(saved.embedding_backend, "api");
        assert_eq!(saved.api_base_url, "https://example.com/v1");
        assert_eq!(saved.api_model, "embed-small");
        assert!(!saved.has_api_key);

        let loaded = get_rag_config(&root).unwrap();
        assert_eq!(loaded.embedding_backend, "api");
        assert_eq!(loaded.api_model, "embed-small");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_writing_context_degrades_without_embedding_hits() {
        let root = create_story_project("writing-context");
        update_rag_config(
            &root,
            RagConfigUpdate {
                embedding_backend: "disabled".to_string(),
                api_base_url: String::new(),
                api_model: String::new(),
                api_key: None,
            },
        )
        .unwrap();

        let context = get_writing_context(
            &root,
            "chapter_002".to_string(),
            "主角再次遇见旧人".to_string(),
            4,
        )
        .unwrap();

        assert_eq!(context.backend, "disabled");
        assert_eq!(context.chapter_id, "chapter_002");
        assert!(context
            .sections
            .iter()
            .any(|section| section.kind == "chapter-tail" && section.text.contains("雨夜里再次看见")));
        assert!(context
            .sections
            .iter()
            .any(|section| section.kind == "summary" && section.text.contains("警觉升级")));
        assert!(context
            .warnings
            .iter()
            .any(|warning| warning.contains("已禁用 embedding 检索")));
        assert!(context.combined_context.contains("当前章节末尾"));

        let _ = fs::remove_dir_all(root);
    }
}
