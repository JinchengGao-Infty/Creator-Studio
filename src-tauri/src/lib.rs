// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod ai_bridge;
mod chapter;
mod config;
mod file_ops;
mod import;
mod keyring_store;
mod project;
mod recent_projects;
mod security;
mod session;

use chapter::{
    create_chapter, delete_chapter, get_chapter_content, list_chapters, rename_chapter,
    reorder_chapters, save_chapter_content,
};
use config::{GlobalConfig, ModelParameters, Provider};
use file_ops::{
    append_file, list_dir, read_file, search_in_files, write_file, AppendParams, ListParams,
    ListResult, ReadParams, ReadResult, SearchParams, SearchResult, WriteParams,
};
use import::{import_txt, preview_import_txt};
use project::{create_project, get_project_info, open_project, save_project_config};
use recent_projects::{add_recent_project, get_recent_projects};
use session::{
    add_message, create_session, delete_session, get_session_messages, list_sessions,
    rename_session,
};
use std::time::{SystemTime, UNIX_EPOCH};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// ===== Config Commands =====

#[tauri::command]
fn get_config() -> Result<GlobalConfig, String> {
    config::load_config()
}

#[tauri::command]
fn save_config(config: GlobalConfig) -> Result<(), String> {
    config::save_config(&config)
}

// ===== Provider Commands =====

#[tauri::command]
fn list_providers() -> Result<Vec<Provider>, String> {
    let config = config::load_config()?;
    Ok(config.providers)
}

#[tauri::command(rename_all = "camelCase")]
fn get_provider(provider_id: String) -> Result<Provider, String> {
    let config = config::load_config()?;
    let provider = config
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or(format!("Provider {} not found", provider_id))?;
    Ok(provider.clone())
}

