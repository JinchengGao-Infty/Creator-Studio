use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::Emitter;

use crate::project::ChapterMeta;

const DEFAULT_CHAPTER_PATTERN: &str = "^第.+章.*";
const IMPORT_TXT_PROGRESS_EVENT: &str = "creatorai:importTxtProgress";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterPreview {
    pub title: String,
    #[serde(rename = "wordCount")]
    pub word_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportTxtProgress {
    #[serde(rename = "requestId")]
    pub request_id: String,
    pub total: u32,
    pub completed: u32,
    #[serde(rename = "currentTitle")]
    pub current_title: Option<String>,
}

#[derive(Debug, Clone)]
struct ChapterData {
    title: String,
    content: String,
    word_count: u32,
}

fn count_words(content: &str) -> u32 {
    content.chars().filter(|c| !c.is_whitespace()).count() as u32
}

fn normalize_content(mut content: String) -> String {
    if content.starts_with('\u{feff}') {
        content = content.trim_start_matches('\u{feff}').to_string();
    }
    content
}

fn parse_chapters_from_text(content: &str, pattern: &str) -> Result<Vec<ChapterData>, String> {
    let effective_pattern = if pattern.trim().is_empty() {
        DEFAULT_CHAPTER_PATTERN
    } else {
        pattern
    };

    let regex = RegexBuilder::new(effective_pattern)
        .multi_line(true)
        .build()
        .map_err(|e| format!("Invalid regex pattern: {e}"))?;

    let mut chapters = Vec::new();
    let mut last_end = 0;
    let mut last_title: Option<String> = None;

    for mat in regex.find_iter(content) {
        if let Some(title) = last_title.take() {
            let chapter_content = content[last_end..mat.start()].trim().to_string();
            chapters.push(ChapterData {
                title,
                word_count: count_words(&chapter_content),
                content: chapter_content,
            });
        }

        last_title = Some(mat.as_str().trim().to_string());
        last_end = mat.end();
    }

    if let Some(title) = last_title {
        let chapter_content = content[last_end..].trim().to_string();
        chapters.push(ChapterData {
            title,
            word_count: count_words(&chapter_content),
            content: chapter_content,
        });
    }

    Ok(chapters)
}

fn preview_import_txt_sync(file_path: String, pattern: String) -> Result<Vec<ChapterPreview>, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read txt file: {e}"))?;
    let content = normalize_content(content);
    let chapters = parse_chapters_from_text(&content, &pattern)?;

    Ok(chapters
        .into_iter()
        .map(|c| ChapterPreview {
            title: c.title,
            word_count: c.word_count,
        })
        .collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn preview_import_txt(file_path: String, pattern: String) -> Result<Vec<ChapterPreview>, String> {
    tauri::async_runtime::spawn_blocking(move || preview_import_txt_sync(file_path, pattern))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

fn parse_import_txt_sync(file_path: String, pattern: String) -> Result<Vec<ChapterData>, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read txt file: {e}"))?;
    let content = normalize_content(content);
    parse_chapters_from_text(&content, &pattern)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn import_txt(
    window: tauri::Window,
    project_path: String,
    file_path: String,
    pattern: String,
    request_id: String,
) -> Result<Vec<ChapterMeta>, String> {
    let chapters = tauri::async_runtime::spawn_blocking(move || parse_import_txt_sync(file_path, pattern))
        .await
        .map_err(|e| format!("Task join error: {e}"))??;

    if chapters.is_empty() {
        return Err("No chapters matched the pattern".to_string());
    }

    let total = chapters.len() as u32;
    let _ = window.emit(
        IMPORT_TXT_PROGRESS_EVENT,
        ImportTxtProgress {
            request_id: request_id.clone(),
            total,
            completed: 0,
            current_title: None,
        },
    );

    let mut created = Vec::with_capacity(chapters.len());
    for (index, chapter) in chapters.into_iter().enumerate() {
        let project_path_for_task = project_path.clone();
        let title_for_task = chapter.title.clone();
        let content_for_task = chapter.content;

        let meta = tauri::async_runtime::spawn_blocking(move || {
            crate::chapter::create_chapter_with_content_sync(
                project_path_for_task,
                title_for_task,
                content_for_task,
            )
        })
        .await
        .map_err(|e| format!("Task join error: {e}"))??;

        created.push(meta);

        let completed = (index + 1) as u32;
        let _ = window.emit(
            IMPORT_TXT_PROGRESS_EVENT,
            ImportTxtProgress {
                request_id: request_id.clone(),
                total,
                completed,
                current_title: Some(chapter.title),
            },
        );
    }

    Ok(created)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_chapters_uses_multiline_anchors() {
        let text = "前言\n第一章 开端\nhello\n\n第二章 转折\nworld\n";
        let chapters = parse_chapters_from_text(text, "^第.+章.*").expect("parse");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第一章 开端");
        assert_eq!(chapters[0].content, "hello");
        assert_eq!(chapters[0].word_count, 5);
        assert_eq!(chapters[1].title, "第二章 转折");
        assert_eq!(chapters[1].content, "world");
        assert_eq!(chapters[1].word_count, 5);
    }

    #[test]
    fn parse_chapters_empty_pattern_falls_back_to_default() {
        let text = "第一章\nA\n第二章\nB\n";
        let chapters = parse_chapters_from_text(text, "").expect("parse");
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].title, "第一章");
        assert_eq!(chapters[0].content, "A");
        assert_eq!(chapters[1].title, "第二章");
        assert_eq!(chapters[1].content, "B");
    }
}
