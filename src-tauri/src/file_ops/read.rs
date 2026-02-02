use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::Path;

use crate::security::validate_path;

const DEFAULT_LIMIT: u32 = 2000;
const MAX_LINE_CHARS: usize = 2000;
const MAX_OUTPUT_BYTES: usize = 50 * 1024;
const BINARY_PROBE_BYTES: usize = 4096;

#[derive(Debug, Deserialize)]
pub struct ReadParams {
    pub path: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ReadResult {
    pub content: String,
    pub total_lines: u32,
    pub truncated: bool,
}

pub fn read_file(project_dir: &Path, params: ReadParams) -> Result<ReadResult, String> {
    let full_path = validate_path(project_dir, &params.path)?;

    let mut file = File::open(&full_path)
        .map_err(|e| format!("Failed to open file '{}': {e}", params.path))?;

    let mut probe = vec![0u8; BINARY_PROBE_BYTES];
    let n = file
        .read(&mut probe)
        .map_err(|e| format!("Failed to read file '{}': {e}", params.path))?;
    if probe[..n].contains(&0u8) {
        return Err("Binary files are not supported".to_string());
    }

    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek file '{}': {e}", params.path))?;
    let mut reader = BufReader::new(file);

    let offset = params.offset.unwrap_or(0);
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).min(DEFAULT_LIMIT);

    let mut content = String::new();
    let mut total_lines: u32 = 0;
    let mut collected: u32 = 0;
    let mut truncated = false;
    let mut collecting = true;

    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read = match reader.read_line(&mut line) {
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                return Err("Binary files are not supported".to_string());
            }
            Err(e) => return Err(format!("Failed to read file '{}': {e}", params.path)),
        };
        if bytes_read == 0 {
            break;
        }

        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }

        let line_index = total_lines;
        total_lines = total_lines.saturating_add(1);

        if line_index < offset || !collecting {
            continue;
        }

        if collected >= limit {
            truncated = true;
            collecting = false;
            continue;
        }

        let mut display = line.clone();
        if display.chars().count() > MAX_LINE_CHARS {
            display = display.chars().take(MAX_LINE_CHARS).collect::<String>();
            display.push_str("...");
            truncated = true;
        }

        let formatted = format!("{:05}| {}", line_index + 1, display);
        let additional_bytes = formatted.len() + if content.is_empty() { 0 } else { 1 };
        if content.len().saturating_add(additional_bytes) > MAX_OUTPUT_BYTES {
            truncated = true;
            collecting = false;
            continue;
        }

        if !content.is_empty() {
            content.push('\n');
        }
        content.push_str(&formatted);
        collected = collected.saturating_add(1);
    }

    Ok(ReadResult {
        content,
        total_lines,
        truncated,
    })
}
