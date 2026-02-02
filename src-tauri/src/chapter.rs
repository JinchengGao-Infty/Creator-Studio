use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::project::{ChapterIndex, ChapterMeta};
use crate::security::validate_path;

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn count_words(content: &str) -> u32 {
    content.chars().filter(|c| !c.is_whitespace()).count() as u32
}

fn validate_chapter_id(chapter_id: &str) -> Result<(), String> {
    if !chapter_id.starts_with("chapter_") {
        return Err("Invalid chapter_id (expected 'chapter_XXX')".to_string());
    }
    let suffix = &chapter_id["chapter_".len()..];
    if suffix.is_empty() || !suffix.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid chapter_id (expected digits after 'chapter_')".to_string());
    }
    Ok(())
}

fn read_index(project_root: &Path) -> Result<ChapterIndex, String> {
    let index_path = validate_path(project_root, "chapters/index.json")?;
    let bytes =
        fs::read(&index_path).map_err(|e| format!("Failed to read chapters/index.json: {e}"))?;
    serde_json::from_slice::<ChapterIndex>(&bytes)
        .map_err(|e| format!("Failed to parse chapters/index.json: {e}"))
}

fn write_index(project_root: &Path, index: &ChapterIndex) -> Result<(), String> {
    let index_path = validate_path(project_root, "chapters/index.json")?;
    let json =
        serde_json::to_string_pretty(index).map_err(|e| format!("Serialize JSON failed: {e}"))?;
    fs::write(index_path, format!("{json}\n"))
        .map_err(|e| format!("Failed to write chapters/index.json: {e}"))?;
    Ok(())
}

fn ensure_project_exists(project_root: &Path) -> Result<(), String> {
    if !project_root.exists() {
        return Err("Project path does not exist".to_string());
    }
    let meta = fs::symlink_metadata(project_root)
        .map_err(|e| format!("Failed to stat project path: {e}"))?;
    if !meta.file_type().is_dir() {
        return Err("Project path is not a directory".to_string());
    }

    // Validate expected structure
    let cfg = validate_path(project_root, ".creatorai/config.json")?;
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    let index = validate_path(project_root, "chapters/index.json")?;
    if !index.exists() {
        return Err("Not a valid project: missing chapters/index.json".to_string());
    }
    Ok(())
}

fn chapter_txt_relative_path(chapter_id: &str) -> String {
    format!("chapters/{chapter_id}.txt")
}

fn list_chapters_sync(project_path: String) -> Result<Vec<ChapterMeta>, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut index = read_index(&project_root)?;
    index.chapters.sort_by_key(|c| c.order);
    Ok(index.chapters)
}

fn create_chapter_sync(project_path: String, title: String) -> Result<ChapterMeta, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut index = read_index(&project_root)?;

    let chapter_id = format!("chapter_{:03}", index.next_id);
    if index.chapters.iter().any(|c| c.id == chapter_id) {
        return Err("Chapter id already exists in index.json".to_string());
    }

    let relative = chapter_txt_relative_path(&chapter_id);
    let chapter_path = validate_path(&project_root, &relative)?;
    if chapter_path.exists() {
        return Err("Chapter file already exists".to_string());
    }

    if let Some(parent) = chapter_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create chapters directory: {e}"))?;
    }

    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&chapter_path)
        .map_err(|e| format!("Failed to create chapter file: {e}"))?;

    let now = now_unix_seconds()?;
    let order = index
        .chapters
        .iter()
        .map(|c| c.order)
        .max()
        .unwrap_or(0)
        .saturating_add(1);

    let meta = ChapterMeta {
        id: chapter_id,
        title,
        order,
        created: now,
        updated: now,
        word_count: 0,
    };

    index.chapters.push(meta.clone());
    index.next_id = index.next_id.saturating_add(1);
    write_index(&project_root, &index)?;

    Ok(meta)
}

pub(crate) fn create_chapter_with_content_sync(
    project_path: String,
    title: String,
    content: String,
) -> Result<ChapterMeta, String> {
    let created = create_chapter_sync(project_path.clone(), title)?;
    save_chapter_content_sync(project_path, created.id, content)
}

fn get_chapter_content_sync(project_path: String, chapter_id: String) -> Result<String, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;
    validate_chapter_id(&chapter_id)?;

    let relative = chapter_txt_relative_path(&chapter_id);
    let chapter_path = validate_path(&project_root, &relative)?;
    if !chapter_path.exists() {
        return Err("Chapter file does not exist".to_string());
    }

    fs::read_to_string(&chapter_path).map_err(|e| format!("Failed to read chapter content: {e}"))
}

