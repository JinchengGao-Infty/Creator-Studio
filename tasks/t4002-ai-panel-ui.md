# T4.2 AI 面板 UI 框架

## 目标
实现 AI 助手面板的基础 UI 框架，包括消息列表、输入框、模式切换等。

## 输入
- T4.1 完成的会话后端
- T3.10 完成的 MainLayout（已有 AIPanel 占位）

## 输出
- `src/components/AIPanel/` 完善的组件
- 与后端会话 API 的集成

## UI 结构

```
┌─────────────────────────────────┐
│  AI 助手           [+] [设置]   │  ← 标题栏 + 新建会话 + 设置按钮
├─────────────────────────────────┤
│  [讨论] [续写]                  │  ← 模式切换 Tab
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │ 会话: 讨论角色设定  ▼   │   │  ← 会话选择下拉
│  └─────────────────────────┘   │
├─────────────────────────────────┤
│                                 │
│  👤 帮我设计一个反派角色        │  ← 消息列表
│                                 │
│  🤖 好的，我来帮你设计...       │
│     [正在输入...]               │  ← 流式输出状态
│                                 │
├─────────────────────────────────┤
│  ┌─────────────────────────┐   │
│  │ 输入消息...              │   │  ← 输入框
│  └─────────────────────────┘   │
│  [发送]                         │  ← 发送按钮
└─────────────────────────────────┘
```

## 组件结构

### AIPanel.tsx（主容器）
```tsx
interface AIPanelProps {
  projectPath: string;
  currentChapterId: string | null;
  currentChapterContent: string;
}

// 状态
- currentMode: 'discussion' | 'continue'
- currentSessionId: string | null
- sessions: Session[]
- messages: Message[]
- isLoading: boolean
- streamingContent: string
```

### AIPanelHeader.tsx
- 标题
- 新建会话按钮
- 设置按钮（打开写作预设）

### ModeTab.tsx
- 讨论/续写模式切换
- 切换时可能需要切换会话

### SessionSelector.tsx
- 当前会话下拉选择
- 显示会话名称
- 点击展开会话列表
- 支持搜索（可选）

### ChatMessages.tsx
- 消息列表渲染
- 用户消息样式（右侧，主题色背景）
- AI 消息样式（左侧，浅色背景）
- 流式输出时显示打字效果
- 续写模式显示"应用到章节"按钮

### ChatInput.tsx
- 多行输入框（Ant Design Input.TextArea）
- 发送按钮
- Ctrl+Enter 发送快捷键
- 发送中禁用输入

## 样式要点

```css
/* 适配双主题 */
.ai-panel {
  background: var(--bg-secondary);
  border-left: 1px solid var(--border);
}

.chat-message.user .bubble {
  background: var(--user-bubble);
  color: var(--user-text);
  border-radius: 12px 12px 4px 12px;
}

.chat-message.assistant .bubble {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border-radius: 12px 12px 12px 4px;
}

.mode-tab {
  border-bottom: 1px solid var(--border);
}

.mode-tab-item.active {
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
}
```

## 状态管理

```tsx
// hooks/useAIPanel.ts
export function useAIPanel(projectPath: string) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 加载会话列表
  useEffect(() => {
    invoke('list_sessions', { projectPath }).then(setSessions);
  }, [projectPath]);

  // 切换会话时加载消息
  useEffect(() => {
    if (currentSessionId) {
      invoke('get_session_messages', { projectPath, sessionId: currentSessionId })
        .then(setMessages);
    }
  }, [currentSessionId]);

  // 创建会话
  const createSession = async (name: string, mode: SessionMode) => { ... };

  // 发送消息（暂时只保存，不调用 AI）
  const sendMessage = async (content: string) => { ... };

  return { sessions, currentSessionId, messages, isLoading, createSession, sendMessage, ... };
}
```

## 验收标准
1. [ ] 能显示会话列表并切换
2. [ ] 能创建新会话
3. [ ] 能显示消息历史
4. [ ] 能发送消息（保存到后端）
5. [ ] 模式切换 Tab 正常工作
6. [ ] 样式适配双主题
7. [ ] `npm run build` 通过

## 注意事项
- 本任务不实现 AI 调用，只做 UI 框架
- AI 调用在 T4.3/T4.4 实现
- 流式输出的 UI 先做好，但不接入真实数据
