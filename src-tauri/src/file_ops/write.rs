use serde::Deserialize;
use std::path::Path;

use crate::security::validate_path;
use crate::write_protection;

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

    write_protection::write_string_with_backup(&project_root, &full_path, &params.content)?;

    Ok(())
}
