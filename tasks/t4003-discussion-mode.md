# T4.3 实现讨论模式（带 Tool 能力）

## 目标
实现 AI 讨论模式，AI 作为写作顾问，可以**主动调用 Tools** 来读取章节、搜索摘要、辅助创作。

## 核心理念

**不是普通对话，而是 AI Agent**：
- AI 可以自主决定调用哪些 Tools
- 用户说"帮我看看第三章的角色设定"→ AI 自己调用 read 读取章节
- 用户说"之前写过类似的情节吗"→ AI 自己调用 search 搜索摘要

## 输入
- T4.2 完成的 AI 面板 UI
- T1.5 完成的 Tool 调用能力（ai-engine + Tauri）

## 输出
- 讨论模式的完整 Agent 功能
- Tool 调用的 UI 展示

## 可用 Tools

```typescript
// 已在 ai-engine 中定义的 Tools
const tools = {
  read: {
    description: "读取文件内容",
    parameters: { path: string, offset?: number, limit?: number }
  },
  write: {
    description: "写入文件（覆盖）",
    parameters: { path: string, content: string }
  },
  append: {
    description: "追加内容到文件末尾",
    parameters: { path: string, content: string }
  },
  list: {
    description: "列出目录内容",
    parameters: { path: string }
  },
  search: {
    description: "在文件中搜索关键词",
    parameters: { path: string, query: string }
  }
};
```

## 系统提示词

```
你是一位专业的小说写作顾问 AI Agent。你可以使用以下工具来帮助作者：

## 可用工具
- read: 读取章节内容或配置文件
- list: 列出章节目录
- search: 搜索摘要或章节中的关键词

## 项目结构
当前项目目录：{projectPath}
- chapters/ — 章节文件（chapter_001.txt, chapter_002.txt...）
- chapters/index.json — 章节索引
- summaries.json — 摘要记录
- config.json — 项目配置

## 工作方式
1. 当用户询问章节内容时，主动使用 read 工具读取
2. 当用户询问之前的情节时，使用 search 搜索摘要
3. 当需要了解项目结构时，使用 list 列出目录
4. 基于读取的内容给出专业、具体的建议

## 注意
- 你是顾问角色，讨论模式下不要直接修改文件
- 给出建议时要具体，引用你读取到的内容
- 如果用户没有指定章节，先用 list 查看有哪些章节
```

## Tool 调用流程

```
用户: "帮我看看第三章的开头写得怎么样"
     ↓
AI 决定调用 Tool
     ↓
AI → Tauri: { tool: "read", args: { path: "chapters/chapter_003.txt", limit: 50 } }
     ↓
Tauri 执行文件读取
     ↓
Tauri → AI: { result: "第三章内容..." }
     ↓
AI 基于内容生成回复: "第三章开头的氛围营造不错，但是..."
```

## UI 展示 Tool 调用

```tsx
// 消息中显示 Tool 调用过程
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: string;
  status: 'pending' | 'success' | 'error';
}

// ChatMessage 组件
function ChatMessage({ message }: { message: Message }) {
  return (
    <div className="chat-message">
      {/* 显示 Tool 调用 */}
      {message.toolCalls?.map(call => (
        <div key={call.id} className="tool-call">
          <span className="tool-icon">🔧</span>
          <span className="tool-name">{call.name}</span>
          <span className="tool-args">{JSON.stringify(call.args)}</span>
          {call.status === 'pending' && <Spin size="small" />}
          {call.status === 'success' && <CheckOutlined />}
        </div>
      ))}
      
      {/* AI 回复内容 */}
      <div className="message-content">{message.content}</div>
    </div>
  );
}
```

## 示例对话

**用户**：帮我看看目前写了哪些章节

**AI**（调用 list）：
```
🔧 list { path: "chapters" }
```

**AI**：目前项目中有 5 个章节：
1. 第一章：初遇（3200字）
2. 第二章：误会（2800字）
...

---

**用户**：第二章的结尾感觉有点仓促，你觉得呢？

**AI**（调用 read）：
```
🔧 read { path: "chapters/chapter_002.txt", offset: -100 }
```

**AI**：我看了第二章的结尾，确实有些仓促。主要问题是...建议可以...

---

**用户**：之前有没有写过类似的告别场景？

**AI**（调用 search）：
```
🔧 search { path: "summaries.json", query: "告别" }
```

**AI**：在第三章的摘要中提到过一次告别场景...

## 验收标准
1. [ ] AI 能自主决定何时调用 Tool
2. [ ] Tool 调用正确执行并返回结果
3. [ ] UI 显示 Tool 调用过程
4. [ ] AI 基于 Tool 结果给出有价值的回复
5. [ ] 对话上下文正确维护
6. [ ] 错误处理（Tool 调用失败）
7. [ ] `npm run build` 和 `cargo test` 通过

## 技术要点
- 使用 Vercel AI SDK 的 tool calling 能力
- Tool 结果要回传给 AI 继续生成
- 流式输出时也要显示 Tool 调用状态
