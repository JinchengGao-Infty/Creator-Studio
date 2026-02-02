# T3.10 实现主界面布局与 AI 对话面板

## 目标

搭建 VS Code 风格的整体布局，并实现右侧 AI 对话面板（简化版：只有对话框 + 历史 + 会话切换）。

## 背景

**设计简化：**
- 不再区分"续写模式"和"讨论模式"
- 用户想续写就说"帮我续写"，想讨论就直接聊
- 提示词控制行为，前端只负责对话

**复用现有代码：**
- `src/App.tsx` 已有 AI 调用逻辑（`getActiveChatConfig`、`invoke("ai_chat")`）
- `src/components/Settings/` 已有设置页
- 象牙白配色已确定

## 整体布局

```
┌──────┬────────────────┬──────────────────┬─────────────────┐
│ 活动 │    侧边栏       │      编辑器       │    AI 助手      │
│  栏  │   (240px)      │    (flex: 1)     │    (360px)      │
│      │                │                  │                 │
│ 48px │ - 章节列表      │   正文编辑区域    │  对话输入框     │
│      │                │                  │  对话历史       │
│ 📁   │                │                  │  会话切换       │
│ ⚙️   │                │                  │                 │
└──────┴────────────────┴──────────────────┴─────────────────┘
```

**活动栏图标：**
- 📁 章节（切换到章节列表）
- ⚙️ 设置（切换到设置面板）

## 组件结构

```
src/
├── App.tsx                    # 主入口，管理全局状态
├── layouts/
│   └── MainLayout.tsx         # VS Code 风格布局
├── components/
│   ├── ActivityBar/
│   │   └── ActivityBar.tsx    # 左侧活动栏
│   ├── Sidebar/
│   │   ├── ChapterList.tsx    # 章节列表（已有任务 t3004）
│   │   └── index.ts
│   ├── Editor/
│   │   └── Editor.tsx         # 编辑器（已有任务 t3006）
│   ├── AIPanel/
│   │   ├── AIPanel.tsx        # AI 面板主组件
│   │   ├── ChatInput.tsx      # 对话输入框
│   │   ├── ChatHistory.tsx    # 对话历史
│   │   ├── SessionList.tsx    # 会话列表（切换对话）
│   │   └── index.ts
│   ├── Settings/              # 已有
│   └── Project/               # 已有任务 t3002
```

## 实现要点

### 1. MainLayout.tsx

```tsx
import { useState } from "react";
import { ActivityBar } from "../components/ActivityBar";
import { Sidebar } from "../components/Sidebar";
import { Editor } from "../components/Editor";
import { AIPanel } from "../components/AIPanel";
import { SettingsPanel } from "../components/Settings";
import "./main-layout.css";

type SidebarView = "chapters" | "settings";

interface MainLayoutProps {
  projectPath: string;
  // ... 其他 props
}

export function MainLayout({ projectPath }: MainLayoutProps) {
  const [sidebarView, setSidebarView] = useState<SidebarView>("chapters");

  return (
    <div className="main-layout">
      <ActivityBar
        activeView={sidebarView}
        onViewChange={setSidebarView}
      />
      
      <aside className="sidebar">
        {sidebarView === "chapters" && <Sidebar projectPath={projectPath} />}
        {sidebarView === "settings" && <SettingsPanel />}
      </aside>
      
      <main className="editor-area">
        <Editor />
      </main>
      
      <aside className="ai-panel">
        <AIPanel projectPath={projectPath} />
      </aside>
    </div>
  );
}
```

### 2. ActivityBar.tsx

```tsx
import { Tooltip } from "antd";
import { FileTextOutlined, SettingOutlined } from "@ant-design/icons";
import "./activity-bar.css";

interface ActivityBarProps {
  activeView: string;
  onViewChange: (view: "chapters" | "settings") => void;
}

export function ActivityBar({ activeView, onViewChange }: ActivityBarProps) {
  const items = [
    { key: "chapters", icon: <FileTextOutlined />, label: "章节" },
    { key: "settings", icon: <SettingOutlined />, label: "设置" },
  ];

  return (
    <div className="activity-bar">
      {items.map((item) => (
        <Tooltip key={item.key} title={item.label} placement="right">
          <div
            className={`activity-bar-item ${activeView === item.key ? "active" : ""}`}
            onClick={() => onViewChange(item.key as "chapters" | "settings")}
          >
            {item.icon}
          </div>
        </Tooltip>
      ))}
    </div>
  );
}
```

### 3. AIPanel.tsx（简化版）

```tsx
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChatInput } from "./ChatInput";
import { ChatHistory } from "./ChatHistory";
import { SessionList } from "./SessionList";
import "./ai-panel.css";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface Session {
  id: string;
  name: string;
  messages: Message[];
  created: number;
}

interface AIPanelProps {
  projectPath: string;
}

export function AIPanel({ projectPath }: AIPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const handleSend = async (content: string) => {
    if (!currentSession) return;
    
    // 添加用户消息
    const userMessage: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    
    // 更新 UI
    // ...
    
    setLoading(true);
    try {
      // 调用 AI（复用现有逻辑）
      const result = await invoke("ai_chat", {
        // ... 参数
      });
      
      // 添加 AI 回复
      const assistantMessage: Message = {
        role: "assistant",
        content: String(result),
        timestamp: Date.now(),
      };
      
      // 更新 UI
      // ...
    } catch (error) {
      // 错误处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-panel">
      <div className="ai-panel-header">
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={setCurrentSessionId}
          onCreate={() => { /* 创建新会话 */ }}
        />
      </div>
      
      <ChatHistory
        messages={currentSession?.messages || []}
        loading={loading}
      />
      
      <ChatInput
        onSend={handleSend}
        disabled={loading || !currentSession}
      />
    </div>
  );
}
```

