# T3.8 实现自动保存

## 目标

实现编辑器的自动保存功能，防止用户丢失内容。

## 背景

写作过程中，用户可能忘记手动保存。自动保存需要：
- 防抖保存（停止输入 2 秒后自动保存）
- 保存状态指示
- 窗口关闭前检查未保存内容

## 实现要点

### 1. useAutoSave.ts

```typescript
import { useEffect, useRef, useCallback, useState } from "react";

type SaveStatus = "saved" | "saving" | "unsaved";

interface UseAutoSaveOptions {
  delay?: number;  // 防抖延迟，默认 2000ms
  onSave: (content: string) => Promise<void>;
}

export function useAutoSave(
  content: string,
  { delay = 2000, onSave }: UseAutoSaveOptions
) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [lastSavedContent, setLastSavedContent] = useState(content);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isSavingRef = useRef(false);

  // 内容变化时标记为未保存
  useEffect(() => {
    if (content !== lastSavedContent) {
      setStatus("unsaved");
    }
  }, [content, lastSavedContent]);

  // 防抖保存
  useEffect(() => {
    if (content === lastSavedContent) return;

    // 清除之前的定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    // 设置新的定时器
    timerRef.current = setTimeout(async () => {
      if (isSavingRef.current) return;
      
      isSavingRef.current = true;
      setStatus("saving");
      
      try {
        await onSave(content);
        setLastSavedContent(content);
        setStatus("saved");
      } catch (error) {
        console.error("Auto-save failed:", error);
        setStatus("unsaved");
      } finally {
        isSavingRef.current = false;
      }
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [content, lastSavedContent, delay, onSave]);

  // 手动保存
  const save = useCallback(async () => {
    if (content === lastSavedContent) return;
    if (isSavingRef.current) return;

    // 清除定时器
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    isSavingRef.current = true;
    setStatus("saving");

    try {
      await onSave(content);
      setLastSavedContent(content);
      setStatus("saved");
    } catch (error) {
      console.error("Save failed:", error);
      setStatus("unsaved");
      throw error;
    } finally {
      isSavingRef.current = false;
    }
  }, [content, lastSavedContent, onSave]);

  // 重置（切换章节时调用）
  const reset = useCallback((newContent: string) => {
    setLastSavedContent(newContent);
    setStatus("saved");
  }, []);

  return {
    status,
    save,
    reset,
    hasUnsavedChanges: content !== lastSavedContent,
  };
}
```

### 2. 窗口关闭前检查

```typescript
// hooks/useBeforeUnload.ts
import { useEffect } from "react";

export function useBeforeUnload(hasUnsavedChanges: boolean) {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ""; // 现代浏览器需要这个
        return "你有未保存的更改，确定要离开吗？";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);
}
```

### 3. 集成到 Editor

```tsx
// Editor.tsx 修改
import { useAutoSave } from "./useAutoSave";
import { useBeforeUnload } from "../../hooks/useBeforeUnload";

export function Editor({
  chapterId,
  chapterTitle,
  initialContent,
  onSave,
}: EditorProps) {
  const { value, set, undo, redo, reset } = useUndoRedo(initialContent);
  
  const handleSave = useCallback(async (content: string) => {
    await onSave(chapterId, content);
  }, [chapterId, onSave]);

  const { status, save, reset: resetAutoSave, hasUnsavedChanges } = useAutoSave(
    value,
    { delay: 2000, onSave: handleSave }
  );

  // 窗口关闭前检查
  useBeforeUnload(hasUnsavedChanges);

  // 切换章节时重置
  useEffect(() => {
    reset(initialContent);
    resetAutoSave(initialContent);
  }, [chapterId, initialContent]);

  // Ctrl+S 手动保存
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [save]);

  return (
    <div className="editor">
      <EditorHeader
        title={chapterTitle}
        wordCount={countWords(value)}
        saveStatus={status}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <textarea
        className="editor-textarea"
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="开始写作..."
      />
    </div>
  );
}
```

### 4. Tauri 窗口关闭事件

```typescript
// 在 App.tsx 中
import { listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";

useEffect(() => {
  const unlisten = listen("tauri://close-requested", async (event) => {
    if (hasUnsavedChanges) {
      const confirmed = await confirm(
        "你有未保存的更改，确定要退出吗？",
        { title: "确认退出", type: "warning" }
      );
      if (!confirmed) {
        return; // 阻止关闭
      }
    }
    // 允许关闭
    await appWindow.close();
  });

  return () => {
    unlisten.then((fn) => fn());
  };
}, [hasUnsavedChanges]);
```

## 验收标准

- [ ] 停止输入 2 秒后自动保存
- [ ] 保存状态正确显示（已保存/保存中/未保存）
- [ ] Ctrl+S 手动保存正常
- [ ] 切换章节时正确处理未保存内容
- [ ] 关闭窗口前有未保存提示
- [ ] 保存失败有错误处理

## 文件变更

- 新增：`src/components/Editor/useAutoSave.ts`
- 新增：`src/hooks/useBeforeUnload.ts`
- 修改：`src/components/Editor/Editor.tsx`
- 修改：`src/App.tsx`

## 依赖

- T3.6 完成（编辑器）
- T3.7 完成（字数统计）

---

*任务创建时间：2026-02-02*
