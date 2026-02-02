use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::write_protection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub created: u64,
    pub updated: u64,
    pub version: String,
    pub settings: ProjectSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettings {
    #[serde(rename = "autoSave")]
    pub auto_save: bool,
    #[serde(rename = "autoSaveInterval")]
    pub auto_save_interval: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterMeta {
    pub id: String,
    pub title: String,
    pub order: u32,
    pub created: u64,
    pub updated: u64,
    #[serde(rename = "wordCount")]
    pub word_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterIndex {
    pub chapters: Vec<ChapterMeta>,
    #[serde(rename = "nextId")]
    pub next_id: u32,
}

const PROJECT_VERSION: &str = "1.0";

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn config_path(project_root: &Path) -> PathBuf {
    project_root.join(".creatorai").join("config.json")
}

fn chapters_index_path(project_root: &Path) -> PathBuf {
    project_root.join("chapters").join("index.json")
}

fn ensure_project_root(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() {
        return Err("Project path is empty".to_string());
    }
    if path.exists() {
        let meta =
            fs::symlink_metadata(path).map_err(|e| format!("Failed to stat project path: {e}"))?;
        if !meta.file_type().is_dir() {
            return Err("Project path is not a directory".to_string());
        }
    }
    Ok(())
}

fn write_json_pretty_create_new<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("Serialize JSON failed: {e}"))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("Failed to create '{}': {e}", path.display()))?;

    use std::io::Write;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write '{}': {e}", path.display()))?;
    file.write_all(b"\n")
        .map_err(|e| format!("Failed to write '{}': {e}", path.display()))?;
    Ok(())
}

fn write_json_pretty_overwrite<T: Serialize>(
    project_root: &Path,
    path: &Path,
    value: &T,
) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("Serialize JSON failed: {e}"))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    write_protection::write_string_with_backup(project_root, path, &format!("{content}\n"))?;
    Ok(())
}

fn read_project_config(project_root: &Path) -> Result<ProjectConfig, String> {
    let path = config_path(project_root);
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read config.json: {e}"))?;
    serde_json::from_slice::<ProjectConfig>(&bytes)
        .map_err(|e| format!("Failed to parse config.json: {e}"))
}

fn validate_project_structure(project_root: &Path) -> Result<(), String> {
    let cfg = config_path(project_root);
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    let index = chapters_index_path(project_root);
    if !index.exists() {
        return Err("Not a valid project: missing chapters/index.json".to_string());
    }
    Ok(())
}

fn create_project_sync(path: String, name: String) -> Result<ProjectConfig, String> {
    let project_root = PathBuf::from(path);
    ensure_project_root(&project_root)?;

    fs::create_dir_all(project_root.join(".creatorai"))
        .map_err(|e| format!("Failed to create .creatorai directory: {e}"))?;
    fs::create_dir_all(project_root.join("chapters"))
        .map_err(|e| format!("Failed to create chapters directory: {e}"))?;

    let cfg_path = config_path(&project_root);
    if cfg_path.exists() {
        return Err("Project already exists (config.json already present)".to_string());
    }
    let idx_path = chapters_index_path(&project_root);
    if idx_path.exists() {
        return Err("Project already exists (chapters/index.json already present)".to_string());
    }
    let summaries_path = project_root.join("summaries.json");
    if summaries_path.exists() {
        return Err("Project already exists (summaries.json already present)".to_string());
    }

    let now = now_unix_seconds()?;
    let config = ProjectConfig {
        name,
        created: now,
        updated: now,
        version: PROJECT_VERSION.to_string(),
        settings: ProjectSettings {
            auto_save: true,
            auto_save_interval: 2000,
        },
    };

    let index = ChapterIndex {
        chapters: Vec::new(),
        next_id: 1,
    };

    write_json_pretty_create_new(&cfg_path, &config)?;
    write_json_pretty_create_new(&idx_path, &index)?;
    fs::write(&summaries_path, "[]\n")
        .map_err(|e| format!("Failed to write '{}': {e}", summaries_path.display()))?;

    Ok(config)
}

fn open_project_sync(path: String) -> Result<ProjectConfig, String> {
    let project_root = PathBuf::from(path);
    ensure_project_root(&project_root)?;
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }

    validate_project_structure(&project_root)?;
    let summaries_path = project_root.join("summaries.json");
    if !summaries_path.exists() {
        let _ = fs::write(&summaries_path, "[]\n");
    }
    read_project_config(&project_root)
}

fn get_project_info_sync(path: String) -> Result<ProjectConfig, String> {
    let project_root = PathBuf::from(path);
    ensure_project_root(&project_root)?;
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }
    let cfg = config_path(&project_root);
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    read_project_config(&project_root)
}

fn save_project_config_sync(path: String, mut config: ProjectConfig) -> Result<(), String> {
    let project_root = PathBuf::from(path);
    ensure_project_root(&project_root)?;
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }
    let project_root = project_root
        .canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;

    let cfg_path = config_path(&project_root);
    if !cfg_path.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }

    config.updated = now_unix_seconds()?;
    write_json_pretty_overwrite(&project_root, &cfg_path, &config)?;
    Ok(())
}

#[tauri::command]
pub async fn create_project(path: String, name: String) -> Result<ProjectConfig, String> {
    tauri::async_runtime::spawn_blocking(move || create_project_sync(path, name))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn open_project(path: String) -> Result<ProjectConfig, String> {
    tauri::async_runtime::spawn_blocking(move || open_project_sync(path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn get_project_info(path: String) -> Result<ProjectConfig, String> {
    tauri::async_runtime::spawn_blocking(move || get_project_info_sync(path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn save_project_config(path: String, config: ProjectConfig) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_project_config_sync(path, config))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}