### 4. ChatInput.tsx

```tsx
import { Input, Button } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { useState } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value.trim());
    setValue("");
  };

  return (
    <div className="chat-input">
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="输入消息..."
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPressEnter={(e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        发送
      </Button>
    </div>
  );
}
```

### 5. ChatHistory.tsx

```tsx
import { Spin } from "antd";
import { useEffect, useRef } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ChatHistoryProps {
  messages: Message[];
  loading?: boolean;
}

export function ChatHistory({ messages, loading }: ChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="chat-history">
      {messages.map((msg, i) => (
        <div key={i} className={`chat-message ${msg.role}`}>
          <div className="chat-message-content">{msg.content}</div>
        </div>
      ))}
      {loading && (
        <div className="chat-message assistant">
          <Spin size="small" /> 思考中...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

### 6. 样式（双主题：象牙白 + 深色）

**象牙白主题（Light）**
```css
:root[data-theme="light"] {
  --bg-primary: #fffff0;      /* 主背景 */
  --bg-secondary: #fafaf5;    /* 侧边栏/面板 */
  --bg-tertiary: #f0f0e5;     /* 消息气泡 */
  --border: #e8e8d8;          /* 边框 */
  --text-primary: #333;       /* 主文字 */
  --text-secondary: #666;     /* 次要文字 */
  --text-muted: #999;         /* 弱化文字 */
  --accent: #8b7355;          /* 强调色（棕金） */
  --accent-light: #d4a574;    /* 浅强调色 */
  --user-bubble: #8b7355;     /* 用户消息背景 */
  --user-text: #fff;          /* 用户消息文字 */
}
```

**深色主题（Dark）**
```css
:root[data-theme="dark"] {
  --bg-primary: #1a1a1a;      /* 主背景 */
  --bg-secondary: #242424;    /* 侧边栏/面板 */
  --bg-tertiary: #2d2d2d;     /* 消息气泡 */
  --border: #3a3a3a;          /* 边框 */
  --text-primary: #e8e8e8;    /* 主文字 */
  --text-secondary: #a0a0a0;  /* 次要文字 */
  --text-muted: #666;         /* 弱化文字 */
  --accent: #c9a66b;          /* 强调色（金色） */
  --accent-light: #d4b896;    /* 浅强调色 */
  --user-bubble: #4a3f2f;     /* 用户消息背景 */
  --user-text: #e8e8e8;       /* 用户消息文字 */
}
```

**主题切换**
```tsx
// hooks/useTheme.ts
import { useState, useEffect } from "react";

type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme") as Theme;
    return saved || "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggle = () => setTheme(t => t === "light" ? "dark" : "light");

  return { theme, setTheme, toggle };
}
```

**使用 CSS 变量**
```css
/* main-layout.css */
.main-layout {
  display: flex;
  height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.activity-bar {
  width: 48px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.sidebar {
  width: 240px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border);
}

.chat-message.user .chat-message-content {
  background: var(--user-bubble);
  color: var(--user-text);
}

.chat-message.assistant .chat-message-content {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
```

## 会话数据存储

会话存储在项目目录下：
```
MyNovel/
├── .creatorai/
│   └── sessions/
│       ├── index.json       # 会话索引
│       └── session_001.json # 会话内容
```

### Rust 后端（可选，或直接前端存储）

如果需要后端管理会话，添加：
- `list_sessions(project_path)`
- `create_session(project_path, name)`
- `get_session(project_path, session_id)`
- `save_session(project_path, session_id, messages)`
- `delete_session(project_path, session_id)`

## 验收标准

- [ ] VS Code 风格布局正常显示
- [ ] 活动栏切换侧边栏内容
- [ ] AI 面板能发送消息
- [ ] 对话历史正常显示
- [ ] 能创建/切换会话
- [ ] 象牙白主题样式正确

## 文件变更

- 新增：`src/layouts/MainLayout.tsx`
- 新增：`src/layouts/main-layout.css`
- 新增：`src/components/ActivityBar/ActivityBar.tsx`
- 新增：`src/components/AIPanel/AIPanel.tsx`
- 新增：`src/components/AIPanel/ChatInput.tsx`
- 新增：`src/components/AIPanel/ChatHistory.tsx`
- 新增：`src/components/AIPanel/SessionList.tsx`
- 新增：`src/components/AIPanel/ai-panel.css`
- 修改：`src/App.tsx`（集成 MainLayout）

## 参考资源

### 1. 现有 CreatorAI v2 代码
- `src/App.tsx` — AI 调用逻辑（`getActiveChatConfig`、`invoke("ai_chat")`）
- `src/components/Settings/` — 设置页组件，可直接复用

### 2. 原版 CreatorAI（Python/NiceGUI）
- 位置：`/Users/link/Desktop/CreatorAI/`
- `main.py` — UI 布局参考
- 功能：章节管理、AI 续写、讨论模式

### 3. 开源项目参考
- **VS Code**：https://github.com/microsoft/vscode — 布局结构
- **SillyTavern**：https://github.com/SillyTavern/SillyTavern — AI 对话 UI
- **ChatGPT-Next-Web**：https://github.com/ChatGPTNextWeb/ChatGPT-Next-Web — 对话界面
- **Lobe Chat**：https://github.com/lobehub/lobe-chat — 现代 AI 聊天 UI

### 4. 设计要点
- **不要从头写**，优先复用现有代码和开源组件
- 布局用 CSS Flexbox/Grid，不需要复杂框架
- 对话组件可以参考 ChatGPT-Next-Web 的消息列表实现
- 象牙白配色已定义，保持一致

## 依赖

- T3.2 完成（项目 UI，知道当前 projectPath）
- 复用现有 AI 调用逻辑

---

*任务创建时间：2026-02-02*
