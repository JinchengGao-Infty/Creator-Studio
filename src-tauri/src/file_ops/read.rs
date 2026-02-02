use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use crate::security::validate_path;

// 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadParams {
    pub path: String,           // 相对路径
    pub offset: Option<u32>,    // 起始行号（0-based）
    pub limit: Option<u32>,     // 读取行数（默认 2000）
}

// 返回
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReadResult {
    pub content: String,    // 文件内容（带行号）
    pub total_lines: u32,   // 文件总行数
    pub truncated: bool,    // 是否被截断
}

fn looks_binary(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return true;
    }
    std::str::from_utf8(sample).is_err()
}

// 读取文件
pub fn file_read(project_dir: String, params: ReadParams) -> Result<ReadResult, String> {
    let project_dir = Path::new(&project_dir);
    let path = validate_path(project_dir, &params.path)?;

    let mut file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;

    // 检测二进制文件，拒绝读取
    let mut sample = [0u8; 8192];
    let sample_size = file
        .read(&mut sample)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if looks_binary(&sample[..sample_size]) {
        return Err("Binary file detected".to_string());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek file: {e}"))?;

    let offset = params.offset.unwrap_or(0) as usize;
    let limit = params.limit.unwrap_or(2000) as usize;

    const MAX_LINE_CHARS: usize = 2000;
    const MAX_BYTES: usize = 50 * 1024;

    let reader = BufReader::new(file);
    let mut content = String::new();
    let mut total_lines: u32 = 0;
    let mut included_lines: usize = 0;
    let mut truncated = false;
    let mut output_bytes: usize = 0;

    for line_result in reader.lines() {
        let mut line = line_result.map_err(|_| "Binary file detected".to_string())?;
        let line_index = total_lines as usize;
        total_lines = total_lines.saturating_add(1);

        if line_index < offset {
            continue;
        }

        if included_lines >= limit {
            truncated = true;
            continue;
        }

        if line.chars().count() > MAX_LINE_CHARS {
            line = line.chars().take(MAX_LINE_CHARS).collect::<String>();
            line.push_str("...");
            truncated = true;
        }

        let formatted = format!("{:05}| {}\n", line_index + 1, line);
        if output_bytes + formatted.len() > MAX_BYTES {
            truncated = true;
            continue;
        }

        output_bytes += formatted.len();
        content.push_str(&formatted);
        included_lines += 1;
    }

    Ok(ReadResult {
        content,
        total_lines,
        truncated,
    })
}