fn save_chapter_content_sync(
    project_path: String,
    chapter_id: String,
    content: String,
) -> Result<ChapterMeta, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;
    validate_chapter_id(&chapter_id)?;

    let mut index = read_index(&project_root)?;
    let Some(meta) = index.chapters.iter_mut().find(|c| c.id == chapter_id) else {
        return Err("Chapter not found".to_string());
    };

    let relative = chapter_txt_relative_path(&meta.id);
    let chapter_path = validate_path(&project_root, &relative)?;
    if !chapter_path.exists() {
        return Err("Chapter file does not exist".to_string());
    }

    fs::write(&chapter_path, content.as_bytes())
        .map_err(|e| format!("Failed to write chapter content: {e}"))?;

    let now = now_unix_seconds()?;
    meta.updated = now;
    meta.word_count = count_words(&content);

    let updated_meta = meta.clone();
    write_index(&project_root, &index)?;
    Ok(updated_meta)
}

fn rename_chapter_sync(
    project_path: String,
    chapter_id: String,
    new_title: String,
) -> Result<ChapterMeta, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;
    validate_chapter_id(&chapter_id)?;

    let mut index = read_index(&project_root)?;
    let Some(meta) = index.chapters.iter_mut().find(|c| c.id == chapter_id) else {
        return Err("Chapter not found".to_string());
    };

    let now = now_unix_seconds()?;
    meta.title = new_title;
    meta.updated = now;

    let updated_meta = meta.clone();
    write_index(&project_root, &index)?;
    Ok(updated_meta)
}

fn delete_chapter_sync(project_path: String, chapter_id: String) -> Result<(), String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;
    validate_chapter_id(&chapter_id)?;

    let mut index = read_index(&project_root)?;
    let before = index.chapters.len();
    index.chapters.retain(|c| c.id != chapter_id);
    if index.chapters.len() == before {
        return Err("Chapter not found".to_string());
    }

    let relative = chapter_txt_relative_path(&chapter_id);
    let chapter_path = validate_path(&project_root, &relative)?;
    match fs::remove_file(&chapter_path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("Failed to delete chapter file: {e}")),
    }

    // Recompute order for remaining chapters
    index.chapters.sort_by_key(|c| c.order);
    let now = now_unix_seconds()?;
    for (i, ch) in index.chapters.iter_mut().enumerate() {
        let new_order = (i + 1) as u32;
        if ch.order != new_order {
            ch.order = new_order;
            ch.updated = now;
        }
    }

    write_index(&project_root, &index)?;
    Ok(())
}

fn reorder_chapters_sync(
    project_path: String,
    chapter_ids: Vec<String>,
) -> Result<Vec<ChapterMeta>, String> {
    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    if chapter_ids.is_empty() {
        return Err("chapter_ids is empty".to_string());
    }
    for id in &chapter_ids {
        validate_chapter_id(id)?;
    }

    let mut index = read_index(&project_root)?;
    if chapter_ids.len() != index.chapters.len() {
        return Err("chapter_ids must include all chapters".to_string());
    }

    let unique: HashSet<&str> = chapter_ids.iter().map(|s| s.as_str()).collect();
    if unique.len() != chapter_ids.len() {
        return Err("chapter_ids contains duplicates".to_string());
    }

    let mut meta_by_id: HashMap<String, ChapterMeta> = index
        .chapters
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();

    let now = now_unix_seconds()?;
    let mut reordered = Vec::with_capacity(chapter_ids.len());
    for (i, id) in chapter_ids.iter().enumerate() {
        let Some(mut meta) = meta_by_id.remove(id) else {
            return Err(format!("Unknown chapter id: {id}"));
        };
        let new_order = (i + 1) as u32;
        if meta.order != new_order {
            meta.order = new_order;
            meta.updated = now;
        }
        reordered.push(meta);
    }

    if !meta_by_id.is_empty() {
        return Err("chapter_ids does not match existing chapters".to_string());
    }

    index.chapters = reordered.clone();
    write_index(&project_root, &index)?;

    index.chapters.sort_by_key(|c| c.order);
    Ok(index.chapters)
}

#[tauri::command]
pub async fn list_chapters(project_path: String) -> Result<Vec<ChapterMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || list_chapters_sync(project_path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn create_chapter(project_path: String, title: String) -> Result<ChapterMeta, String> {
    tauri::async_runtime::spawn_blocking(move || create_chapter_sync(project_path, title))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn get_chapter_content(
    project_path: String,
    chapter_id: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || get_chapter_content_sync(project_path, chapter_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn save_chapter_content(
    project_path: String,
    chapter_id: String,
    content: String,
) -> Result<ChapterMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        save_chapter_content_sync(project_path, chapter_id, content)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn rename_chapter(
    project_path: String,
    chapter_id: String,
    new_title: String,
) -> Result<ChapterMeta, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_chapter_sync(project_path, chapter_id, new_title)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn delete_chapter(project_path: String, chapter_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_chapter_sync(project_path, chapter_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn reorder_chapters(
    project_path: String,
    chapter_ids: Vec<String>,
) -> Result<Vec<ChapterMeta>, String> {
    tauri::async_runtime::spawn_blocking(move || reorder_chapters_sync(project_path, chapter_ids))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}
