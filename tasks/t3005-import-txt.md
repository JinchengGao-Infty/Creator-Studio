# T3.5 实现导入 txt 拆章

## 目标

实现从 txt 文件导入小说并自动拆分章节的功能。

## 背景

用户可能有已写好的小说（单个 txt 文件），需要导入到 CreatorAI 中。导入时自动识别章节标题并拆分。

## 功能流程

1. 用户点击「导入」按钮
2. 选择 txt 文件
3. 显示拆章预览（可调整正则）
4. 确认导入
5. 创建章节文件

## UI 设计

### 导入对话框

```
┌─────────────────────────────────────────────────┐
│  导入小说                                  [X]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  文件：example.txt                    [选择]   │
│                                                 │
│  章节识别规则：                                 │
│  ┌─────────────────────────────────────────┐   │
│  │ ^第.+章                                 │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  预览（识别到 12 个章节）：                     │
│  ┌─────────────────────────────────────────┐   │
│  │ ✓ 第一章 开端          3,500 字         │   │
│  │ ✓ 第二章 转折          4,200 字         │   │
│  │ ✓ 第三章 高潮          2,800 字         │   │
│  │ ...                                     │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│              [取消]  [导入]                    │
└─────────────────────────────────────────────────┘
```

## 实现要点

### 1. Rust 后端：拆章逻辑

```rust
// src-tauri/src/import.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterPreview {
    pub title: String,
    pub content: String,
    pub word_count: u32,
}

#[tauri::command]
pub async fn preview_import(
    file_path: String,
    pattern: String,  // 正则表达式
) -> Result<Vec<ChapterPreview>, String> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("读取文件失败: {}", e))?;
    
    let regex = regex::Regex::new(&pattern)
        .map_err(|e| format!("正则表达式无效: {}", e))?;
    
    let mut chapters = Vec::new();
    let mut last_end = 0;
    let mut last_title = String::new();
    
    for mat in regex.find_iter(&content) {
        if last_end > 0 {
            let chapter_content = content[last_end..mat.start()].trim().to_string();
            chapters.push(ChapterPreview {
                title: last_title.clone(),
                word_count: count_words(&chapter_content),
                content: chapter_content,
            });
        }
        last_title = mat.as_str().trim().to_string();
        last_end = mat.end();
    }
    
    // 最后一章
    if last_end > 0 && last_end < content.len() {
        let chapter_content = content[last_end..].trim().to_string();
        chapters.push(ChapterPreview {
            title: last_title,
            word_count: count_words(&chapter_content),
            content: chapter_content,
        });
    }
    
    Ok(chapters)
}

#[tauri::command]
pub async fn import_chapters(
    project_path: String,
    chapters: Vec<ChapterPreview>,
) -> Result<Vec<ChapterMeta>, String> {
    // 批量创建章节
    let mut created = Vec::new();
    for (i, preview) in chapters.iter().enumerate() {
        let meta = create_chapter_with_content(
            &project_path,
            &preview.title,
            &preview.content,
            i as u32 + 1,
        )?;
        created.push(meta);
    }
    Ok(created)
}
```

### 2. 前端：ImportModal.tsx

```tsx
import { Modal, Input, List, Button, Checkbox, message } from "antd";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";

interface ImportModalProps {
  visible: boolean;
  projectPath: string;
  onCancel: () => void;
  onSuccess: () => void;
}

export function ImportModal({ visible, projectPath, onCancel, onSuccess }: ImportModalProps) {
  const [filePath, setFilePath] = useState("");
  const [pattern, setPattern] = useState("^第.+章");
  const [previews, setPreviews] = useState<ChapterPreview[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSelectFile = async () => {
    const selected = await open({
      filters: [{ name: "文本文件", extensions: ["txt"] }],
    });
    if (selected) {
      setFilePath(selected as string);
      await handlePreview(selected as string, pattern);
    }
  };

  const handlePreview = async (file: string, pat: string) => {
    try {
      const result = await invoke<ChapterPreview[]>("preview_import", {
        filePath: file,
        pattern: pat,
      });
      setPreviews(result);
    } catch (e) {
      message.error(`预览失败: ${e}`);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      await invoke("import_chapters", {
        projectPath,
        chapters: previews,
      });
      message.success(`成功导入 ${previews.length} 个章节`);
      onSuccess();
    } catch (e) {
      message.error(`导入失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="导入小说"
      open={visible}
      onCancel={onCancel}
      onOk={handleImport}
      okText="导入"
      confirmLoading={loading}
      width={600}
    >
      <div style={{ marginBottom: 16 }}>
        <label>文件：</label>
        <Input.Search
          value={filePath}
          placeholder="选择 txt 文件"
          enterButton="选择"
          onSearch={handleSelectFile}
          readOnly
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>章节识别规则（正则）：</label>
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onBlur={() => filePath && handlePreview(filePath, pattern)}
          placeholder="^第.+章"
        />
      </div>

      {previews.length > 0 && (
        <div>
          <div style={{ marginBottom: 8 }}>
            预览（识别到 {previews.length} 个章节）：
          </div>
          <List
            size="small"
            bordered
            dataSource={previews}
            style={{ maxHeight: 300, overflow: "auto" }}
            renderItem={(item, index) => (
              <List.Item>
                <span>{index + 1}. {item.title}</span>
                <span style={{ color: "#999" }}>
                  {item.word_count.toLocaleString()} 字
                </span>
              </List.Item>
            )}
          />
        </div>
      )}
    </Modal>
  );
}
```

### 3. 常用正则预设

```typescript
const CHAPTER_PATTERNS = [
  { label: "第X章", value: "^第.+章" },
  { label: "Chapter X", value: "^Chapter\\s+\\d+" },
  { label: "数字章节", value: "^\\d+[.、]" },
  { label: "【章节】", value: "^【.+】" },
];
```

## 验收标准

- [ ] 能选择 txt 文件
- [ ] 正则输入框可编辑
- [ ] 预览列表正确显示章节
- [ ] 修改正则后预览自动更新
- [ ] 导入后章节正确创建
- [ ] 字数统计正确
- [ ] 错误处理（文件不存在、正则无效等）

## 文件变更

- 新增：`src-tauri/src/import.rs`
- 新增：`src/components/Project/ImportModal.tsx`
- 修改：`src-tauri/src/lib.rs`（注册 commands）
- 修改：`src-tauri/Cargo.toml`（添加 regex 依赖）

## 依赖

- T3.3 完成（章节 CRUD）
- T3.4 完成（章节列表 UI）

---

*任务创建时间：2026-02-02*
