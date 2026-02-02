// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod chapter;
mod file_ops;
mod project;
mod security;

use chapter::{
    create_chapter, delete_chapter, get_chapter_content, list_chapters, rename_chapter,
    reorder_chapters, save_chapter_content,
};
use file_ops::{
    append_file, list_dir, read_file, search_in_files, write_file, AppendParams, ListParams,
    ListResult, ReadParams, ReadResult, SearchParams, SearchResult, WriteParams,
};
use project::{create_project, get_project_info, open_project, save_project_config};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn file_read(project_dir: String, params: ReadParams) -> Result<ReadResult, String> {
    read_file(std::path::Path::new(&project_dir), params)
}

#[tauri::command]
fn file_write(project_dir: String, params: WriteParams) -> Result<(), String> {
    write_file(std::path::Path::new(&project_dir), params)
}

#[tauri::command]
fn file_append(project_dir: String, params: AppendParams) -> Result<(), String> {
    append_file(std::path::Path::new(&project_dir), params)
}

#[tauri::command]
fn file_list(project_dir: String, params: ListParams) -> Result<ListResult, String> {
    list_dir(std::path::Path::new(&project_dir), params)
}

#[tauri::command]
fn file_search(project_dir: String, params: SearchParams) -> Result<SearchResult, String> {
    search_in_files(std::path::Path::new(&project_dir), params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            file_read,
            file_write,
            file_append,
            file_list,
            file_search,
            create_project,
            open_project,
            get_project_info,
            save_project_config,
            list_chapters,
            create_chapter,
            get_chapter_content,
            save_chapter_content,
            rename_chapter,
            delete_chapter,
            reorder_chapters
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
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

    #[test]
    fn file_ops_smoke_test() {
        let temp = TempDir::new("creatorai-v2-file-ops");
        let project_dir = temp.path.to_string_lossy().to_string();

        fs::write(temp.path.join("test.txt"), "hello").expect("write test file");

        let read_1 = file_read(
            project_dir.clone(),
            ReadParams {
                path: "test.txt".to_string(),
                offset: None,
                limit: None,
            },
        )
        .expect("file_read");
        assert_eq!(read_1.total_lines, 1);
        assert!(read_1.content.contains("00001| hello"));

        file_append(
            project_dir.clone(),
            AppendParams {
                path: "test.txt".to_string(),
                content: "world".to_string(),
            },
        )
        .expect("file_append");

        let read_2 = file_read(
            project_dir.clone(),
            ReadParams {
                path: "test.txt".to_string(),
                offset: None,
                limit: None,
            },
        )
        .expect("file_read");
        assert_eq!(read_2.total_lines, 2);
        assert!(read_2.content.contains("00001| hello"));
        assert!(read_2.content.contains("00002| world"));

        let listed = file_list(project_dir.clone(), ListParams { path: None }).expect("file_list");
        assert!(listed
            .entries
            .iter()
            .any(|e| e.name == "test.txt" && !e.is_dir));

        let searched = file_search(
            project_dir.clone(),
            SearchParams {
                query: "world".to_string(),
                path: None,
            },
        )
        .expect("file_search");
        assert!(searched
            .matches
            .iter()
            .any(|m| m.file.ends_with("test.txt") && m.line == 2));

        file_write(
            project_dir.clone(),
            WriteParams {
                path: "test.txt".to_string(),
                content: "new".to_string(),
            },
        )
        .expect("file_write");
        assert!(temp.path.join(".backup").exists());
    }

    #[test]
    fn project_create_open_save_smoke_test() {
        let temp = TempDir::new("creatorai-v2-project");
        let project_root = temp.path.join("MyNovel");
        let project_path = project_root.to_string_lossy().to_string();

        let config = tauri::async_runtime::block_on(create_project(
            project_path.clone(),
            "我的小说".to_string(),
        ))
        .expect("create_project");
        assert_eq!(config.name, "我的小说");

        let opened = tauri::async_runtime::block_on(open_project(project_path.clone()))
            .expect("open_project");
        assert_eq!(opened.name, "我的小说");

        let info = tauri::async_runtime::block_on(get_project_info(project_path.clone()))
            .expect("get_project_info");
        assert_eq!(info.name, "我的小说");

        let mut updated = info.clone();
        updated.name = "新名称".to_string();
        tauri::async_runtime::block_on(save_project_config(project_path.clone(), updated))
            .expect("save_project_config");

        let info2 = tauri::async_runtime::block_on(get_project_info(project_path.clone()))
            .expect("get_project_info after save");
        assert_eq!(info2.name, "新名称");
    }

    #[test]
    fn chapter_crud_smoke_test() {
        let temp = TempDir::new("creatorai-v2-chapter");
        let project_root = temp.path.join("MyNovel");
        let project_path = project_root.to_string_lossy().to_string();

        tauri::async_runtime::block_on(create_project(
            project_path.clone(),
            "我的小说".to_string(),
        ))
        .expect("create_project");

        let chapters =
            tauri::async_runtime::block_on(list_chapters(project_path.clone())).expect("list");
        assert!(chapters.is_empty());

        let ch1 = tauri::async_runtime::block_on(create_chapter(
            project_path.clone(),
            "第一章 开端".to_string(),
        ))
        .expect("create_chapter");
        assert_eq!(ch1.id, "chapter_001");
        assert_eq!(ch1.order, 1);

        let content = tauri::async_runtime::block_on(get_chapter_content(
            project_path.clone(),
            ch1.id.clone(),
        ))
        .expect("get_chapter_content");
        assert_eq!(content, "");

        let saved = tauri::async_runtime::block_on(save_chapter_content(
            project_path.clone(),
            ch1.id.clone(),
            "你好 世界".to_string(),
        ))
        .expect("save_chapter_content");
        assert_eq!(saved.word_count, 4);

        let renamed = tauri::async_runtime::block_on(rename_chapter(
            project_path.clone(),
            ch1.id.clone(),
            "第一章 新标题".to_string(),
        ))
        .expect("rename_chapter");
        assert_eq!(renamed.title, "第一章 新标题");

        let ch2 = tauri::async_runtime::block_on(create_chapter(
            project_path.clone(),
            "第二章".to_string(),
        ))
        .expect("create_chapter 2");
        assert_eq!(ch2.id, "chapter_002");
        assert_eq!(ch2.order, 2);

        let reordered = tauri::async_runtime::block_on(reorder_chapters(
            project_path.clone(),
            vec![ch2.id.clone(), ch1.id.clone()],
        ))
        .expect("reorder_chapters");
        assert_eq!(reordered[0].id, "chapter_002");
        assert_eq!(reordered[0].order, 1);
        assert_eq!(reordered[1].id, "chapter_001");
        assert_eq!(reordered[1].order, 2);

        tauri::async_runtime::block_on(delete_chapter(project_path.clone(), ch2.id.clone()))
            .expect("delete_chapter");

        let chapters2 =
            tauri::async_runtime::block_on(list_chapters(project_path.clone())).expect("list 2");
        assert_eq!(chapters2.len(), 1);
        assert_eq!(chapters2[0].id, "chapter_001");
        assert_eq!(chapters2[0].order, 1);
    }
}
