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
    pub offset: Option<i64>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct ReadResult {
    pub content: String,
    pub total_lines: u32,
    pub truncated: bool,
}

fn read_line_strip_newline(
    reader: &mut BufReader<File>,
    buf: &mut String,
    path: &str,
) -> Result<usize, String> {
    buf.clear();
    let bytes_read = match reader.read_line(buf) {
        Ok(n) => n,
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            return Err("Binary files are not supported".to_string());
        }
        Err(e) => return Err(format!("Failed to read file '{}': {e}", path)),
    };
    if bytes_read == 0 {
        return Ok(0);
    }

    if buf.ends_with('\n') {
        buf.pop();
        if buf.ends_with('\r') {
            buf.pop();
        }
    }
    Ok(bytes_read)
}

fn count_total_lines(reader: &mut BufReader<File>, path: &str) -> Result<u64, String> {
    let mut total: u64 = 0;
    let mut line = String::new();
    loop {
        let bytes = read_line_strip_newline(reader, &mut line, path)?;
        if bytes == 0 {
            break;
        }
        total = total.saturating_add(1);
    }
    Ok(total)
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
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).min(DEFAULT_LIMIT);

    let offset = params.offset.unwrap_or(0);

    if offset < 0 {
        let mut reader = BufReader::new(file);
        let total_lines_u64 = count_total_lines(&mut reader, &params.path)?;
        let total_lines = u32::try_from(total_lines_u64).unwrap_or(u32::MAX);

        let tail = if offset == i64::MIN {
            u64::MAX
        } else {
            (-offset) as u64
        };
        let start_index = total_lines_u64.saturating_sub(tail);

        let mut file = reader.into_inner();
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("Failed to seek file '{}': {e}", params.path))?;
        let mut reader = BufReader::new(file);

        let mut content = String::new();
        let mut truncated = total_lines_u64.saturating_sub(start_index) > u64::from(limit);
        let mut collected: u32 = 0;

        let mut line = String::new();
        let mut line_index: u64 = 0;
        while line_index < start_index {
            let bytes = read_line_strip_newline(&mut reader, &mut line, &params.path)?;
            if bytes == 0 {
                break;
            }
            line_index = line_index.saturating_add(1);
        }

        while collected < limit {
            let bytes = read_line_strip_newline(&mut reader, &mut line, &params.path)?;
            if bytes == 0 {
                break;
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
                break;
            }

            if !content.is_empty() {
                content.push('\n');
            }
            content.push_str(&formatted);
            collected = collected.saturating_add(1);
            line_index = line_index.saturating_add(1);
        }

        return Ok(ReadResult {
            content,
            total_lines,
            truncated,
        });
    }

    let offset_u32 = u32::try_from(offset).unwrap_or(0);
    let mut reader = BufReader::new(file);
    let mut content = String::new();
    let mut total_lines: u32 = 0;
    let mut collected: u32 = 0;
    let mut truncated = false;
    let mut collecting = true;

    let mut line = String::new();
    loop {
        let bytes_read = read_line_strip_newline(&mut reader, &mut line, &params.path)?;
        if bytes_read == 0 {
            break;
        }

        let line_index = total_lines;
        total_lines = total_lines.saturating_add(1);

        if line_index < offset_u32 || !collecting {
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
