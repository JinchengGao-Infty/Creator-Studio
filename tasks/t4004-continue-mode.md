# T4.4 实现续写模式（JSON 解析）

## 目标
实现 AI 续写模式，生成正文内容和摘要，支持应用到章节。

## 输入
- T4.2 完成的 AI 面板 UI
- T4.3 完成的流式输出基础
- 当前章节内容

## 输出
- 续写模式的完整功能
- JSON 解析和应用到章节

## 功能描述

### 续写模式特点
- 基于当前章节内容续写
- AI 返回 JSON 格式（正文 + 摘要）
- 用户可预览后选择"追加"或"替换"
- 摘要自动保存到项目

### 系统提示词
```
你是一位专业的小说续写助手。请根据用户提供的章节内容和指令进行续写。

输出格式要求（严格 JSON）：
{
  "content": "续写的正文内容...",
  "summary": "本次续写内容的简要摘要（50-100字）"
}

写作要求：
1. 保持与原文一致的文风和叙事视角
2. 情节发展要合理连贯
3. 人物行为要符合性格设定
4. 摘要要概括主要情节和人物动作

注意：只输出 JSON，不要有其他内容。
```

### 用户消息构建
```typescript
function buildContinuePrompt(chapterContent: string, userInstruction: string) {
  return `
当前章节内容：
---
${chapterContent.slice(-3000)}  // 取最后 3000 字作为上下文
---

续写指令：${userInstruction || '请继续往下写'}
`;
}
```

## 实现要点

### 1. JSON 解析
```typescript
interface ContinueResult {
  content: string;
  summary: string;
}

function parseContinueResult(aiResponse: string): ContinueResult {
  // 尝试直接解析
  try {
    return JSON.parse(aiResponse);
  } catch {
    // 尝试提取 JSON 块
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('无法解析 AI 返回的 JSON');
  }
}
```

### 2. 续写结果预览组件
```tsx
// components/AIPanel/ContinuePreview.tsx
interface ContinuePreviewProps {
  result: ContinueResult;
  onAppend: () => void;    // 追加到章节末尾
  onReplace: () => void;   // 替换选中内容（可选）
  onDiscard: () => void;   // 放弃
}

function ContinuePreview({ result, onAppend, onReplace, onDiscard }: ContinuePreviewProps) {
  return (
    <div className="continue-preview">
      <div className="preview-header">
        <span>续写预览</span>
        <span className="word-count">{result.content.length} 字</span>
      </div>
      
      <div className="preview-content">
        {result.content}
      </div>
      
      <div className="preview-summary">
        <strong>摘要：</strong>{result.summary}
      </div>
      
      <div className="preview-actions">
        <Button type="primary" onClick={onAppend}>追加到章节</Button>
        <Button onClick={onDiscard}>放弃</Button>
      </div>
    </div>
  );
}
```

### 3. 应用到章节
```typescript
// 追加到章节
async function appendToChapter(projectPath: string, chapterId: string, content: string) {
  const currentContent = await invoke('get_chapter_content', { projectPath, chapterId });
  const newContent = currentContent + '\n\n' + content;
  await invoke('save_chapter_content', { projectPath, chapterId, content: newContent });
  
  // 触发编辑器刷新
  window.dispatchEvent(new CustomEvent('creatorai:chapterUpdated', { 
    detail: { chapterId, content: newContent } 
  }));
}
```

### 4. 摘要保存
```typescript
// 保存摘要到项目
interface Summary {
  id: string;
  chapterId: string;
  sessionId: string;
  content: string;
  timestamp: number;
}

// Tauri command
#[tauri::command]
pub async fn add_summary(
    project_path: String,
    chapter_id: String,
    session_id: String,
    content: String,
) -> Result<Summary, String>
```

### 5. 续写流程
```
1. 用户输入续写指令（或使用默认"继续写"）
2. 构建 prompt（章节内容 + 指令）
3. 调用 AI（非流式，等待完整 JSON）
4. 解析 JSON
5. 显示预览
6. 用户选择追加/放弃
7. 追加时：更新章节 + 保存摘要 + 保存消息
```

## UI 更新

### 续写模式的消息显示
```tsx
// 续写模式的 AI 消息显示不同
{message.metadata?.summary && (
  <div className="continue-message">
    <div className="continue-content">
      {message.content}
    </div>
    <div className="continue-summary">
      摘要：{message.metadata.summary}
    </div>
    {!message.metadata.applied && (
      <Button size="small" onClick={() => handleApply(message)}>
        应用到章节
      </Button>
    )}
    {message.metadata.applied && (
      <Tag color="green">已应用</Tag>
    )}
  </div>
)}
```

## 验收标准
1. [ ] 能发送续写指令
2. [ ] AI 返回正确的 JSON 格式
3. [ ] JSON 解析正确处理各种情况
4. [ ] 预览显示正常
5. [ ] "追加到章节"功能正常
6. [ ] 摘要正确保存
7. [ ] 编辑器内容正确更新
8. [ ] 消息历史记录续写结果
9. [ ] `npm run build` 和 `cargo test` 通过

## 测试场景
1. 打开一个有内容的章节
2. 切换到续写模式
3. 输入"写一段打斗场面"
4. 验证返回 JSON 并正确解析
5. 点击"追加到章节"
6. 验证章节内容更新
7. 验证摘要保存