#[tauri::command(rename_all = "camelCase")]
fn add_provider(provider: Provider, api_key: String) -> Result<(), String> {
    keyring_store::store_api_key(&provider.id, &api_key)?;

    let mut config = config::load_config()?;
    if config.providers.iter().any(|p| p.id == provider.id) {
        return Err(format!("Provider {} already exists", provider.id));
    }

    config.providers.push(provider);
    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn update_provider(provider: Provider, api_key: Option<String>) -> Result<(), String> {
    if let Some(key) = api_key {
        keyring_store::store_api_key(&provider.id, &key)?;
    }

    let mut config = config::load_config()?;
    if let Some(p) = config.providers.iter_mut().find(|p| p.id == provider.id) {
        *p = provider;
    } else {
        return Err(format!("Provider {} not found", provider.id));
    }

    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn delete_provider(provider_id: String) -> Result<(), String> {
    keyring_store::delete_api_key(&provider_id)?;

    let mut config = config::load_config()?;
    config.providers.retain(|p| p.id != provider_id);

    if config.active_provider_id.as_ref() == Some(&provider_id) {
        config.active_provider_id = None;
    }

    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn set_active_provider(provider_id: String) -> Result<(), String> {
    let mut config = config::load_config()?;

    if !config.providers.iter().any(|p| p.id == provider_id) {
        return Err(format!("Provider {} not found", provider_id));
    }

    config.active_provider_id = Some(provider_id);
    config::save_config(&config)
}

#[tauri::command(rename_all = "camelCase")]
fn get_api_key(provider_id: String) -> Result<Option<String>, String> {
    keyring_store::get_api_key(&provider_id)
}

// ===== Parameters Commands =====

#[tauri::command]
fn get_default_parameters() -> Result<ModelParameters, String> {
    let config = config::load_config()?;
    Ok(config.default_parameters)
}

#[tauri::command]
fn set_default_parameters(parameters: ModelParameters) -> Result<(), String> {
    let mut config = config::load_config()?;
    config.default_parameters = parameters;
    config::save_config(&config)
}

// ===== Models Commands =====

#[tauri::command(rename_all = "camelCase")]
async fn refresh_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    let provider = {
        let config = config::load_config()?;
        config
            .providers
            .iter()
            .find(|p| p.id == provider_id)
            .ok_or(format!("Provider {} not found", provider_id))?
            .clone()
    };

    let api_key = keyring_store::get_api_key(&provider_id)?
        .ok_or(format!("API Key not found for provider {}", provider_id))?;

    let base_url = provider.base_url.clone();
    let api_key_for_task = api_key.clone();
    let models = tauri::async_runtime::spawn_blocking(move || {
        ai_bridge::fetch_models(&base_url, &api_key_for_task)
    })
    .await
    .map_err(|e| format!("refresh_provider_models join error: {e}"))??;

    let mut config = config::load_config()?;
    if let Some(p) = config.providers.iter_mut().find(|p| p.id == provider_id) {
        p.models = models.clone();
        p.models_updated_at = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        );
    }
    config::save_config(&config)?;

    Ok(models)
}

#[tauri::command(rename_all = "camelCase")]
fn get_provider_models(provider_id: String) -> Result<Vec<String>, String> {
    let config = config::load_config()?;
    let provider = config
        .providers
        .iter()
        .find(|p| p.id == provider_id)
        .ok_or(format!("Provider {} not found", provider_id))?;
    Ok(provider.models.clone())
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

// ===== AI Chat Command =====

#[tauri::command(rename_all = "camelCase")]
async fn ai_chat(
    provider: serde_json::Value,
    parameters: serde_json::Value,
    system_prompt: String,
    messages: Vec<serde_json::Value>,
    project_dir: String,
) -> Result<String, String> {
    let request = ai_bridge::ChatRequest {
        provider,
        parameters,
        system_prompt,
        messages,
        project_dir,
    };

    let response = tauri::async_runtime::spawn_blocking(move || ai_bridge::run_chat(request))
        .await
        .map_err(|e| format!("ai_chat join error: {e}"))??;

    Ok(response.content)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_config,
            save_config,
            list_providers,
            get_provider,
            add_provider,
            update_provider,
            delete_provider,
            set_active_provider,
            get_api_key,
            get_default_parameters,
            set_default_parameters,
            refresh_provider_models,
            get_provider_models,
            file_read,
            file_write,
            file_append,
            file_list,
            file_search,
            ai_chat,
            get_recent_projects,
            add_recent_project,
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
            reorder_chapters,
            list_sessions,
            create_session,
            rename_session,
            delete_session,
            get_session_messages,
            add_message,
            preview_import_txt,
            import_txt
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

    #[test]
    fn session_storage_smoke_test() {
        use uuid::Uuid;

        let temp = TempDir::new("creatorai-v2-session");
        let project_root = temp.path.join("MyNovel");
        let project_path = project_root.to_string_lossy().to_string();

        tauri::async_runtime::block_on(create_project(
            project_path.clone(),
            "我的小说".to_string(),
        ))
        .expect("create_project");

        let sessions = tauri::async_runtime::block_on(list_sessions(project_path.clone()))
            .expect("list_sessions");
        assert!(sessions.is_empty());

        let s1 = tauri::async_runtime::block_on(create_session(
            project_path.clone(),
            "讨论：角色设定".to_string(),
            session::SessionMode::Discussion,
            None,
        ))
        .expect("create_session discussion");
        Uuid::parse_str(&s1.id).expect("session id is uuid");

        let msg1 = tauri::async_runtime::block_on(add_message(
            project_path.clone(),
            s1.id.clone(),
            session::MessageRole::User,
            "帮我设计一个反派角色".to_string(),
            None,
        ))
        .expect("add_message");
        Uuid::parse_str(&msg1.id).expect("message id is uuid");

        let messages = tauri::async_runtime::block_on(get_session_messages(
            project_path.clone(),
            s1.id.clone(),
        ))
        .expect("get_session_messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "帮我设计一个反派角色");

        tauri::async_runtime::block_on(rename_session(
            project_path.clone(),
            s1.id.clone(),
            "讨论：人物关系".to_string(),
        ))
        .expect("rename_session");

        let sessions2 = tauri::async_runtime::block_on(list_sessions(project_path.clone()))
            .expect("list_sessions after rename");
        let renamed = sessions2
            .iter()
            .find(|s| s.id == s1.id)
            .expect("renamed session exists");
        assert_eq!(renamed.name, "讨论：人物关系");

        let ch1 = tauri::async_runtime::block_on(create_chapter(
            project_path.clone(),
            "第一章".to_string(),
        ))
        .expect("create_chapter");

        let s2 = tauri::async_runtime::block_on(create_session(
            project_path.clone(),
            "续写：第一章".to_string(),
            session::SessionMode::Continue,
            Some(ch1.id.clone()),
        ))
        .expect("create_session continue");

        let meta = session::MessageMetadata {
            summary: Some("本次生成了开场冲突".to_string()),
            word_count: Some(120),
            applied: Some(false),
        };
        tauri::async_runtime::block_on(add_message(
            project_path.clone(),
            s2.id.clone(),
            session::MessageRole::Assistant,
            "这里是续写内容预览...".to_string(),
            Some(meta.clone()),
        ))
        .expect("add_message with metadata");

        let messages2 = tauri::async_runtime::block_on(get_session_messages(
            project_path.clone(),
            s2.id.clone(),
        ))
        .expect("get_session_messages continue");
        assert_eq!(messages2.len(), 1);
        assert_eq!(messages2[0].metadata, Some(meta));

        tauri::async_runtime::block_on(delete_session(project_path.clone(), s1.id.clone()))
            .expect("delete_session");

        let sessions3 = tauri::async_runtime::block_on(list_sessions(project_path.clone()))
            .expect("list_sessions after delete");
        assert_eq!(sessions3.len(), 1);
        assert_eq!(sessions3[0].id, s2.id);

        assert!(
            !project_root
                .join("sessions")
                .join(format!("{}.json", s1.id))
                .exists(),
            "deleted session file should not exist"
        );
        assert!(
            project_root.join("sessions").join("index.json").exists(),
            "sessions/index.json should exist"
        );
    }
}
