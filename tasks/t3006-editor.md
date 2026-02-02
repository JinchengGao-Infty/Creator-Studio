# T3.6 实现编辑器（textarea + Undo/Redo）

## 目标

实现正文编辑区域，支持基本编辑和撤销/重做功能。

## 背景

编辑器是用户写作的核心区域。暂时用 textarea 实现（后续可升级为 Monaco Editor），需要：
- 基本文本编辑
- Undo/Redo（Ctrl+Z / Ctrl+Shift+Z）
- 内容变化回调（用于自动保存）

## UI 设计

```
┌─────────────────────────────────────────────────────┐
│  第一章 开端                              3,500 字  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  夜幕降临，城市的霓虹灯开始闪烁。李明站在天台上，  │
│  望着远处的高楼大厦，心中五味杂陈。                 │
│                                                     │
│  三年前，他还是一个意气风发的年轻人，怀揣着改变    │
│  世界的梦想来到这座城市。如今，梦想早已被现实磨    │
│  平，只剩下每天重复的工作和无尽的疲惫。            │
│                                                     │
│  "也许，是时候做出改变了。"他喃喃自语。            │
│                                                     │
│  █                                                  │
│                                                     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## 组件结构

```
src/components/
├── Editor/
│   ├── index.ts
│   ├── Editor.tsx           # 主编辑器组件
│   ├── EditorHeader.tsx     # 标题栏（章节名 + 字数）
│   └── useUndoRedo.ts       # Undo/Redo hook
```

## 实现要点

### 1. useUndoRedo.ts

```typescript
import { useState, useCallback, useRef } from "react";

interface UndoRedoState {
  past: string[];
  present: string;
  future: string[];
}

export function useUndoRedo(initialValue: string, maxHistory = 100) {
  const [state, setState] = useState<UndoRedoState>({
    past: [],
    present: initialValue,
    future: [],
  });
  
  // 防抖：避免每次按键都记录历史
  const lastChangeTime = useRef(0);
  const pendingValue = useRef(initialValue);
  
  const set = useCallback((newValue: string, forceRecord = false) => {
    const now = Date.now();
    const shouldRecord = forceRecord || (now - lastChangeTime.current > 1000);
    
    setState((prev) => {
      if (shouldRecord && prev.present !== pendingValue.current) {
        // 记录到历史
        const newPast = [...prev.past, prev.present].slice(-maxHistory);
        lastChangeTime.current = now;
        pendingValue.current = newValue;
        return {
          past: newPast,
          present: newValue,
          future: [],
        };
      }
      // 不记录，只更新当前值
      pendingValue.current = newValue;
      return { ...prev, present: newValue };
    });
  }, [maxHistory]);
  
  const undo = useCallback(() => {
    setState((prev) => {
      if (prev.past.length === 0) return prev;
      const newPast = prev.past.slice(0, -1);
      const newPresent = prev.past[prev.past.length - 1];
      return {
        past: newPast,
        present: newPresent,
        future: [prev.present, ...prev.future],
      };
    });
  }, []);
  
  const redo = useCallback(() => {
    setState((prev) => {
      if (prev.future.length === 0) return prev;
      const newFuture = prev.future.slice(1);
      const newPresent = prev.future[0];
      return {
        past: [...prev.past, prev.present],
        present: newPresent,
        future: newFuture,
      };
    });
  }, []);
  
  const reset = useCallback((value: string) => {
    setState({
      past: [],
      present: value,
      future: [],
    });
    pendingValue.current = value;
  }, []);
  
  return {
    value: state.present,
    set,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
```

### 2. Editor.tsx

```tsx
import { useEffect, useRef } from "react";
import { useUndoRedo } from "./useUndoRedo";
import { EditorHeader } from "./EditorHeader";
import "./editor.css";

interface EditorProps {
  chapterTitle: string;
  initialContent: string;
  onChange: (content: string) => void;
  onSave?: () => void;
}

export function Editor({
  chapterTitle,
  initialContent,
  onChange,
  onSave,
}: EditorProps) {
  const { value, set, undo, redo, reset, canUndo, canRedo } = useUndoRedo(initialContent);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // 当 initialContent 变化时重置（切换章节）
  useEffect(() => {
    reset(initialContent);
  }, [initialContent, reset]);
  
  // 内容变化时通知父组件
  useEffect(() => {
    onChange(value);
  }, [value, onChange]);
  
  // 快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, onSave]);
  
  const wordCount = value.replace(/\s/g, "").length;
  
  return (
    <div className="editor">
      <EditorHeader
        title={chapterTitle}
        wordCount={wordCount}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <textarea
        ref={textareaRef}
        className="editor-textarea"
        value={value}
        onChange={(e) => set(e.target.value)}
        onBlur={() => set(value, true)} // 失焦时强制记录历史
        placeholder="开始写作..."
      />
    </div>
  );
}
```

### 3. EditorHeader.tsx

```tsx
import { Button, Tooltip } from "antd";
import { UndoOutlined, RedoOutlined } from "@ant-design/icons";

interface EditorHeaderProps {
  title: string;
  wordCount: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function EditorHeader({
  title,
  wordCount,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: EditorHeaderProps) {
  return (
    <div className="editor-header">
      <div className="editor-title">{title}</div>
      <div className="editor-actions">
        <Tooltip title="撤销 (Ctrl+Z)">
          <Button
            type="text"
            icon={<UndoOutlined />}
            disabled={!canUndo}
            onClick={onUndo}
          />
        </Tooltip>
        <Tooltip title="重做 (Ctrl+Shift+Z)">
          <Button
            type="text"
            icon={<RedoOutlined />}
            disabled={!canRedo}
            onClick={onRedo}
          />
        </Tooltip>
        <span className="editor-word-count">
          {wordCount.toLocaleString()} 字
        </span>
      </div>
    </div>
  );
}
```

### 4. 样式 editor.css

```css
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fffff0; /* 象牙白 */
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e0;
}

.editor-title {
  font-size: 16px;
  font-weight: 500;
  color: #333;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.editor-word-count {
  font-size: 13px;
  color: #999;
  margin-left: 8px;
}

.editor-textarea {
  flex: 1;
  padding: 24px;
  border: none;
  outline: none;
  resize: none;
  font-size: 16px;
  line-height: 1.8;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
  background: transparent;
  color: #333;
}

.editor-textarea::placeholder {
  color: #ccc;
}
```

## 验收标准

- [ ] 文本编辑正常工作
- [ ] Ctrl+Z 撤销正常
- [ ] Ctrl+Shift+Z 重做正常
- [ ] 撤销/重做按钮状态正确
- [ ] 字数统计实时更新
- [ ] 切换章节时内容正确加载
- [ ] 内容变化能触发 onChange

## 文件变更

- 新增：`src/components/Editor/Editor.tsx`
- 新增：`src/components/Editor/EditorHeader.tsx`
- 新增：`src/components/Editor/useUndoRedo.ts`
- 新增：`src/components/Editor/index.ts`
- 新增：`src/components/Editor/editor.css`

## 依赖

- T3.4 完成（章节列表 UI）

---

*任务创建时间：2026-02-02*
