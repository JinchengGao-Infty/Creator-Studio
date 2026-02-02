import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Radio, Space, Typography, message } from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatInput from "./ChatInput";
import ChatHistory from "./ChatHistory";
import SessionList from "./SessionList";
import { aiChat, getSystemPromptForMode, type ChatMessage } from "../../lib/ai";
import {
  buildSystemPrompt,
  formatWritingPreset,
  getWritingPresets,
  saveWritingPresets,
} from "../../lib/writingPresets";
import { createDefaultWritingPreset, type WritingPreset } from "../../types/writingPreset";
import PresetSelector from "./PresetSelector";
import PresetSettingsDrawer from "./PresetSettingsDrawer";
import {
  addSessionMessage,
  createSession,
  compactSession,
  getSessionMessages,
  listSessions,
  updateMessageMetadata,
  type MessageMetadata,
  type Session,
  type SessionMode,
} from "../../lib/sessions";
import { formatError } from "../../utils/error";
import { countWords } from "../../utils/wordCount";
import type { PanelMessage, ToolCall } from "./types";
import "./ai-panel.css";

interface AIPanelProps {
  projectPath: string;
}

function storageCurrentKey(projectPath: string) {
  return `creatorai:currentSession:${encodeURIComponent(projectPath)}`;
}

function defaultMode(): SessionMode {
  return "Discussion";
}

function defaultSessionName(mode: SessionMode, existingCount: number): string {
  const prefix = mode === "Discussion" ? "讨论" : "续写";
  return `${prefix} 会话 ${existingCount + 1}`;
}

