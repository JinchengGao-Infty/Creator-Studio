use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::security::validate_path;

// 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListParams {
    pub path: Option<String>, // 相对路径（默认项目根目录）
}

// 返回
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListResult {
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64, // Unix timestamp
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | ".git" | ".backup" | "dist")
}

fn modified_ts(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn list_dir(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read dir: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy().to_string();

        if is_hidden(&name) {
            continue;
        }

        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {e}"))?;
        let is_dir = meta.is_dir();

        if is_dir && is_ignored_dir(&name) {
            continue;
        }

        entries.push(FileEntry {
            name,
            is_dir,
            size: meta.len(),
            modified: modified_ts(&meta),
        });

        if entries.len() >= 100 {
            break;
        }
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

// 列出目录下的文件（最多 100 条，忽略隐藏文件与常见大目录）
pub fn file_list(project_dir: String, params: ListParams) -> Result<ListResult, String> {
    let project_dir_path = PathBuf::from(project_dir);
    let relative = params.path.unwrap_or_default();
    let full_path = validate_path(&project_dir_path, &relative)?;

    let meta = fs::metadata(&full_path).map_err(|e| format!("Failed to stat path: {e}"))?;
    if !meta.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    Ok(ListResult {
        entries: list_dir(&full_path)?,
    })
}

