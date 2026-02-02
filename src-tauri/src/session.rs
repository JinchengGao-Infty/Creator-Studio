use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

use crate::security::validate_path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub mode: SessionMode,
    pub chapter_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SessionMode {
    Discussion,
    Continue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Message {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub timestamp: i64,
    pub metadata: Option<MessageMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MessageMetadata {
    pub summary: Option<String>,
    pub word_count: Option<u32>,
    pub applied: Option<bool>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolCallStatus {
    Calling,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub args: Value,
    pub status: ToolCallStatus,
    pub result: Option<String>,
    pub error: Option<String>,
    pub duration: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionIndex {
    pub sessions: Vec<Session>,
}

impl Default for SessionIndex {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SessionFile {
    pub session: Session,
    pub messages: Vec<Message>,
}

static SESSIONS_FS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn fs_lock() -> &'static Mutex<()> {
    SESSIONS_FS_LOCK.get_or_init(|| Mutex::new(()))
}

fn now_unix_seconds() -> Result<i64, String> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Failed to read system time: {e}"))?
        .as_secs();
    i64::try_from(secs).map_err(|_| "System time overflowed i64".to_string())
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

    let cfg = validate_path(project_root, ".creatorai/config.json")?;
    if !cfg.exists() {
        return Err("Not a valid project: missing .creatorai/config.json".to_string());
    }
    let chapters = validate_path(project_root, "chapters/index.json")?;
    if !chapters.exists() {
        return Err("Not a valid project: missing chapters/index.json".to_string());
    }
    Ok(())
}

fn normalize_session_id(session_id: &str) -> Result<String, String> {
    let uuid = Uuid::parse_str(session_id)
        .map_err(|_| "Invalid session_id (expected UUID)".to_string())?;
    Ok(uuid.to_string())
}

fn sessions_index_path(project_root: &Path) -> Result<PathBuf, String> {
    validate_path(project_root, "sessions/index.json")
}

fn session_file_path(project_root: &Path, session_id: &str) -> Result<PathBuf, String> {
    let id = normalize_session_id(session_id)?;
    validate_path(project_root, &format!("sessions/{id}.json"))
}

fn serialize_json_pretty<T: Serialize>(value: &T) -> Result<String, String> {
    let json =
        serde_json::to_string_pretty(value).map_err(|e| format!("Serialize JSON failed: {e}"))?;
    Ok(format!("{json}\n"))
}

fn read_sessions_index(project_root: &Path) -> Result<SessionIndex, String> {
    let path = sessions_index_path(project_root)?;
    if !path.exists() {
        return Ok(SessionIndex::default());
    }
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read sessions/index.json: {e}"))?;
    serde_json::from_slice::<SessionIndex>(&bytes)
        .map_err(|e| format!("Failed to parse sessions/index.json: {e}"))
}

fn write_sessions_index(project_root: &Path, index: &SessionIndex) -> Result<(), String> {
    let path = sessions_index_path(project_root)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let content = serialize_json_pretty(index)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write sessions/index.json: {e}"))?;
    Ok(())
}

fn read_session_file(project_root: &Path, session_id: &str) -> Result<SessionFile, String> {
    let path = session_file_path(project_root, session_id)?;
    let bytes = fs::read(&path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Session not found".to_string()
        } else {
            format!("Failed to read session file: {e}")
        }
    })?;
    serde_json::from_slice::<SessionFile>(&bytes)
        .map_err(|e| format!("Failed to parse session file: {e}"))
}

fn write_session_file(
    project_root: &Path,
    session_id: &str,
    file: &SessionFile,
) -> Result<(), String> {
    let path = session_file_path(project_root, session_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    let content = serialize_json_pretty(file)?;
    fs::write(&path, content).map_err(|e| format!("Failed to write session file: {e}"))?;
    Ok(())
}

fn create_session_file_create_new(
    project_root: &Path,
    session_id: &str,
    file: &SessionFile,
) -> Result<(), String> {
    let path = session_file_path(project_root, session_id)?;
    if path.exists() {
        return Err("Session file already exists".to_string());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    let content = serialize_json_pretty(file)?;
    let mut handle = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|e| format!("Failed to create session file: {e}"))?;
    use std::io::Write;
    handle
        .write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write session file: {e}"))?;
    Ok(())
}

fn list_sessions_sync(project_path: String) -> Result<Vec<Session>, String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut index = read_sessions_index(&project_root)?;
    index
        .sessions
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(index.sessions)
}

fn create_session_sync(
    project_path: String,
    name: String,
    mode: SessionMode,
    chapter_id: Option<String>,
) -> Result<Session, String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let mut index = read_sessions_index(&project_root)?;
    let now = now_unix_seconds()?;
    let id = Uuid::new_v4().to_string();

    if index.sessions.iter().any(|s| s.id == id) {
        return Err("Session id collision (unexpected)".to_string());
    }

    let session = Session {
        id: id.clone(),
        name,
        mode,
        chapter_id,
        created_at: now,
        updated_at: now,
    };

    let file = SessionFile {
        session: session.clone(),
        messages: Vec::new(),
    };

    create_session_file_create_new(&project_root, &id, &file)?;

    index.sessions.push(session.clone());
    if let Err(e) = write_sessions_index(&project_root, &index) {
        let _ = fs::remove_file(session_file_path(&project_root, &id)?);
        return Err(e);
    }

    Ok(session)
}

