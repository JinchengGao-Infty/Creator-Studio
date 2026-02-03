import { Empty, message } from "antd";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ForwardedRef } from "react";
import type { SaveStatus } from "../StatusBar/StatusBar";
import { useBeforeUnload } from "../../hooks/useBeforeUnload";
import { countWords } from "../../utils/wordCount";
import EditorHeader from "./EditorHeader";
import "./editor.css";
import { useAutoSave } from "./useAutoSave";
import { useUndoRedo } from "./useUndoRedo";

export interface EditorHandle {
  saveNow: () => Promise<boolean>;
  hasUnsavedChanges: () => boolean;
  applyExternalAppend: (content: string) => void;
}

export interface EditorProps {
  projectPath: string;
  chapterId: string | null;
  chapterTitle: string;
  initialContent: string;
  onChange: (content: string) => void;
  onSave: (content: string) => Promise<void>;
  onSaveStatusChange?: (status: SaveStatus) => void;
}

function Editor({
  projectPath,
  chapterId,
  chapterTitle,
  initialContent,
  onChange,
  onSave,
  onSaveStatusChange,
}: EditorProps,
  ref: ForwardedRef<EditorHandle>,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { value, set, undo, redo, reset, canUndo, canRedo } = useUndoRedo(initialContent);

  const { status, save, reset: resetAutoSave, hasUnsavedChanges } = useAutoSave(value, {
    delay: 2000,
    onSave,
  });

  useBeforeUnload(hasUnsavedChanges);

  useImperativeHandle(
    ref,
    () => ({
      saveNow: async () => {
        if (!chapterId) return true;
        try {
          await save();
          return true;
        } catch {
          return false;
        }
      },
      hasUnsavedChanges: () => hasUnsavedChanges,
      applyExternalAppend: (content: string) => {
        if (!chapterId) return;
        if (!content) return;
        set(`${value}${content}`, true);
      },
    }),
    [chapterId, save, hasUnsavedChanges, set, value],
  );

  useEffect(() => {
    onSaveStatusChange?.(status);
    window.dispatchEvent(
      new CustomEvent("creatorai:saveStatus", { detail: { projectPath, saveStatus: status } }),
    );
  }, [status, onSaveStatusChange, projectPath]);

  useEffect(() => {
    onChange(value);
  }, [value, onChange]);

  useEffect(() => {
    reset(initialContent);
    resetAutoSave(initialContent);
  }, [chapterId, initialContent, reset, resetAutoSave]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== textareaRef.current) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save().catch(() => {
          message.error("保存失败，请稍后重试。");
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, save]);

  const prevStatusRef = useRef<SaveStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev !== "saving" || status !== "saved") return;
    window.dispatchEvent(
      new CustomEvent("creatorai:chaptersChanged", { detail: { projectPath, reason: "save" } }),
    );
  }, [status, projectPath]);

  const wordCount = useMemo(() => countWords(value), [value]);

  if (!chapterId) {
    return (
      <div className="editor-empty">
        <Empty description="请选择或新建一个章节开始写作" />
      </div>
    );
  }

  return (
    <div className="editor-root">
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
        onBlur={() => set(value, true)}
        placeholder="开始写作..."
        spellCheck={false}
      />
    </div>
  );
}

const ForwardEditor = forwardRef<EditorHandle, EditorProps>(Editor);
ForwardEditor.displayName = "Editor";
export default ForwardEditor;
