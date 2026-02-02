use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Seek};
use std::path::{Path, PathBuf};

use crate::security::validate_path;

const MAX_MATCHES: usize = 50;
const BINARY_PROBE_BYTES: usize = 4096;

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub query: String,
    pub path: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
}

#[derive(Debug, Serialize)]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub content: String,
}

fn is_ignored_dir_name(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | ".git")
}

fn is_probably_binary(file: &mut File) -> Result<bool, String> {
    let mut probe = vec![0u8; BINARY_PROBE_BYTES];
    let n = file
        .read(&mut probe)
        .map_err(|e| format!("Failed to probe file: {e}"))?;
    Ok(probe[..n].contains(&0u8))
}

fn walk_and_search(
    project_root: &Path,
    root: &Path,
    query: &str,
    matches: &mut Vec<SearchMatch>,
) -> Result<(), String> {
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if matches.len() >= MAX_MATCHES {
            break;
        }
        for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read directory: {e}"))? {
            if matches.len() >= MAX_MATCHES {
                break;
            }
            let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }

            let file_type = entry
                .file_type()
                .map_err(|e| format!("Failed to stat entry '{}': {e}", name))?;
            if file_type.is_symlink() {
                continue;
            }

            let path = entry.path();
            if file_type.is_dir() {
                if is_ignored_dir_name(&name) {
                    continue;
                }
                stack.push(path);
                continue;
            }

            if !file_type.is_file() {
                continue;
            }

            let mut f = match File::open(&path) {
                Ok(f) => f,
                Err(_) => continue,
            };
            if is_probably_binary(&mut f)? {
                continue;
            }
            if f.rewind().is_err() {
                continue;
            }

            let mut reader = BufReader::new(f);
            let mut line_no: u32 = 0;
            let mut line = String::new();
            loop {
                line.clear();
                let bytes_read = match reader.read_line(&mut line) {
                    Ok(n) => n,
                    Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
                        // Non-UTF8 -> treat as binary and ignore.
                        break;
                    }
                    Err(_) => break,
                };
                if bytes_read == 0 {
                    break;
                }
                line_no = line_no.saturating_add(1);

                if line.contains(query) {
                    let content = line.trim_end_matches(['\n', '\r']).to_string();
                    let rel = path
                        .strip_prefix(project_root)
                        .unwrap_or(&path)
                        .to_string_lossy()
                        .to_string();
                    matches.push(SearchMatch {
                        file: rel,
                        line: line_no,
                        content,
                    });
                    if matches.len() >= MAX_MATCHES {
                        break;
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn search_in_files(project_dir: &Path, params: SearchParams) -> Result<SearchResult, String> {
    let project_root = project_dir
        .canonicalize()
        .map_err(|e| format!("Invalid project_dir: {e}"))?;

    let relative = params.path.unwrap_or_else(|| "".to_string());
    let full_path = validate_path(&project_root, &relative)?;

    let meta = fs::symlink_metadata(&full_path)
        .map_err(|e| format!("Failed to stat '{}': {e}", relative))?;
    if !meta.file_type().is_dir() {
        return Err(format!("'{}' is not a directory", relative));
    }

    let mut matches = Vec::new();
    walk_and_search(&project_root, &full_path, &params.query, &mut matches)?;

    Ok(SearchResult { matches })
}
