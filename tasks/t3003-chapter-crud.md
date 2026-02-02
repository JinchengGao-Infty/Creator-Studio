# T3.3 实现章节 CRUD 后端

## 目标

实现章节的增删改查 Tauri commands，支持章节内容的读写。

## 背景

章节是小说的基本单位。用户需要：
- 创建新章节
- 读取章节内容
- 保存章节内容
- 重命名章节
- 删除章节
- 调整章节顺序

## 数据结构

章节存储在 `chapters/` 目录下：
- `index.json` — 章节索引（元数据）
- `chapter_001.txt` — 章节正文

### ChapterMeta（在 index.json 中）
```json
{
  "id": "chapter_001",
  "title": "第一章 开端",
  "order": 1,
  "created": 1769968900,
  "updated": 1769968900,
  "wordCount": 3500
}
```

## Tauri Commands

### 1. list_chapters
```rust
#[tauri::command]
pub async fn list_chapters(project_path: String) -> Result<Vec<ChapterMeta>, String>
```
- 读取 `chapters/index.json`
- 返回按 order 排序的章节列表

### 2. create_chapter
```rust
#[tauri::command]
pub async fn create_chapter(
    project_path: String,
    title: String,
) -> Result<ChapterMeta, String>
```
- 生成新 chapter_id（`chapter_XXX`，XXX 为 nextId）
- 创建空的 `.txt` 文件
- 更新 index.json（添加元数据，递增 nextId）
- 返回新章节元数据

### 3. get_chapter_content
```rust
#[tauri::command]
pub async fn get_chapter_content(
    project_path: String,
    chapter_id: String,
) -> Result<String, String>
```
- 读取 `chapters/{chapter_id}.txt`
- 返回内容字符串

### 4. save_chapter_content
```rust
#[tauri::command]
pub async fn save_chapter_content(
    project_path: String,
    chapter_id: String,
    content: String,
) -> Result<ChapterMeta, String>
```
- 写入 `chapters/{chapter_id}.txt`
- 更新 index.json 中的 `updated` 和 `wordCount`
- 返回更新后的元数据

### 5. rename_chapter
```rust
#[tauri::command]
pub async fn rename_chapter(
    project_path: String,
    chapter_id: String,
    new_title: String,
) -> Result<ChapterMeta, String>
```
- 更新 index.json 中的 title
- 返回更新后的元数据

### 6. delete_chapter
```rust
#[tauri::command]
pub async fn delete_chapter(
    project_path: String,
    chapter_id: String,
) -> Result<(), String>
```
- 删除 `chapters/{chapter_id}.txt`
- 从 index.json 中移除
- 重新计算其他章节的 order

### 7. reorder_chapters
```rust
#[tauri::command]
pub async fn reorder_chapters(
    project_path: String,
    chapter_ids: Vec<String>,
) -> Result<Vec<ChapterMeta>, String>
```
- 按传入的 id 顺序更新所有章节的 order
- 返回更新后的章节列表

## 实现要点

### 字数统计
```rust
fn count_words(content: &str) -> u32 {
    // 中文：按字符数（去除空白）
    // 英文：按单词数
    // 简单实现：去除空白后的字符数
    content.chars().filter(|c| !c.is_whitespace()).count() as u32
}
```

### 文件操作安全
- 所有路径操作使用 `project_path` 作为根目录
- 验证 chapter_id 格式（防止路径穿越）
- 写入前检查目录存在

### 错误处理
- 章节不存在
- 文件读写失败
- JSON 解析失败
- 权限问题

## 验收标准

- [ ] list_chapters 返回正确的章节列表
- [ ] create_chapter 能创建新章节
- [ ] get_chapter_content 能读取内容
- [ ] save_chapter_content 能保存并更新字数
- [ ] rename_chapter 能修改标题
- [ ] delete_chapter 能删除章节
- [ ] reorder_chapters 能调整顺序
- [ ] 错误处理完善

## 文件变更

- 新增：`src-tauri/src/chapter.rs`
- 修改：`src-tauri/src/lib.rs`（注册 commands）

## 依赖

- T3.1 完成（项目数据结构）

---

*任务创建时间：2026-02-02*
