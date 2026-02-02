use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;

#[derive(Debug, Deserialize)]
pub struct WriteParams {
    pub path: String,
    pub content: String,
}

pub fn write_file(project_dir: &Path, params: WriteParams) -> Result<(), String> {
    let project_root = project_dir
        .canonicalize()
        .map_err(|e| format!("Invalid project_dir: {e}"))?;

    let full_path = validate_path(&project_root, &params.path)?;

    if full_path.exists() {
        let meta = fs::symlink_metadata(&full_path)
            .map_err(|e| format!("Failed to stat '{}': {e}", params.path))?;
        if meta.file_type().is_dir() {
            return Err(format!("'{}' is a directory", params.path));
        }

        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Failed to read system time: {e}"))?
            .as_millis();

        let relative = full_path
            .strip_prefix(&project_root)
            .map_err(|_| "Failed to compute relative path".to_string())?;

        let backup_path = project_root
            .join(".backup")
            .join(ts.to_string())
            .join(relative);

        if let Some(parent) = backup_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup directory: {e}"))?;
        }

        fs::copy(&full_path, &backup_path)
            .map_err(|e| format!("Failed to backup '{}': {e}", params.path))?;
    }

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
    }

    fs::write(&full_path, params.content)
        .map_err(|e| format!("Failed to write '{}': {e}", params.path))?;

    Ok(())
}
