# T4.2 AI 面板 UI 框架（支持 Tool 调用展示）

## 目标
实现 AI 助手面板的基础 UI 框架，**重点支持 Tool 调用过程的可视化展示**。

## 核心理念

这不是普通的聊天界面，而是 **AI Agent 的工作台**：
- 用户能看到 AI 正在调用哪些 Tools
- 用户能看到 Tool 的执行结果
- 用户能理解 AI 的"思考过程"

## 输入
- T4.1 完成的会话后端
- T3.10 完成的 MainLayout（已有 AIPanel 占位）
- T1.5 完成的 Tool 调用能力

## 输出
- `src/components/AIPanel/` 完善的组件
- Tool 调用可视化组件

## UI 结构

```
┌─────────────────────────────────┐
│  AI 助手           [+] [设置]   │  ← 标题栏
├─────────────────────────────────┤
│  [讨论] [续写]                  │  ← 模式切换
├─────────────────────────────────┤
│  会话: 讨论角色设定  ▼          │  ← 会话选择
├─────────────────────────────────┤
│                                 │
│  👤 帮我看看第三章写得怎么样    │
│                                 │
│  🤖 ┌─────────────────────┐    │
│     │ 🔧 read              │    │  ← Tool 调用展示
│     │   path: chapters/... │    │
│     │   ✓ 读取了 2,341 字  │    │
│     └─────────────────────┘    │
│                                 │
│     第三章的开头氛围营造不错... │  ← AI 回复
│                                 │
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │ 输入消息...              │   │
│  └─────────────────────────┘   │
│  [发送]                         │
└─────────────────────────────────┘
```

## 组件结构

### ToolCallDisplay.tsx（Tool 调用展示）
```tsx
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  status: 'calling' | 'success' | 'error';
  result?: string;
  error?: string;
  duration?: number;  // 执行耗时 ms
}

function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  
  const iconMap = {
    read: '📖',
    write: '✏️',
    append: '➕',
    list: '📁',
    search: '🔍',
    save_summary: '💾',
  };
  
  return (
    <div className={`tool-call tool-call-${toolCall.status}`}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span className="tool-icon">{iconMap[toolCall.name] || '🔧'}</span>
        <span className="tool-name">{toolCall.name}</span>
        
        {toolCall.status === 'calling' && <Spin size="small" />}
        {toolCall.status === 'success' && <CheckOutlined style={{ color: 'green' }} />}
        {toolCall.status === 'error' && <CloseOutlined style={{ color: 'red' }} />}
        
        <span className="tool-summary">
          {summarizeToolCall(toolCall)}
        </span>
        
        <ExpandIcon expanded={expanded} />
      </div>
      
      {expanded && (
        <div className="tool-call-details">
          <div className="tool-args">
            <strong>参数：</strong>
            <pre>{JSON.stringify(toolCall.args, null, 2)}</pre>
          </div>
          {toolCall.result && (
            <div className="tool-result">
              <strong>结果：</strong>
              <pre>{truncate(toolCall.result, 500)}</pre>
            </div>
          )}
          {toolCall.error && (
            <div className="tool-error">
              <strong>错误：</strong>
              <span>{toolCall.error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 生成简短摘要
function summarizeToolCall(call: ToolCall): string {
  switch (call.name) {
    case 'read':
      return call.result ? `读取了 ${call.result.length} 字` : '读取中...';
    case 'search':
      return call.result ? `找到 ${JSON.parse(call.result).length} 条结果` : '搜索中...';
    case 'append':
      return call.status === 'success' ? '已追加' : '追加中...';
    case 'save_summary':
      return call.status === 'success' ? '已保存' : '保存中...';
    default:
      return '';
  }
}
```

### ChatMessage.tsx（消息组件，支持 Tool 调用）
```tsx
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: number;
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`chat-message ${message.role}`}>
      <div className="message-avatar">
        {isUser ? '👤' : '🤖'}
      </div>
      
      <div className="message-body">
        {/* Tool 调用展示（AI 消息才有） */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="tool-calls-container">
            {message.toolCalls.map(call => (
              <ToolCallDisplay key={call.id} toolCall={call} />
            ))}
          </div>
        )}
        
        {/* 消息内容 */}
        <div className="message-content">
          <Markdown>{message.content}</Markdown>
        </div>
        
        {/* 时间戳 */}
        <div className="message-time">
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}
```

### 流式输出 + Tool 调用状态
```tsx
function useAIChat(projectPath: string, sessionId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // 监听 Tool 调用开始
    const unlistenToolStart = listen('ai:tool_call_start', (event) => {
      const call = event.payload as ToolCall;
      setPendingToolCalls(prev => [...prev, { ...call, status: 'calling' }]);
    });

    // 监听 Tool 调用完成
    const unlistenToolEnd = listen('ai:tool_call_end', (event) => {
      const { id, result, error } = event.payload;
      setPendingToolCalls(prev => prev.map(call => 
        call.id === id 
          ? { ...call, status: error ? 'error' : 'success', result, error }
          : call
      ));
    });

    // 监听流式内容
    const unlistenChunk = listen('ai:chunk', (event) => {
      setStreamingContent(prev => prev + event.payload);
    });

    // 监听完成
    const unlistenDone = listen('ai:done', (event) => {
      // 将 pending 状态转为完整消息
      const newMessage: Message = {
        id: generateId(),
        role: 'assistant',
        content: event.payload.content,
        toolCalls: pendingToolCalls,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, newMessage]);
      setPendingToolCalls([]);
      setStreamingContent('');
      setIsProcessing(false);
    });

    return () => {
      unlistenToolStart.then(fn => fn());
      unlistenToolEnd.then(fn => fn());
      unlistenChunk.then(fn => fn());
      unlistenDone.then(fn => fn());
    };
  }, []);

  return { messages, pendingToolCalls, streamingContent, isProcessing, ... };
}
```

## 样式

```css
/* Tool 调用样式 */
.tool-call {
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 8px 0;
  font-size: 13px;
}

.tool-call-header {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  gap: 8px;
}

.tool-call-calling {
  border-color: var(--accent);
}

.tool-call-success .tool-call-header {
  color: var(--text-secondary);
}

.tool-call-error {
  border-color: #ff4d4f;
}

.tool-icon {
  font-size: 16px;
}

.tool-name {
  font-family: monospace;
  font-weight: 500;
}

.tool-summary {
  color: var(--text-muted);
  flex: 1;
}

.tool-call-details {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-primary);
}

.tool-call-details pre {
  margin: 4px 0;
  padding: 8px;
  background: var(--bg-secondary);
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  max-height: 200px;
}
```

## 验收标准
1. [ ] 消息列表正常显示
2. [ ] Tool 调用过程可视化（调用中/成功/失败）
3. [ ] Tool 调用详情可展开查看
4. [ ] 流式输出正常显示
5. [ ] 模式切换正常
6. [ ] 会话切换正常
7. [ ] 样式适配双主题
8. [ ] `npm run build` 通过

## 注意事项
- Tool 调用展示要简洁，默认折叠详情
- 调用中状态要有明显的 loading 指示
- 错误状态要醒目但不刺眼
