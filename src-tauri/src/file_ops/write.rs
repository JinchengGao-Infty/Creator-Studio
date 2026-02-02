use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;

// 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteParams {
    pub path: String,     // 相对路径
    pub content: String,  // 文件内容
}

fn unix_timestamp() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to get timestamp: {e}"))
}

// 写入文件内容（会自动备份旧内容）
pub fn file_write(project_dir: String, params: WriteParams) -> Result<(), String> {
    let project_dir_path = Path::new(&project_dir);
    let target_path = validate_path(project_dir_path, &params.path)?;

    // 写入前检查文件是否存在，如果存在则备份
    if target_path.exists() {
        let ts = unix_timestamp()?;
        let backup_base = validate_path(project_dir_path, &format!(".backup/{ts}"))?;
        let backup_path = backup_base.join(&params.path);

        if let Some(parent) = backup_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create backup dir: {e}"))?;
        }

        fs::copy(&target_path, &backup_path).map_err(|e| format!("Failed to backup file: {e}"))?;
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {e}"))?;
    }

    fs::write(&target_path, params.content).map_err(|e| format!("Failed to write file: {e}"))?;
    Ok(())
}