fn rename_session_sync(
    project_path: String,
    session_id: String,
    new_name: String,
) -> Result<(), String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let id = normalize_session_id(&session_id)?;
    let mut index = read_sessions_index(&project_root)?;
    let old_index_content = serialize_json_pretty(&index)?;

    let Some(pos) = index.sessions.iter().position(|s| s.id == id) else {
        return Err("Session not found".to_string());
    };

    let mut file = read_session_file(&project_root, &id)?;
    let old_file_content = serialize_json_pretty(&file)?;

    let now = now_unix_seconds()?;
    index.sessions[pos].name = new_name.clone();
    index.sessions[pos].updated_at = now;

    file.session.name = new_name;
    file.session.updated_at = now;

    write_session_file(&project_root, &id, &file)?;
    if let Err(e) = write_sessions_index(&project_root, &index) {
        let index_path = sessions_index_path(&project_root)?;
        let session_path = session_file_path(&project_root, &id)?;
        let _ = fs::write(&session_path, old_file_content);
        let _ = fs::write(&index_path, old_index_content);
        return Err(e);
    }
    Ok(())
}

fn delete_session_sync(project_path: String, session_id: String) -> Result<(), String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let id = normalize_session_id(&session_id)?;
    let mut index = read_sessions_index(&project_root)?;

    let before = index.sessions.len();
    index.sessions.retain(|s| s.id != id);
    if index.sessions.len() == before {
        return Err("Session not found".to_string());
    }

    let index_path = sessions_index_path(&project_root)?;
    let old_index_content = if index_path.exists() {
        Some(
            fs::read_to_string(&index_path)
                .map_err(|e| format!("Failed to read sessions/index.json: {e}"))?,
        )
    } else {
        None
    };

    let session_path = session_file_path(&project_root, &id)?;
    let old_session_content = if session_path.exists() {
        Some(
            fs::read_to_string(&session_path)
                .map_err(|e| format!("Failed to read session file: {e}"))?,
        )
    } else {
        None
    };

    if session_path.exists() {
        fs::remove_file(&session_path)
            .map_err(|e| format!("Failed to delete session file: {e}"))?;
    }

    if let Err(e) = write_sessions_index(&project_root, &index) {
        if let Some(content) = old_session_content {
            let _ = fs::write(&session_path, content);
        }
        if let Some(content) = old_index_content {
            let _ = fs::write(&index_path, content);
        } else {
            let _ = fs::remove_file(&index_path);
        }
        return Err(e);
    }

    Ok(())
}

fn get_session_messages_sync(
    project_path: String,
    session_id: String,
) -> Result<Vec<Message>, String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let id = normalize_session_id(&session_id)?;
    let file = read_session_file(&project_root, &id)?;
    Ok(file.messages)
}

fn add_message_sync(
    project_path: String,
    session_id: String,
    role: MessageRole,
    content: String,
    metadata: Option<MessageMetadata>,
) -> Result<Message, String> {
    let _guard = fs_lock()
        .lock()
        .map_err(|_| "Failed to lock sessions storage".to_string())?;

    let project_root = PathBuf::from(project_path);
    ensure_project_exists(&project_root)?;

    let id = normalize_session_id(&session_id)?;
    let mut index = read_sessions_index(&project_root)?;
    let old_index_content = serialize_json_pretty(&index)?;

    let Some(pos) = index.sessions.iter().position(|s| s.id == id) else {
        return Err("Session not found".to_string());
    };

    let mut file = read_session_file(&project_root, &id)?;
    let old_file_content = serialize_json_pretty(&file)?;

    let now = now_unix_seconds()?;
    let msg = Message {
        id: Uuid::new_v4().to_string(),
        role,
        content,
        timestamp: now,
        metadata,
    };

    file.messages.push(msg.clone());
    file.session.updated_at = now;

    index.sessions[pos].updated_at = now;

    write_session_file(&project_root, &id, &file)?;
    if let Err(e) = write_sessions_index(&project_root, &index) {
        let index_path = sessions_index_path(&project_root)?;
        let _ = fs::write(&index_path, old_index_content);
        let session_path = session_file_path(&project_root, &id)?;
        let _ = fs::write(&session_path, old_file_content);
        return Err(e);
    }

    Ok(msg)
}

#[tauri::command]
pub async fn list_sessions(project_path: String) -> Result<Vec<Session>, String> {
    tauri::async_runtime::spawn_blocking(move || list_sessions_sync(project_path))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn create_session(
    project_path: String,
    name: String,
    mode: SessionMode,
    chapter_id: Option<String>,
) -> Result<Session, String> {
    tauri::async_runtime::spawn_blocking(move || {
        create_session_sync(project_path, name, mode, chapter_id)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn rename_session(
    project_path: String,
    session_id: String,
    new_name: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_session_sync(project_path, session_id, new_name)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn delete_session(project_path: String, session_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_session_sync(project_path, session_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn get_session_messages(
    project_path: String,
    session_id: String,
) -> Result<Vec<Message>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        get_session_messages_sync(project_path, session_id)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}

#[tauri::command]
pub async fn add_message(
    project_path: String,
    session_id: String,
    role: MessageRole,
    content: String,
    metadata: Option<MessageMetadata>,
) -> Result<Message, String> {
    tauri::async_runtime::spawn_blocking(move || {
        add_message_sync(project_path, session_id, role, content, metadata)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))?
}
