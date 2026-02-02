# T4.1 会话数据结构与存储

## 目标
实现 AI 对话会话的数据结构定义和后端存储功能。

## 输入
- T3.9 完成的项目结构
- 现有的项目存储模式

## 输出
- `src-tauri/src/session.rs` — 会话管理模块
- 会话相关 Tauri commands

## 数据结构

### Session（会话）
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,           // UUID
    pub name: String,         // 会话名称
    pub mode: SessionMode,    // 讨论/续写
    pub chapter_id: Option<String>,  // 关联章节（续写模式）
    pub created_at: i64,      // 创建时间戳
    pub updated_at: i64,      // 更新时间戳
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionMode {
    Discussion,  // 讨论模式
    Continue,    // 续写模式
}
```

### Message（消息）
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: String,           // UUID
    pub role: MessageRole,    // user/assistant/system
    pub content: String,      // 消息内容
    pub timestamp: i64,       // 时间戳
    pub metadata: Option<MessageMetadata>,  // 续写模式的额外数据
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MessageRole {
    User,
    Assistant,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageMetadata {
    pub summary: Option<String>,      // 续写生成的摘要
    pub word_count: Option<u32>,      // 生成字数
    pub applied: Option<bool>,        // 是否已应用到章节
}
```

## 存储结构
```
MyNovel/
├── sessions/
│   ├── index.json           # 会话索引
│   ├── {session_id}.json    # 单个会话的消息历史
│   └── ...
```

### index.json 格式
```json
{
  "sessions": [
    {
      "id": "uuid-1",
      "name": "讨论：角色设定",
      "mode": "Discussion",
      "chapter_id": null,
      "created_at": 1706860800,
      "updated_at": 1706864400
    }
  ]
}
```

### {session_id}.json 格式
```json
{
  "session": { ... },
  "messages": [
    {
      "id": "msg-uuid",
      "role": "User",
      "content": "帮我设计一个反派角色",
      "timestamp": 1706860800,
      "metadata": null
    }
  ]
}
```

## Tauri Commands

### list_sessions
```rust
#[tauri::command]
pub async fn list_sessions(project_path: String) -> Result<Vec<Session>, String>
```

### create_session
```rust
#[tauri::command]
pub async fn create_session(
    project_path: String,
    name: String,
    mode: SessionMode,
    chapter_id: Option<String>,
) -> Result<Session, String>
```

### rename_session
```rust
#[tauri::command]
pub async fn rename_session(
    project_path: String,
    session_id: String,
    new_name: String,
) -> Result<(), String>
```

### delete_session
```rust
#[tauri::command]
pub async fn delete_session(
    project_path: String,
    session_id: String,
) -> Result<(), String>
```

### get_session_messages
```rust
#[tauri::command]
pub async fn get_session_messages(
    project_path: String,
    session_id: String,
) -> Result<Vec<Message>, String>
```

### add_message
```rust
#[tauri::command]
pub async fn add_message(
    project_path: String,
    session_id: String,
    role: MessageRole,
    content: String,
    metadata: Option<MessageMetadata>,
) -> Result<Message, String>
```

## 验收标准
1. [ ] 能创建新会话
2. [ ] 能列出所有会话
3. [ ] 能重命名/删除会话
4. [ ] 能读取/写入会话消息
5. [ ] 数据正确持久化到 JSON 文件
6. [ ] `cargo test` 通过

## 技术要点
- 使用 UUID v4 生成 ID
- 时间戳使用 Unix 秒
- 文件操作要加锁防止并发问题
- 删除会话时同时删除消息文件
