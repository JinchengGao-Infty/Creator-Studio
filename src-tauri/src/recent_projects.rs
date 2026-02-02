use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProjectsFile {
    pub recent: Vec<RecentProject>,
}

impl Default for RecentProjectsFile {
    fn default() -> Self {
        Self { recent: Vec::new() }
    }
}

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn get_config_dir() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("CREATORAI_CONFIG_DIR") {
        let config_dir = PathBuf::from(dir);
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
        }
        return Ok(config_dir);
    }

    let home = dirs::home_dir().ok_or("Cannot find home directory")?;
    let config_dir = home.join(".creatorai");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    }
    Ok(config_dir)
}

fn get_recent_path() -> Result<PathBuf, String> {
    Ok(get_config_dir()?.join("recent.json"))
}

fn load_recent_file() -> Result<RecentProjectsFile, String> {
    let path = get_recent_path()?;
    if !path.exists() {
        return Ok(RecentProjectsFile::default());
    }
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

fn save_recent_file(file: &RecentProjectsFile) -> Result<(), String> {
    let path = get_recent_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_projects() -> Result<Vec<RecentProject>, String> {
    let mut file = load_recent_file()?;
    file.recent.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(file.recent)
}

#[tauri::command]
pub fn add_recent_project(name: String, path: String) -> Result<(), String> {
    let name = name.trim().to_string();
    let path = path.trim().to_string();
    if name.is_empty() {
        return Err("Project name is empty".to_string());
    }
    if path.is_empty() {
        return Err("Project path is empty".to_string());
    }

    let mut file = load_recent_file()?;
    let now = now_unix_seconds()?;

    if let Some(item) = file.recent.iter_mut().find(|p| p.path == path) {
        item.name = name;
        item.last_opened = now;
    } else {
        file.recent.push(RecentProject {
            name,
            path,
            last_opened: now,
        });
    }

    file.recent.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    save_recent_file(&file)
}

