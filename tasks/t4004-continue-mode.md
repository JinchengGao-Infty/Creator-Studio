# T4.4 实现续写模式（带 Tool 能力）

## 目标
实现 AI 续写模式，AI 作为写作助手，可以**主动读取上下文、写入章节、保存摘要**。

## 核心理念

**不是简单的"生成文本"，而是 AI Agent 自主完成写作任务**：
- AI 自己读取当前章节内容作为上下文
- AI 自己搜索相关摘要保持连贯性
- AI 生成内容后自己追加到章节
- AI 自己保存本次续写的摘要

## 输入
- T4.2 完成的 AI 面板 UI
- T4.3 完成的 Tool 调用基础
- 写作预设配置

## 输出
- 续写模式的完整 Agent 功能
- 自动化的续写工作流

## 可用 Tools（续写模式增强）

```typescript
const tools = {
  // 基础 Tools（同讨论模式）
  read: { ... },
  list: { ... },
  search: { ... },
  
  // 续写模式专用 Tools
  append: {
    description: "追加内容到章节末尾",
    parameters: { path: string, content: string }
  },
  write: {
    description: "写入文件（用于保存摘要等）",
    parameters: { path: string, content: string }
  },
  get_chapter_info: {
    description: "获取当前章节信息（路径、字数等）",
    parameters: {}
  },
  save_summary: {
    description: "保存本次续写的摘要",
    parameters: { chapterId: string, summary: string }
  }
};
```

## 系统提示词

```
你是一位专业的小说续写 AI Agent。你的任务是帮助作者续写章节内容。

## 可用工具
- read: 读取章节内容
- search: 搜索摘要获取前情
- append: 追加续写内容到章节
- save_summary: 保存本次续写的摘要

## 工作流程
1. 首先用 read 读取当前章节的最后部分（约2000字）作为上下文
2. 用 search 搜索相关摘要，了解前情和人物关系
3. 根据用户指令和上下文，生成续写内容
4. 询问用户是否满意，满意则用 append 追加到章节
5. 用 save_summary 保存本次续写的摘要（50-100字）

## 写作要求
{writingPreset}

## 当前项目
- 项目路径：{projectPath}
- 当前章节：{currentChapter}

## 注意
- 续写内容要与前文风格一致
- 保持人物性格和情节连贯
- 每次续写后必须保存摘要
- 追加前要先让用户确认
```

## 续写工作流

```
用户: "继续写，主角遇到一个神秘老人"
     ↓
AI 自动执行工作流：
     ↓
1. AI → read { path: "chapters/chapter_003.txt", offset: -2000 }
   ← 获取章节末尾2000字作为上下文
     ↓
2. AI → search { path: "summaries.json", query: "主角 老人" }
   ← 搜索相关摘要
     ↓
3. AI 生成续写内容（约500-1000字）
   → 展示给用户预览
     ↓
4. 用户确认 "可以，追加吧"
     ↓
5. AI → append { path: "chapters/chapter_003.txt", content: "续写内容..." }
   ← 追加到章节
     ↓
6. AI → save_summary { chapterId: "003", summary: "主角在山路上遇到神秘老人，老人给了他一本古籍..." }
   ← 保存摘要
     ↓
AI: "已追加到章节，摘要已保存。还要继续吗？"
```

## UI 展示

```tsx
// 续写模式的消息展示
function ContinueMessage({ message }: { message: Message }) {
  const [showPreview, setShowPreview] = useState(true);
  
  return (
    <div className="continue-message">
      {/* Tool 调用过程 */}
      <div className="tool-calls">
        {message.toolCalls?.map(call => (
          <ToolCallItem key={call.id} call={call} />
        ))}
      </div>
      
      {/* 续写预览 */}
      {message.continueContent && (
        <div className="continue-preview">
          <div className="preview-header">
            <span>续写预览</span>
            <span className="word-count">{message.continueContent.length} 字</span>
          </div>
          <div className="preview-content">
            {message.continueContent}
          </div>
          <div className="preview-actions">
            <Button type="primary" onClick={() => handleConfirm(message)}>
              确认追加
            </Button>
            <Button onClick={() => handleRegenerate(message)}>
              重新生成
            </Button>
            <Button onClick={() => handleDiscard(message)}>
              放弃
            </Button>
          </div>
        </div>
      )}
      
      {/* 摘要 */}
      {message.summary && (
        <div className="summary-saved">
          <Tag color="green">摘要已保存</Tag>
          <span>{message.summary}</span>
        </div>
      )}
    </div>
  );
}
```

## 示例对话

**用户**：继续写，让主角发现一个秘密

**AI**（自动执行）：
```
🔧 read { path: "chapters/chapter_003.txt", offset: -2000 }
🔧 search { path: "summaries.json", query: "秘密 线索" }
```

**AI**：基于前文，我来续写主角发现秘密的情节：

---
*【续写预览】*

李明推开那扇尘封已久的门，一股霉味扑面而来。借着手电筒微弱的光芒，他看到墙上挂着一幅画像——那是他从未见过的祖父年轻时的模样，而祖父身旁站着的那个人...

"这不可能..."李明倒吸一口凉气。

（共 487 字）

---

**[确认追加]** **[重新生成]** **[放弃]**

---

**用户**：可以，追加吧

**AI**（执行写入）：
```
🔧 append { path: "chapters/chapter_003.txt", content: "..." }
🔧 save_summary { chapterId: "003", summary: "李明在老宅发现密室，看到祖父年轻时与神秘人的合影，揭开家族秘密的序幕" }
```

**AI**：✅ 已追加到第三章，摘要已保存。章节现在共 4,521 字。还要继续吗？

## 验收标准
1. [ ] AI 能自动读取章节上下文
2. [ ] AI 能搜索相关摘要
3. [ ] 续写内容展示预览
4. [ ] 用户确认后正确追加到章节
5. [ ] 摘要自动保存
6. [ ] 编辑器实时刷新显示新内容
7. [ ] 支持重新生成
8. [ ] 错误处理（写入失败等）
9. [ ] `npm run build` 和 `cargo test` 通过

## 与讨论模式的区别

| 讨论模式 | 续写模式 |
|---------|---------|
| AI 是顾问，只读不写 | AI 是助手，可以写入 |
| 自由对话 | 结构化工作流 |
| 不修改文件 | 追加内容 + 保存摘要 |
| 给建议 | 直接产出内容 |
