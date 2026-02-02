use std::path::{Component, Path, PathBuf};

pub fn validate_path(project_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let project_dir = project_dir
        .canonicalize()
        .map_err(|e| format!("Invalid project_dir: {e}"))?;

    let raw = Path::new(relative_path);

    if raw.as_os_str().is_empty() {
        return Ok(project_dir);
    }

    if raw.is_absolute() {
        return Err("Absolute paths are not allowed".to_string());
    }

    let mut cleaned = PathBuf::new();
    for component in raw.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err("Absolute paths are not allowed".to_string());
            }
            Component::ParentDir => {
                return Err("Parent directory '..' is not allowed".to_string());
            }
            Component::CurDir => {}
            Component::Normal(part) => cleaned.push(part),
        }
    }

    let joined = project_dir.join(&cleaned);

    // Resolve the deepest existing ancestor so we can detect symlink escapes even when the
    // final path doesn't exist yet (e.g. on writes).
    let mut existing = joined.clone();
    while !existing.exists() {
        let Some(parent) = existing.parent() else {
            break;
        };
        existing = parent.to_path_buf();
        if existing == project_dir {
            break;
        }
    }

    let existing_canon = existing
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path: {e}"))?;

    if !existing_canon.starts_with(&project_dir) {
        return Err("Path escapes project_dir".to_string());
    }

    if existing == joined {
        return Ok(existing_canon);
    }

    let suffix = joined
        .strip_prefix(&existing)
        .map_err(|_| "Failed to normalize path".to_string())?;

    Ok(existing_canon.join(suffix))
}
