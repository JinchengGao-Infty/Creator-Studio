use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn now_millis() -> Result<u128, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to read system time: {e}"))?
        .as_millis()
        .try_into()
        .map_err(|_| "System time overflowed u128".to_string())
}

pub fn backup_existing_file(project_root: &Path, full_path: &Path) -> Result<Option<PathBuf>, String> {
    if !full_path.exists() {
        return Ok(None);
    }

    let meta = fs::symlink_metadata(full_path)
        .map_err(|e| format!("Failed to stat '{}': {e}", full_path.display()))?;
    if meta.file_type().is_dir() {
        return Err(format!("'{}' is a directory", full_path.display()));
    }

    let relative = full_path
        .strip_prefix(project_root)
        .map_err(|_| "Failed to compute relative path".to_string())?;

    let ts = now_millis()?;
    let backup_path = project_root
        .join(".backup")
        .join(ts.to_string())
        .join(relative);

    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create backup directory '{}': {e}", parent.display()))?;
    }

    fs::copy(full_path, &backup_path)
        .map_err(|e| format!("Failed to backup '{}': {e}", full_path.display()))?;

    Ok(Some(backup_path))
}

pub fn restore_backup(full_path: &Path, backup_path: &Path) -> Result<(), String> {
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
    }

    fs::copy(backup_path, full_path)
        .map_err(|e| format!("Failed to restore '{}': {e}", full_path.display()))?;
    Ok(())
}

fn temp_path_for(full_path: &Path) -> Result<PathBuf, String> {
    let ts = now_millis()?;
    let file_name = full_path
        .file_name()
        .ok_or_else(|| format!("Invalid file name: '{}'", full_path.display()))?;
    let tmp_name = format!("{}.tmp.{ts}", file_name.to_string_lossy());
    Ok(full_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(tmp_name))
}

pub fn atomic_write_bytes(full_path: &Path, content: &[u8], rollback_backup: Option<&Path>) -> Result<(), String> {
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory '{}': {e}", parent.display()))?;
    }

    let tmp_path = temp_path_for(full_path)?;
    fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temp file '{}': {e}", tmp_path.display()))?;

    match fs::rename(&tmp_path, full_path) {
        Ok(_) => Ok(()),
        Err(rename_err) => {
            // On Windows, rename fails if the destination exists. Fall back to remove+rename.
            if full_path.exists() {
                if let Err(remove_err) = fs::remove_file(full_path) {
                    let _ = fs::remove_file(&tmp_path);
                    return Err(format!(
                        "Failed to replace '{}': {rename_err}; also failed to remove old file: {remove_err}",
                        full_path.display()
                    ));
                }

                match fs::rename(&tmp_path, full_path) {
                    Ok(_) => Ok(()),
                    Err(e2) => {
                        let _ = fs::remove_file(&tmp_path);
                        if let Some(backup) = rollback_backup {
                            let _ = restore_backup(full_path, backup);
                        }
                        Err(format!("Failed to replace '{}': {e2}", full_path.display()))
                    }
                }
            } else {
                let _ = fs::remove_file(&tmp_path);
                Err(format!("Failed to move file into place '{}': {rename_err}", full_path.display()))
            }
        }
    }
}

pub fn write_string_with_backup(
    project_root: &Path,
    full_path: &Path,
    content: &str,
) -> Result<Option<PathBuf>, String> {
    let backup = backup_existing_file(project_root, full_path)?;
    atomic_write_bytes(full_path, content.as_bytes(), backup.as_deref())?;
    Ok(backup)
}

