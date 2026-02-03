use bincode;
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;
use crate::write_protection;

const KNOWLEDGE_DIR: &str = "knowledge";
const RAG_DIR: &str = ".creatorai/rag";
const RAG_CONFIG_PATH: &str = ".creatorai/rag/config.json";
const RAG_INDEX_PATH: &str = ".creatorai/rag/index.bin";
const RAG_SCHEMA_VERSION: u32 = 1;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RagConfig {
    pub schema_version: u32,
    pub enabled_paths: Vec<String>,
}

impl Default for RagConfig {
    fn default() -> Self {
        Self {
            schema_version: RAG_SCHEMA_VERSION,
            enabled_paths: Vec::new(),
        }
    }
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

fn save_config(project_root: &Path, config: &RagConfig) -> Result<(), String> {
    ensure_rag_dir(project_root)?;
    let path = config_path(project_root)?;
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Serialize rag config failed: {e}"))?;
    write_protection::write_string_with_backup(project_root, &path, &format!("{json}\n"))
        .map(|_| ())
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

fn embedder() -> Result<MutexGuard<'static, TextEmbedding>, String> {
    static EMBEDDER: OnceLock<Result<Mutex<TextEmbedding>, String>> = OnceLock::new();
    let embedder = EMBEDDER.get_or_init(|| {
        let options =
            InitOptions::new(EmbeddingModel::BGESmallZHV15).with_show_download_progress(true);
        TextEmbedding::try_new(options)
            .map(Mutex::new)
            .map_err(|e| format!("Failed to init embedding model: {e}"))
    });
    match embedder {
        Ok(mutex) => mutex
            .lock()
            .map_err(|_| "Embedding model lock poisoned".to_string()),
        Err(err) => Err(err.clone()),
    }
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

    let mut embedder = embedder()?;
    let inputs: Vec<&str> = chunk_texts.iter().map(|s| s.as_str()).collect();
    let embeddings = embedder
        .embed(inputs, None)
        .map_err(|e| format!("Embedding failed: {e}"))?;

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

    let mut embedder = embedder()?;
    let q_emb = embedder
        .embed(vec![q], None)
        .map_err(|e| format!("Embedding failed: {e}"))?;
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
