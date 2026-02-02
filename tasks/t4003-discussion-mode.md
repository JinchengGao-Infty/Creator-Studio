# T4.3 实现讨论模式

## 目标
实现 AI 讨论模式，用户可以与 AI 自由对话讨论创作思路。

## 输入
- T4.2 完成的 AI 面板 UI
- 现有的 ai_bridge.rs（AI 调用能力）

## 输出
- 讨论模式的完整功能
- 流式输出支持

## 功能描述

### 讨论模式特点
- 自由对话，无特定格式要求
- AI 作为写作顾问角色
- 可以讨论：角色设定、情节走向、世界观、写作技巧等
- 对话历史完整保留

### 系统提示词
```
你是一位专业的小说写作顾问。你的任务是帮助作者：
- 讨论角色设定和人物关系
- 探讨情节发展和故事走向
- 分析世界观和背景设定
- 提供写作技巧和建议
- 解答创作过程中的疑问

请用专业但友好的语气回答，给出具体、有建设性的建议。
如果作者提供了章节内容，请基于内容给出针对性的反馈。
```

## 实现要点

### 1. AI 调用流程
```
用户输入 → 保存用户消息 → 构建 messages 数组 → 调用 AI → 流式返回 → 保存 AI 消息
```

### 2. 消息构建
```typescript
function buildMessages(session: Session, messages: Message[], systemPrompt: string) {
  return [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role.toLowerCase(),
      content: m.content
    }))
  ];
}
```

### 3. 流式输出
```rust
// src-tauri/src/ai_bridge.rs 扩展

#[tauri::command]
pub async fn chat_stream(
    window: tauri::Window,
    project_path: String,
    session_id: String,
    messages: Vec<ChatMessage>,
    provider_config: ProviderConfig,
) -> Result<(), String> {
    // 调用 AI API
    // 每收到一个 chunk，emit 事件
    window.emit("ai:chunk", chunk)?;
    
    // 完成后 emit 完成事件
    window.emit("ai:done", full_content)?;
    
    Ok(())
}
```

### 4. 前端监听流式输出
```typescript
// hooks/useAIChat.ts
import { listen } from '@tauri-apps/api/event';

export function useAIChat() {
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    const unlistenChunk = listen('ai:chunk', (event) => {
      setStreamingContent(prev => prev + event.payload);
    });

    const unlistenDone = listen('ai:done', (event) => {
      setIsStreaming(false);
      // 保存完整消息到后端
    });

    return () => {
      unlistenChunk.then(fn => fn());
      unlistenDone.then(fn => fn());
    };
  }, []);

  const sendMessage = async (content: string) => {
    setIsStreaming(true);
    setStreamingContent('');
    await invoke('chat_stream', { ... });
  };

  return { streamingContent, isStreaming, sendMessage };
}
```

### 5. 上下文窗口管理
```typescript
// 限制发送给 AI 的消息数量，避免超出 token 限制
const MAX_CONTEXT_MESSAGES = 20;

function getContextMessages(messages: Message[]) {
  if (messages.length <= MAX_CONTEXT_MESSAGES) {
    return messages;
  }
  // 保留最近的消息
  return messages.slice(-MAX_CONTEXT_MESSAGES);
}
```

## UI 更新

### ChatMessages.tsx 更新
```tsx
// 显示流式输出
{isStreaming && (
  <div className="chat-message assistant">
    <div className="bubble">
      {streamingContent}
      <span className="typing-cursor">|</span>
    </div>
  </div>
)}
```

### ChatInput.tsx 更新
```tsx
// 发送中禁用
<Button 
  type="primary" 
  onClick={handleSend}
  disabled={isStreaming || !inputValue.trim()}
  loading={isStreaming}
>
  发送
</Button>
```

## 验收标准
1. [ ] 能发送消息并收到 AI 回复
2. [ ] 流式输出正常显示
3. [ ] 对话历史正确保存
4. [ ] 切换会话后历史正确加载
5. [ ] 上下文窗口限制生效
6. [ ] 错误处理（网络错误、API 错误）
7. [ ] `npm run build` 和 `cargo test` 通过

## 测试场景
1. 发送"帮我设计一个反派角色"
2. 继续追问"他的动机是什么"
3. 验证上下文连贯
4. 切换会话再切回，验证历史保留
