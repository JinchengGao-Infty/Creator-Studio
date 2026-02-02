use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::security::validate_path;

// 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppendParams {
    pub path: String,     // 相对路径
    pub content: String,  // 要追加的内容
}

fn file_ends_with_newline(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;
    let metadata = file
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {e}"))?;
    if metadata.len() == 0 {
        return Ok(true);
    }
    file.seek(SeekFrom::End(-1))
        .map_err(|e| format!("Failed to seek file: {e}"))?;
    let mut byte = [0u8; 1];
    file.read_exact(&mut byte)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    Ok(byte[0] == b'\n')
}

// 追加内容到文件末尾（适合续写）
pub fn file_append(project_dir: String, params: AppendParams) -> Result<(), String> {
    let project_dir_path = Path::new(&project_dir);
    let target_path = validate_path(project_dir_path, &params.path)?;

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {e}"))?;
    }

    let needs_leading_newline = if target_path.exists() {
        !file_ends_with_newline(&target_path)?
    } else {
        false
    };

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target_path)
        .map_err(|e| format!("Failed to open file for append: {e}"))?;

    if needs_leading_newline {
        file.write_all(b"\n")
            .map_err(|e| format!("Failed to write newline: {e}"))?;
    }

    file.write_all(params.content.as_bytes())
        .map_err(|e| format!("Failed to append content: {e}"))?;
    Ok(())
}

