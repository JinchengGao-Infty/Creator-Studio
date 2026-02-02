use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use crate::security::validate_path;
use crate::write_protection;

#[derive(Debug, Deserialize)]
pub struct AppendParams {
    pub path: String,
    pub content: String,
}

pub fn append_file(project_dir: &Path, params: AppendParams) -> Result<(), String> {
    let project_root = project_dir
        .canonicalize()
        .map_err(|e| format!("Invalid project_dir: {e}"))?;

    let full_path = validate_path(&project_root, &params.path)?;
    let backup_path = write_protection::backup_existing_file(&project_root, &full_path)?;

    let result: Result<(), String> = (|| {
        let needs_newline = if full_path.exists() {
            let meta = fs::symlink_metadata(&full_path)
                .map_err(|e| format!("Failed to stat '{}': {e}", params.path))?;
            if meta.file_type().is_dir() {
                return Err(format!("'{}' is a directory", params.path));
            }

            if meta.len() == 0 {
                false
            } else {
                let mut f = File::open(&full_path)
                    .map_err(|e| format!("Failed to open '{}': {e}", params.path))?;
                f.seek(SeekFrom::End(-1))
                    .map_err(|e| format!("Failed to seek '{}': {e}", params.path))?;
                let mut last = [0u8; 1];
                f.read_exact(&mut last)
                    .map_err(|e| format!("Failed to read '{}': {e}", params.path))?;
                last[0] != b'\n'
            }
        } else {
            false
        };

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
        }

        let mut out = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&full_path)
            .map_err(|e| format!("Failed to open '{}': {e}", params.path))?;

        if needs_newline {
            out.write_all(b"\n")
                .map_err(|e| format!("Failed to append to '{}': {e}", params.path))?;
        }

        out.write_all(params.content.as_bytes())
            .map_err(|e| format!("Failed to append to '{}': {e}", params.path))?;

        Ok(())
    })();

    if result.is_err() {
        if let Some(backup) = backup_path.as_ref() {
            let _ = write_protection::restore_backup(&full_path, backup);
        } else {
            let _ = fs::remove_file(&full_path);
        }
    }

    result
}
