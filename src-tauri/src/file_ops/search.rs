use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::security::validate_path;

// 参数
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchParams {
    pub query: String,        // 搜索关键词
    pub path: Option<String>, // 搜索范围（默认项目根目录）
}

// 返回
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub content: String, // 匹配行的内容
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | ".git" | ".backup" | "dist")
}

fn looks_binary(sample: &[u8]) -> bool {
    if sample.contains(&0) {
        return true;
    }
    std::str::from_utf8(sample).is_err()
}

fn search_file(
    project_dir: &Path,
    file_path: &Path,
    query: &str,
    out: &mut Vec<SearchMatch>,
    max_matches: usize,
) -> Result<(), String> {
    let mut file = File::open(file_path).map_err(|e| format!("Failed to open file: {e}"))?;

    let mut sample = [0u8; 8192];
    let sample_size = file
        .read(&mut sample)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    if looks_binary(&sample[..sample_size]) {
        return Ok(());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek file: {e}"))?;

    let reader = BufReader::new(file);
    for (idx, line_result) in reader.lines().enumerate() {
        if out.len() >= max_matches {
            break;
        }
        let line = match line_result {
            Ok(l) => l,
            Err(_) => return Ok(()), // treat as binary/invalid utf8
        };
        if !line.contains(query) {
            continue;
        }

        let rel = file_path
            .strip_prefix(project_dir)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        out.push(SearchMatch {
            file: rel,
            line: (idx as u32) + 1,
            content: line,
        });
    }

    Ok(())
}

fn walk_and_search(
    project_dir: &Path,
    start: &Path,
    query: &str,
    out: &mut Vec<SearchMatch>,
    max_matches: usize,
) -> Result<(), String> {
    if out.len() >= max_matches {
        return Ok(());
    }

    let meta = fs::metadata(start).map_err(|e| format!("Failed to stat path: {e}"))?;
    if meta.is_file() {
        return search_file(project_dir, start, query, out, max_matches);
    }

    if !meta.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(start).map_err(|e| format!("Failed to read dir: {e}"))? {
        if out.len() >= max_matches {
            break;
        }
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {e}"))?;
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();

        if is_hidden(&name) {
            continue;
        }

        let path = entry.path();
        let meta = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata: {e}"))?;

        if meta.is_dir() {
            if is_ignored_dir(&name) {
                continue;
            }
            walk_and_search(project_dir, &path, query, out, max_matches)?;
        } else if meta.is_file() {
            search_file(project_dir, &path, query, out, max_matches)?;
        }
    }

    Ok(())
}

// 在项目内搜索关键词（最多 50 个匹配）
pub fn file_search(project_dir: String, params: SearchParams) -> Result<SearchResult, String> {
    let project_dir_path = PathBuf::from(&project_dir);
    let scope_rel = params.path.unwrap_or_default();
    let scope_path = validate_path(&project_dir_path, &scope_rel)?;

    let canonical_project_dir =
        std::fs::canonicalize(&project_dir_path).map_err(|e| format!("Invalid project_dir: {e}"))?;

    let mut matches = Vec::new();
    walk_and_search(
        &canonical_project_dir,
        &scope_path,
        &params.query,
        &mut matches,
        50,
    )?;

    Ok(SearchResult { matches })
}