function toPanelMessage(msg: { id: string; role: string; content: string; timestamp: number; metadata?: unknown }): PanelMessage {
  const role = msg.role === "User" ? "user" : msg.role === "System" ? "system" : "assistant";
  const rawMeta = msg.metadata as Record<string, unknown> | null | undefined;
  const toolCalls = Array.isArray(rawMeta?.tool_calls) ? (rawMeta?.tool_calls as ToolCall[]) : undefined;
  const parsedMeta: PanelMessage["metadata"] =
    rawMeta && typeof rawMeta === "object"
      ? {
          summary:
            typeof rawMeta.summary === "string" ? rawMeta.summary : rawMeta.summary === null ? null : undefined,
          word_count:
            typeof rawMeta.word_count === "number"
              ? rawMeta.word_count
              : rawMeta.word_count === null
                ? null
                : undefined,
          applied:
            typeof rawMeta.applied === "boolean" ? rawMeta.applied : rawMeta.applied === null ? null : undefined,
        }
      : null;
  return {
    id: msg.id,
    role,
    content: msg.content,
    timestamp: msg.timestamp * 1000,
    toolCalls,
    metadata: parsedMeta,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const COMPACT_CONFIG = {
  maxTokens: 8000,
  compactThreshold: 0.8,
  keepRecent: 5,
} as const;

function estimateTokensForMessages(messages: Array<{ content: string }>): number {
  const chars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  // Very rough estimate: 1 token ≈ 4 chars, plus small per-message overhead.
  return Math.ceil(chars / 4) + messages.length * 4;
}

function openSettings(projectPath: string) {
  window.dispatchEvent(new CustomEvent("creatorai:openSettings", { detail: { projectPath } }));
}

function currentChapterStorageKey(projectPath: string) {
  return `creatorai:currentChapter:${encodeURIComponent(projectPath)}`;
}

type ContinuePhase = "draft" | "apply";

function chapterFilePath(chapterId: string) {
  return `chapters/${chapterId}.txt`;
}

function buildContinueSystemPrompt(params: {
  projectPath: string;
  chapterId: string;
  chapterTitle?: string | null;
  writingPreset: string;
  phase: ContinuePhase;
}): string {
  const chapterLabel = params.chapterTitle ? `${params.chapterTitle}（${params.chapterId}）` : params.chapterId;
  const chapterPath = chapterFilePath(params.chapterId);
  const phaseHint =
    params.phase === "apply"
      ? "【应用阶段】用户已确认追加。请将你上一条提供的续写预览原文（不要改写）追加到章节末尾，然后保存本次续写的摘要。"
      : "【草稿阶段】请先读取上下文并生成续写预览。此阶段严禁调用 append/write/save_summary 修改任何文件。";

  return `
你是一位专业的小说续写 AI Agent。你的任务是帮助作者续写当前章节内容。

## 可用工具
- read: 读取章节内容
- list: 列出目录内容（需要时）
- search: 搜索摘要获取前情
- get_chapter_info: 获取当前章节信息（路径、字数等）
- append: 追加续写内容到章节末尾（仅在用户确认后）
- save_summary: 保存本次续写的摘要（仅在用户确认后）

## 当前阶段
${phaseHint}

## 工作流程（草稿阶段）
1. 首先用 read 读取当前章节的最后部分（建议 offset: -2000）作为上下文
2. 用 search 搜索 summaries.json 相关摘要，了解前情和人物关系
3. 根据用户指令和上下文，生成续写内容（约 500-1000 字）
4. 输出“续写预览”（只输出正文，不要把工具返回的 JSON 原样贴出来），等待用户确认

## 工作流程（应用阶段）
1. 用户已确认后，调用 append 将“上一条续写预览原文”追加到章节文件末尾
2. 调用 save_summary 保存本次续写摘要（50-100 字左右，chapterId: ${params.chapterId}）
3. 回复用户：已追加、摘要已保存，并可提示当前字数

## 写作要求
${params.writingPreset}

## 当前项目
- 项目路径：${params.projectPath}
- 当前章节：${chapterLabel}
- 章节文件：${chapterPath}
- 摘要文件：summaries.json

## 注意
- 续写内容要与前文风格一致，保持人物性格与情节连贯
- 追加前必须让用户确认；未确认时禁止调用 append/save_summary/write
- 应用阶段 append 时必须使用上一条你给出的预览原文，不要改写或重新生成
  `.trim();
}

export default function AIPanel({ projectPath }: AIPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>(defaultMode());
  const [messagesInSession, setMessagesInSession] = useState<PanelMessage[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null);
  const [presets, setPresets] = useState<WritingPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>(createDefaultWritingPreset().id);
  const [presetSettingsOpen, setPresetSettingsOpen] = useState(false);
  const [loadingPresets, setLoadingPresets] = useState(false);
  const [savingPresets, setSavingPresets] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [dismissedDraftIds, setDismissedDraftIds] = useState<string[]>([]);
  const streamTokenRef = useRef(0);
  const toolCallStartTimesRef = useRef<Map<string, number>>(new Map());
  const realStreamingRef = useRef(false);

  const currentKey = useMemo(() => storageCurrentKey(projectPath), [projectPath]);

  useEffect(() => {
    const stored = localStorage.getItem(currentChapterStorageKey(projectPath));
    setCurrentChapterId(stored && stored.trim() ? stored : null);

    const onSelected = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; chapterId: string | null }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setCurrentChapterId(detail.chapterId);
    };

    window.addEventListener("creatorai:chapterSelected", onSelected);
    return () => {
      window.removeEventListener("creatorai:chapterSelected", onSelected);
    };
  }, [projectPath]);

  useEffect(() => {
    if (!currentChapterId) {
      setCurrentChapterTitle(null);
      return;
    }

    let cancelled = false;
    const loadTitle = async () => {
      try {
        const list = (await invoke("list_chapters", { projectPath })) as Array<
          { id: string; title: string }
        >;
        if (cancelled) return;
        const found = Array.isArray(list) ? list.find((c) => c.id === currentChapterId) : null;
        setCurrentChapterTitle(found?.title ?? null);
      } catch {
        if (!cancelled) setCurrentChapterTitle(null);
      }
    };

    void loadTitle();
    return () => {
      cancelled = true;
    };
  }, [projectPath, currentChapterId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingPresets(true);
      try {
        const result = await getWritingPresets(projectPath);
        if (cancelled) return;
        setPresets(result.presets);
        setActivePresetId(result.activePresetId);
      } catch (error) {
        if (cancelled) return;
        message.error(`加载写作预设失败: ${formatError(error)}`);
        const fallback = createDefaultWritingPreset();
        setPresets([fallback]);
        setActivePresetId(fallback.id);
      } finally {
        if (!cancelled) setLoadingPresets(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingSessions(true);
      try {
        let next = await listSessions(projectPath);

        if (!next.length) {
          const created = await createSession({
            projectPath,
            name: defaultSessionName(defaultMode(), 0),
            mode: defaultMode(),
          });
          next = [created];
        }

        if (cancelled) return;

        setSessions(next);

        const stored = localStorage.getItem(currentKey);
        const storedValid = stored && next.some((s) => s.id === stored);
        const fallbackId = next[0]?.id ?? null;
        const selectedId = storedValid ? stored : fallbackId;

        setCurrentSessionId(selectedId);
        if (selectedId) localStorage.setItem(currentKey, selectedId);

        const selected = next.find((s) => s.id === selectedId);
        setMode(selected?.mode ?? defaultMode());
      } catch (error) {
        message.error(`加载会话失败: ${formatError(error)}`);
        setSessions([]);
        setCurrentSessionId(null);
        setMode(defaultMode());
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectPath, currentKey]);

  useEffect(() => {
    let unlistenStart: (() => void) | null = null;
    let unlistenEnd: (() => void) | null = null;
    let unlistenChunk: (() => void) | null = null;

    const setup = async () => {
      try {
        unlistenStart = await listen("ai:tool_call_start", (event) => {
          const payload = event.payload as Partial<{
            id: string;
            name: string;
            args: Record<string, unknown>;
          }>;

          const id = payload.id;
          const name = payload.name;
          if (typeof id !== "string" || typeof name !== "string") return;
          toolCallStartTimesRef.current.set(id, Date.now());
          setPendingToolCalls((prev) => [
            ...prev,
            {
              id,
              name,
              args: payload.args ?? {},
              status: "calling",
            },
          ]);
        });

        unlistenEnd = await listen("ai:tool_call_end", (event) => {
          const payload = event.payload as Partial<{
            id: string;
            result?: string;
            error?: string;
          }>;

          const id = payload.id;
          if (typeof id !== "string") return;
          const start = toolCallStartTimesRef.current.get(id);
          toolCallStartTimesRef.current.delete(id);
          const duration = typeof start === "number" ? Date.now() - start : undefined;
          setPendingToolCalls((prev) =>
            prev.map((call) => {
              if (call.id !== id) return call;
              return {
                ...call,
                status: payload.error ? "error" : "success",
                result: payload.result ?? call.result,
                error: payload.error ?? call.error,
                duration,
              };
            }),
          );
        });

        unlistenChunk = await listen("ai:chunk", (event) => {
          const chunk = typeof event.payload === "string" ? event.payload : String(event.payload ?? "");
          if (!chunk) return;

          if (!realStreamingRef.current) {
            realStreamingRef.current = true;
            streamTokenRef.current += 1;
            setStreamingContent("");
          }
          setStreamingContent((prev) => prev + chunk);
        });
      } catch {
        // ignore: event API not available in non-tauri contexts
      }
    };

    void setup();
    return () => {
      unlistenStart?.();
      unlistenEnd?.();
      unlistenChunk?.();
    };
  }, []);

  useEffect(() => {
    if (!currentSessionId) {
      setMessagesInSession([]);
      setDismissedDraftIds([]);
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      setLoadingMessages(true);
      setMessagesInSession([]);
      setDismissedDraftIds([]);
      try {
        const msgs = await getSessionMessages({ projectPath, sessionId: currentSessionId });
        if (cancelled) return;
        setMessagesInSession(msgs.map(toPanelMessage));
      } catch (error) {
        if (cancelled) return;
        message.error(`加载消息失败: ${formatError(error)}`);
        setMessagesInSession([]);
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [projectPath, currentSessionId]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;
  const busy = loading || loadingSessions || loadingMessages || savingPresets;
  const continueReady = mode !== "Continue" || !!(currentSession?.chapter_id ?? currentChapterId);

  const activePreset = useMemo(() => {
    if (!presets.length) return createDefaultWritingPreset();
    return (
      presets.find((p) => p.id === activePresetId) ??
      presets.find((p) => p.isDefault) ??
      presets[0] ??
      createDefaultWritingPreset()
    );
  }, [presets, activePresetId]);

  const actionableDraftId = useMemo(() => {
    if (mode !== "Continue") return null;
    for (let i = messagesInSession.length - 1; i >= 0; i -= 1) {
      const msg = messagesInSession[i];
      if (msg.role !== "assistant") continue;
      if (msg.metadata?.applied !== false) continue;
      if (dismissedDraftIds.includes(msg.id)) continue;
      return msg.id;
    }
    return null;
  }, [mode, messagesInSession, dismissedDraftIds]);

  const selectSession = (id: string | null) => {
    setCurrentSessionId(id);
    if (id) localStorage.setItem(currentKey, id);
  };

  const handleCreateSession = () => {
    if (loadingSessions) return;
    const existing = sessions.filter((s) => s.mode === mode).length;
    const name = defaultSessionName(mode, existing);
    const chapterIdForSession = mode === "Continue" ? currentChapterId : null;

    setLoadingSessions(true);
    void createSession({ projectPath, name, mode, chapterId: chapterIdForSession })
      .then((created) => {
        setSessions((prev) => [created, ...prev]);
        selectSession(created.id);
      })
      .catch((error) => {
        message.error(`创建会话失败: ${formatError(error)}`);
      })
      .finally(() => {
        setLoadingSessions(false);
      });
  };

  const handleSelectSession = (id: string) => {
    if (!sessions.some((s) => s.id === id)) return;
    const selected = sessions.find((s) => s.id === id);
    if (selected) setMode(selected.mode);
    selectSession(id);
  };

  const handleModeChange = (nextMode: SessionMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);

    const nextSessions = sessions.filter((s) => s.mode === nextMode);
    if (nextSessions.length) {
      selectSession(nextSessions[0]?.id ?? null);
      return;
    }

    selectSession(null);
    const name = defaultSessionName(nextMode, 0);
    const chapterIdForSession = nextMode === "Continue" ? currentChapterId : null;
    setLoadingSessions(true);
    void createSession({ projectPath, name, mode: nextMode, chapterId: chapterIdForSession })
      .then((created) => {
        setSessions((prev) => [created, ...prev]);
        selectSession(created.id);
      })
      .catch((error) => {
        message.error(`创建会话失败: ${formatError(error)}`);
      })
      .finally(() => {
        setLoadingSessions(false);
      });
  };

  function resolveContinueChapter(session: Session): { chapterId: string; chapterTitle: string | null } | null {
    const chapterId = session.chapter_id ?? currentChapterId;
    if (!chapterId) return null;
    const title = chapterId === currentChapterId ? currentChapterTitle : null;
    return { chapterId, chapterTitle: title };
  }

  function inferContinuePhase(userText: string): ContinuePhase {
    const hasDraft = messagesInSession.some((m) => m.role === "assistant" && m.metadata?.applied === false);
    if (!hasDraft) return "draft";
    const normalized = userText.trim();
    if (!normalized) return "draft";
    if (/(确认追加|追加吧|追加到章节|写入章节|应用到章节)/.test(normalized)) return "apply";
    if (normalized === "确认" || normalized === "可以" || normalized === "好") return "apply";
    if (/追加|写入|应用/.test(normalized)) return "apply";
    return "draft";
  }

  function extractSavedSummary(toolCalls: ToolCall[]): string | null {
    const call = toolCalls.find((c) => c.name === "save_summary");
    const summary = call?.args?.summary;
    return typeof summary === "string" && summary.trim() ? summary.trim() : null;
  }

  const sendMessage = async (
    content: string,
    options?: { continuePhase?: ContinuePhase; sourceDraftMessageId?: string },
  ) => {
    if (!currentSession || busy) return;

    const continuePhase =
      mode === "Continue" ? (options?.continuePhase ?? inferContinuePhase(content)) : "draft";
    const allowWrite = mode === "Continue" && continuePhase === "apply";
    const sourceDraftMessageId = allowWrite ? (options?.sourceDraftMessageId ?? actionableDraftId ?? undefined) : undefined;

    const resolved = mode === "Continue" ? resolveContinueChapter(currentSession) : null;
    if (mode === "Continue" && !resolved) {
      message.error("请先在左侧选择要续写的章节");
      return;
    }

    if (mode === "Continue" && allowWrite && sourceDraftMessageId) {
      setDismissedDraftIds((prev) =>
        prev.includes(sourceDraftMessageId) ? prev : [...prev, sourceDraftMessageId],
      );
    }

    setConfigMissing(false);
    realStreamingRef.current = false;
    toolCallStartTimesRef.current.clear();
    setPendingToolCalls([]);
    setStreamingContent("");
    const streamToken = (streamTokenRef.current += 1);

    setLoading(true);
    try {
      const createdUser = await addSessionMessage({
        projectPath,
        sessionId: currentSession.id,
        role: "User",
        content,
      });

      const uiUser = toPanelMessage(createdUser);
      setMessagesInSession((prev) => [...prev, uiUser]);

      let workingMessages: PanelMessage[] = [...messagesInSession, uiUser];
      const compactThreshold = COMPACT_CONFIG.maxTokens * COMPACT_CONFIG.compactThreshold;

      if (estimateTokensForMessages(workingMessages) > compactThreshold) {
        message.loading({ content: "正在压缩上下文...", key: "compact", duration: 0 });
        try {
          await compactSession({
            projectPath,
            sessionId: currentSession.id,
            keepRecent: COMPACT_CONFIG.keepRecent,
          });
          const compacted = await getSessionMessages({ projectPath, sessionId: currentSession.id });
          workingMessages = compacted.map(toPanelMessage);
          setMessagesInSession(workingMessages);
          if (estimateTokensForMessages(workingMessages) > compactThreshold) {
            workingMessages = workingMessages.slice(-20);
          }
        } catch (error) {
          message.error(`压缩上下文失败: ${formatError(error)}`);
          workingMessages = workingMessages.slice(-20);
        } finally {
          message.destroy("compact");
        }
      }

      const messagesForAi: ChatMessage[] = workingMessages.map((m) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
      }));

      const systemPrompt =
        mode === "Continue" && resolved
          ? buildContinueSystemPrompt({
              projectPath,
              chapterId: resolved.chapterId,
              chapterTitle: resolved.chapterTitle,
              writingPreset: formatWritingPreset(activePreset),
              phase: continuePhase,
            })
          : buildSystemPrompt(activePreset, getSystemPromptForMode(mode, projectPath));

      const { content: reply, toolCalls } = await aiChat({
        projectDir: projectPath,
        messages: messagesForAi,
        mode,
        systemPrompt,
        chapterId: resolved?.chapterId ?? null,
        allowWrite,
      });

      const streamPromise = realStreamingRef.current
        ? Promise.resolve()
        : (async () => {
            const chunkSize = reply.length > 3000 ? 80 : 40;
            const intervalMs = reply.length > 3000 ? 10 : 16;
            for (let i = 0; i < reply.length; i += chunkSize) {
              if (streamTokenRef.current !== streamToken) return;
              setStreamingContent(reply.slice(0, i + chunkSize));
              await delay(intervalMs);
            }
          })();

      const assistantMeta: MessageMetadata = {};
      if (toolCalls.length) assistantMeta.tool_calls = toolCalls;

      if (mode === "Continue") {
        if (allowWrite) {
          assistantMeta.applied = true;
          const saved = extractSavedSummary(toolCalls);
          if (saved) assistantMeta.summary = saved;
        } else {
          assistantMeta.applied = false;
          assistantMeta.word_count = countWords(reply);
        }
      }

      const createdAssistant = await addSessionMessage({
        projectPath,
        sessionId: currentSession.id,
        role: "Assistant",
        content: reply,
        metadata: Object.keys(assistantMeta).length ? assistantMeta : null,
      });

      await streamPromise;

      const uiAssistant = toPanelMessage(createdAssistant);
      setMessagesInSession((prev) => [...prev, uiAssistant]);
      setStreamingContent("");
      setPendingToolCalls([]);

      const appended = toolCalls.some((c) => c.name === "append" && c.status === "success");
      if (mode === "Continue" && appended) {
        window.dispatchEvent(
          new CustomEvent("creatorai:chaptersChanged", { detail: { projectPath, reason: "append" } }),
        );
      }

      if (mode === "Continue" && allowWrite && typeof sourceDraftMessageId === "string" && appended) {
        try {
          await updateMessageMetadata({
            projectPath,
            sessionId: currentSession.id,
            messageId: sourceDraftMessageId,
            applied: true,
          });
          setMessagesInSession((prev) =>
            prev.map((m) =>
              m.id === sourceDraftMessageId
                ? { ...m, metadata: { ...(m.metadata ?? {}), applied: true } }
                : m,
            ),
          );
        } catch {
          // ignore
        }
      }

      const refreshed = await listSessions(projectPath);
      setSessions(refreshed);
    } catch (error) {
      const text = formatError(error);
      if (text.includes("请先在设置") || text.includes("Provider") || text.includes("模型")) {
        setConfigMissing(true);
      }
      message.error(`发送失败: ${text}`);
    } finally {
      setLoading(false);
      setStreamingContent("");
      setPendingToolCalls([]);
    }
  };

  const handleSend = async (content: string) => {
    await sendMessage(content);
  };

  const handleConfirmDraft = async (draft: PanelMessage) => {
    setDismissedDraftIds((prev) => (prev.includes(draft.id) ? prev : [...prev, draft.id]));
    await sendMessage("确认追加。请将你上一条给出的续写预览原文（不要改写）追加到章节末尾，然后保存 50-100 字摘要。", {
      continuePhase: "apply",
      sourceDraftMessageId: draft.id,
    });
  };

  const handleRegenerateDraft = async (draft: PanelMessage) => {
    setDismissedDraftIds((prev) => (prev.includes(draft.id) ? prev : [...prev, draft.id]));
    await sendMessage("不太满意，请重新生成一版新的续写预览（不要追加到章节）。", { continuePhase: "draft" });
  };

  const handleDiscardDraft = async (draft: PanelMessage) => {
    setDismissedDraftIds((prev) => (prev.includes(draft.id) ? prev : [...prev, draft.id]));
    if (!currentSession) return;
    try {
      const sys = await addSessionMessage({
        projectPath,
        sessionId: currentSession.id,
        role: "System",
        content: "已放弃本次续写草稿。",
      });
      setMessagesInSession((prev) => [...prev, toPanelMessage(sys)]);
    } catch {
      message.info("已放弃本次续写草稿");
    }
  };

  const handleSelectPreset = (presetId: string) => {
    if (!presetId || presetId === activePresetId) return;
    const previous = activePresetId;
    setActivePresetId(presetId);

    setSavingPresets(true);
    void saveWritingPresets({ projectPath, presets, activePresetId: presetId })
      .catch((error) => {
        message.error(`保存当前预设失败: ${formatError(error)}`);
        setActivePresetId(previous);
      })
      .finally(() => {
        setSavingPresets(false);
      });
  };

  const handleSavePresets = async (nextPresets: WritingPreset[], nextActiveId: string) => {
    setSavingPresets(true);
    try {
      await saveWritingPresets({ projectPath, presets: nextPresets, activePresetId: nextActiveId });
      setPresets(nextPresets);
      setActivePresetId(nextActiveId);
      message.success("写作预设已保存");
    } finally {
      setSavingPresets(false);
    }
  };

  return (
    <div className="ai-panel-root">
      <div className="ai-panel-header">
        <div className="ai-panel-topbar">
          <Typography.Text strong>AI 助手</Typography.Text>
          <Space size={8}>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={handleCreateSession}
              disabled={busy}
            />
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => openSettings(projectPath)}
            />
          </Space>
        </div>

        <div className="ai-panel-mode">
          <Radio.Group
            value={mode}
            optionType="button"
            buttonStyle="solid"
            onChange={(e) => handleModeChange(e.target.value as SessionMode)}
            options={[
              { label: "讨论", value: "Discussion" },
              { label: "续写", value: "Continue" },
            ]}
            disabled={loadingSessions || loading || loadingMessages}
          />
        </div>

        {mode === "Continue" ? (
          <PresetSelector
            presets={presets.length ? presets : [createDefaultWritingPreset()]}
            activePresetId={activePresetId}
            onSelect={handleSelectPreset}
            onOpenSettings={() => setPresetSettingsOpen(true)}
            disabled={busy || loadingPresets}
          />
        ) : null}

        <div className="ai-panel-session">
          <SessionList
            sessions={sessions
              .filter((s) => s.mode === mode)
              .map((s) => ({ id: s.id, name: s.name }))}
            currentSessionId={currentSessionId}
            onSelect={handleSelectSession}
            disabled={busy}
          />
        </div>
      </div>

      <PresetSettingsDrawer
        open={presetSettingsOpen}
        onClose={() => setPresetSettingsOpen(false)}
        presets={presets.length ? presets : [createDefaultWritingPreset()]}
        activePresetId={activePresetId}
        onSave={handleSavePresets}
      />

      {configMissing ? (
        <div className="ai-panel-warning">
          <Alert
            type="warning"
            showIcon
            message="未配置 Provider"
            description="请在左侧活动栏切换到「设置」，添加 Provider 并设为当前，然后在「模型参数」里选择模型。"
          />
        </div>
      ) : null}

      {mode === "Continue" && !currentSession?.chapter_id && !currentChapterId ? (
        <div className="ai-panel-warning">
          <Alert
            type="info"
            showIcon
            message="未选择章节"
            description="续写模式需要绑定章节。请先在左侧章节列表选择要续写的章节，然后再发送续写指令。"
          />
        </div>
      ) : null}

      <ChatHistory
        messages={messagesInSession}
        mode={mode}
        continueDraftId={actionableDraftId}
        onConfirmDraft={handleConfirmDraft}
        onRegenerateDraft={handleRegenerateDraft}
        onDiscardDraft={handleDiscardDraft}
        draftActionsDisabled={busy}
        loading={loading}
        loadingHistory={loadingMessages}
        pendingContent={streamingContent}
        pendingToolCalls={pendingToolCalls}
      />

      <ChatInput onSend={handleSend} disabled={busy || !currentSession || !continueReady} />
    </div>
  );
}
