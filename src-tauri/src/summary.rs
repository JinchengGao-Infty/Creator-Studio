use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::security::validate_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SummaryEntry {
    pub chapter_id: String,
    pub summary: String,
    pub created_at: u64,
}

fn now_unix_seconds() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|e| format!("Failed to read system time: {e}"))
}

fn ensure_project_exists(project_root: &Path) -> Result<(), String> {
    if project_root.as_os_str().is_empty() {
        return Err("Project path is empty".to_string());
    }
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

pub fn summaries_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, "summaries.json")
}

pub fn load_summaries(project_root: &Path) -> Result<Vec<SummaryEntry>, String> {
    ensure_project_exists(project_root)?;
    let path = summaries_path(project_root)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read summaries.json: {e}"))?;
    serde_json::from_slice::<Vec<SummaryEntry>>(&bytes)
        .map_err(|e| format!("Failed to parse summaries.json: {e}"))
}

pub fn save_summary(project_root: &Path, chapter_id: String, summary: String) -> Result<SummaryEntry, String> {
    ensure_project_exists(project_root)?;
    if chapter_id.trim().is_empty() {
        return Err("chapterId is empty".to_string());
    }
    if summary.trim().is_empty() {
        return Err("summary is empty".to_string());
    }

    let mut summaries = load_summaries(project_root)?;
    let entry = SummaryEntry {
        chapter_id,
        summary,
        created_at: now_unix_seconds()?,
    };
    summaries.push(entry.clone());

    let path = summaries_path(project_root)?;
    let json = serde_json::to_string_pretty(&summaries)
        .map_err(|e| format!("Serialize summaries.json failed: {e}"))?;
    fs::write(path, format!("{json}\n")).map_err(|e| format!("Failed to write summaries.json: {e}"))?;

    Ok(entry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(prefix: &str) -> Self {
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let path = std::env::temp_dir().join(format!("{prefix}-{ts}"));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn create_min_project(root: &Path) {
        fs::create_dir_all(root.join(".creatorai")).unwrap();
        fs::create_dir_all(root.join("chapters")).unwrap();
        fs::write(root.join(".creatorai/config.json"), "{}\n").unwrap();
        fs::write(root.join("chapters/index.json"), "{ \"chapters\": [], \"nextId\": 1 }\n").unwrap();
    }

    #[test]
    fn save_summary_creates_file_and_appends() {
        let temp = TempDir::new("creatorai-v2-summary");
        create_min_project(&temp.path);

        let entry1 = save_summary(
            &temp.path,
            "chapter_001".to_string(),
            "第一章：主角出场，埋下悬念。".to_string(),
        )
        .expect("save summary 1");
        assert_eq!(entry1.chapter_id, "chapter_001");

        let entry2 = save_summary(
            &temp.path,
            "chapter_001".to_string(),
            "续写：主角遇到神秘老人。".to_string(),
        )
        .expect("save summary 2");
        assert_eq!(entry2.chapter_id, "chapter_001");

        let loaded = load_summaries(&temp.path).expect("load summaries");
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].summary, "第一章：主角出场，埋下悬念。");
        assert_eq!(loaded[1].summary, "续写：主角遇到神秘老人。");
    }
}

