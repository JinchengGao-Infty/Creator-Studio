# T3.1 实现项目数据结构与存储

## 目标

实现项目配置和章节索引的数据结构，支持项目的创建、打开、保存。

## 背景

CreatorAI 需要管理"项目"（一本小说），每个项目包含多个章节。用户可以：
- 新建项目（指定名称和存储路径）
- 打开已有项目
- 项目配置持久化

## 数据结构

### 项目目录结构
```
MyNovel/                        # 项目根目录
├── .creatorai/                 # 配置目录
│   └── config.json             # 项目配置
├── chapters/                   # 章节目录
│   ├── index.json              # 章节索引
│   ├── chapter_001.txt         # 章节正文
│   ├── chapter_001.json        # 章节元数据（可选）
│   └── ...
└── summaries.json              # 摘要记录（后续任务）
```

### config.json（项目配置）
```json
{
  "name": "我的小说",
  "created": 1769968900,
  "updated": 1769968900,
  "version": "1.0",
  "settings": {
    "autoSave": true,
    "autoSaveInterval": 2000
  }
}
```

### chapters/index.json（章节索引）
```json
{
  "chapters": [
    {
      "id": "chapter_001",
      "title": "第一章 开端",
      "order": 1,
      "created": 1769968900,
      "updated": 1769968900,
      "wordCount": 3500
    },
    {
      "id": "chapter_002", 
      "title": "第二章 转折",
      "order": 2,
      "created": 1769968901,
      "updated": 1769968901,
      "wordCount": 4200
    }
  ],
  "nextId": 3
}
```

## Rust 实现

### 文件：`src-tauri/src/project.rs`

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    pub name: String,
    pub created: u64,
    pub updated: u64,
    pub version: String,
    pub settings: ProjectSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSettings {
    #[serde(rename = "autoSave")]
    pub auto_save: bool,
    #[serde(rename = "autoSaveInterval")]
    pub auto_save_interval: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterMeta {
    pub id: String,
    pub title: String,
    pub order: u32,
    pub created: u64,
    pub updated: u64,
    #[serde(rename = "wordCount")]
    pub word_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterIndex {
    pub chapters: Vec<ChapterMeta>,
    #[serde(rename = "nextId")]
    pub next_id: u32,
}
```

### Tauri Commands

```rust
#[tauri::command]
pub async fn create_project(path: String, name: String) -> Result<ProjectConfig, String>;

#[tauri::command]
pub async fn open_project(path: String) -> Result<ProjectConfig, String>;

#[tauri::command]
pub async fn get_project_info(path: String) -> Result<ProjectConfig, String>;

#[tauri::command]
pub async fn save_project_config(path: String, config: ProjectConfig) -> Result<(), String>;
```

## 实现要点

1. **create_project**：
   - 创建项目目录结构（.creatorai/, chapters/）
   - 初始化 config.json 和 chapters/index.json
   - 返回项目配置

2. **open_project**：
   - 验证目录是否为有效项目（检查 .creatorai/config.json）
   - 读取并返回项目配置
   - 如果缺少必要文件，返回错误

3. **get_project_info**：
   - 读取项目配置（不修改）

4. **save_project_config**：
   - 更新 config.json
   - 更新 updated 时间戳

## 验收标准

- [ ] 数据结构定义完整
- [ ] create_project 能创建完整目录结构
- [ ] open_project 能正确读取项目
- [ ] 配置能正确序列化/反序列化
- [ ] 错误处理完善（路径不存在、权限问题等）

## 文件变更

- 新增：`src-tauri/src/project.rs`
- 修改：`src-tauri/src/lib.rs`（注册 commands）

## 依赖

- T2.6 完成（Provider 系统验证通过）

---

*任务创建时间：2026-02-02*
