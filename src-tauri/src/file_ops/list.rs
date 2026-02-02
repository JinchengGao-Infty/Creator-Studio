use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;

const MAX_ENTRIES: usize = 100;

#[derive(Debug, Deserialize)]
pub struct ListParams {
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub entries: Vec<FileEntry>,
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: u64,
}

fn is_ignored_dir_name(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | ".git")
}

fn system_time_to_unix_seconds(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn list_dir(project_dir: &Path, params: ListParams) -> Result<ListResult, String> {
    let relative = params.path.unwrap_or_else(|| "".to_string());
    let full_path = validate_path(project_dir, &relative)?;

    let meta = fs::symlink_metadata(&full_path)
        .map_err(|e| format!("Failed to stat '{}': {e}", relative))?;
    if !meta.file_type().is_dir() {
        return Err(format!("'{}' is not a directory", relative));
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(&full_path)
        .map_err(|e| format!("Failed to read directory '{}': {e}", relative))?
    {
        if entries.len() >= MAX_ENTRIES {
            break;
        }
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to stat directory entry '{}': {e}", name))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() && is_ignored_dir_name(&name) {
            continue;
        }

        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata for '{}': {e}", name))?;

        entries.push(FileEntry {
            name,
            is_dir: file_type.is_dir(),
            size: if file_type.is_file() { meta.len() } else { 0 },
            modified: meta
                .modified()
                .map(system_time_to_unix_seconds)
                .unwrap_or(0),
        });
    }

    Ok(ListResult { entries })
}
