import { Empty, message } from "antd";
import { invoke } from "@tauri-apps/api/core";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ForwardedRef,
} from "react";
import type { SaveStatus } from "../StatusBar/StatusBar";
import { useBeforeUnload } from "../../hooks/useBeforeUnload";
import { countWords } from "../../utils/wordCount";
import { formatError } from "../../utils/error";
import { aiComplete } from "../../lib/ai";
import EditorHeader from "./EditorHeader";
import "./editor.css";
import { useAutoSave } from "./useAutoSave";
import {
  acceptInlineCompletion,
  clearInlineCompletion,
  getInlineCompletion,
  inlineCompletionField,
  inlineCompletionTheme,
  setInlineCompletion,
} from "./inlineCompletion";

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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const extensionsRef = useRef<Extension>([]);
  const lastSelectionRef = useRef<string>("");
  const [value, setValue] = useState(initialContent);
  const [canUndoState, setCanUndoState] = useState(false);
  const [canRedoState, setCanRedoState] = useState(false);
  const completionTimerRef = useRef<number | null>(null);
  const completionSeqRef = useRef(0);
  const completingRef = useRef(false);

  const { status, save, reset: resetAutoSave, hasUnsavedChanges } = useAutoSave(value, {
    delay: 2000,
    onSave,
  });
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

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
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          changes: { from: view.state.doc.length, insert: content },
          effects: clearInlineCompletion.of(null),
          scrollIntoView: true,
        });
      },
    }),
    [chapterId, hasUnsavedChanges],
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
    if (!chapterId) {
      viewRef.current?.destroy();
      viewRef.current = null;
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      completionSeqRef.current += 1;
      completingRef.current = false;
      return;
    }

    const host = hostRef.current;
    if (!host) return;

    // Recreate editor per chapter for a clean undo stack.
    viewRef.current?.destroy();
    viewRef.current = null;

    const scheduleCompletion = (view: EditorView) => {
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      if (getInlineCompletion(view.state)) view.dispatch({ effects: clearInlineCompletion.of(null) });

      const selection = view.state.selection.main;
      if (!selection.empty) return;

      completionTimerRef.current = window.setTimeout(() => {
        void requestCompletion(view);
      }, 700);
    };

    const requestCompletion = async (view: EditorView) => {
      const selection = view.state.selection.main;
      if (!selection.empty) return;

      const cursor = selection.head;
      const fullText = view.state.doc.toString();
      const before = fullText.slice(Math.max(0, cursor - 2200), cursor);
      const after = fullText.slice(cursor, Math.min(fullText.length, cursor + 300));
      if (!before.trim()) return;

      completingRef.current = true;
      const seq = (completionSeqRef.current += 1);

      try {
        const raw = await aiComplete({
          projectDir: projectPath,
          beforeText: before,
          afterText: after,
          maxChars: 180,
        });

        if (completionSeqRef.current !== seq) return;
        if (viewRef.current !== view) return;
        const currentSel = view.state.selection.main;
        if (!currentSel.empty || currentSel.head !== cursor) return;

        let text = (raw ?? "").replace(/^\uFEFF/, "");
        text = text.replace(/^<<<CONTINUE_DRAFT>>>\\s*/m, "");
        text = text.replace(/^```[\\s\\S]*?```\\s*/m, "");
        text = text.trimStart();
        text = text.replace(/\\s+$/g, "");
        if (!text) return;

        const maxLen = 260;
        if (text.length > maxLen) text = text.slice(0, maxLen);

        view.dispatch({ effects: setInlineCompletion.of(text) });
      } catch (error) {
        if (completionSeqRef.current !== seq) return;
        const text = formatError(error);
        if (/已停止生成|cancelled|canceled|aborted|取消/i.test(text)) return;
        if (text.includes("请先在设置") || text.includes("Provider") || text.includes("模型")) {
          message.warning("未配置 Provider/模型，无法使用补全。请先在设置里配置。");
        }
      } finally {
        if (completionSeqRef.current === seq) completingRef.current = false;
      }
    };

    const extensions: Extension = [
      EditorView.lineWrapping,
      history(),
      inlineCompletionField,
      inlineCompletionTheme,
      keymap.of([
        {
          key: "Tab",
          run: (view) => {
            return acceptInlineCompletion(view);
          },
        },
        indentWithTab,
        {
          key: "Escape",
          run: (view) => {
            const suggestion = getInlineCompletion(view.state);
            if (!suggestion) return false;
            view.dispatch({ effects: clearInlineCompletion.of(null) });
            void invoke("ai_complete_cancel").catch(() => {});
            completionSeqRef.current += 1;
            completingRef.current = false;
            return true;
          },
        },
        {
          key: "Mod-s",
          run: () => {
            void saveRef.current().catch(() => {
              message.error("保存失败，请稍后重试。");
            });
            return true;
          },
        },
        ...historyKeymap,
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const next = update.state.doc.toString();
          setValue(next);
        }

        if (update.docChanged || update.selectionSet) {
          const selection = update.state.selection.main;
          const selectedText = selection.empty
            ? ""
            : update.state.sliceDoc(selection.from, selection.to).slice(0, 4000);
          if (selectedText !== lastSelectionRef.current) {
            lastSelectionRef.current = selectedText;
            window.dispatchEvent(
              new CustomEvent("creatorai:editorSelection", {
                detail: { projectPath, chapterId, text: selectedText },
              }),
            );
          }

          scheduleCompletion(update.view);
        }

        setCanUndoState(undoDepth(update.state) > 0);
        setCanRedoState(redoDepth(update.state) > 0);
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          background: "transparent",
          color: "var(--text-primary)",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily:
            '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
          fontSize: "16px",
          lineHeight: "1.8",
          padding: "20px 24px",
        },
        ".cm-content": {
          caretColor: "var(--text-primary)",
        },
        "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
          background: "rgba(139, 115, 85, 0.25)",
        },
        "&.cm-focused .cm-cursor": {
          borderLeftColor: "var(--text-primary)",
        },
      }),
    ];
    extensionsRef.current = extensions;

    const view = new EditorView({
      state: EditorState.create({ doc: initialContent, extensions }),
      parent: host,
    });
    viewRef.current = view;
    setCanUndoState(undoDepth(view.state) > 0);
    setCanRedoState(redoDepth(view.state) > 0);

    // Initial completion.
    scheduleCompletion(view);

    return () => {
      completionSeqRef.current += 1;
      completingRef.current = false;
      if (completionTimerRef.current) window.clearTimeout(completionTimerRef.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [chapterId, projectPath]);

  useEffect(() => {
    if (!chapterId) return;
    if (hasUnsavedChanges) return;
    resetAutoSave(initialContent);
    setValue(initialContent);

    const view = viewRef.current;
    if (!view) return;
    view.setState(
      EditorState.create({
        doc: initialContent,
        extensions: extensionsRef.current,
      }),
    );
    setCanUndoState(undoDepth(view.state) > 0);
    setCanRedoState(redoDepth(view.state) > 0);
  }, [chapterId, initialContent, hasUnsavedChanges, resetAutoSave]);

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
        canUndo={canUndoState}
        canRedo={canRedoState}
        onUndo={() => {
          const view = viewRef.current;
          if (view) undo(view);
        }}
        onRedo={() => {
          const view = viewRef.current;
          if (view) redo(view);
        }}
      />
      <div ref={hostRef} className="editor-codemirror" />
    </div>
  );
}

const ForwardEditor = forwardRef<EditorHandle, EditorProps>(Editor);
ForwardEditor.displayName = "Editor";
export default ForwardEditor;
