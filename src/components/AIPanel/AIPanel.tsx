import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Space, Typography, message } from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import ChatInput from "./ChatInput";
import ChatHistory from "./ChatHistory";
import SessionList from "./SessionList";
import ContextDiagnosticsPanel from "./ContextDiagnosticsPanel";
import { aiChat } from "../../lib/ai";
import { getWritingPresets, saveWritingPresets } from "../../lib/writingPresets";
import { createDefaultWritingPreset, type WritingPreset } from "../../types/writingPreset";
import PresetSelector from "./PresetSelector";
import PresetSettingsDrawer from "./PresetSettingsDrawer";
import {
  buildWritingContextBundle,
  stripContinueDraftMarker,
  type WritingContextDiagnostics,
  type ContinuePhase,
} from "./contextBuilder";
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
import { buildWorldSummary } from '../../features/worldbuilding/utils/buildWorldSummary';
import type { PanelMessage, ToolCall } from "./types";
import "./ai-panel.css";

interface AIPanelProps {
  projectPath: string;
}

function storageCurrentKey(projectPath: string) {
  return `creatorai:currentSession:${encodeURIComponent(projectPath)}`;
}

function defaultSessionName(existingCount: number): string {
  return `会话 ${existingCount + 1}`;
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

export default function AIPanel({ projectPath }: AIPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const mode: SessionMode = "Continue";
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
  const [lastContextDiagnostics, setLastContextDiagnostics] = useState<WritingContextDiagnostics | null>(null);
  const streamTokenRef = useRef(0);
  const toolCallStartTimesRef = useRef<Map<string, number>>(new Map());
  const realStreamingRef = useRef(false);
  // Ref mirror of messagesInSession — always holds the latest value,
  // safe to read from async functions without stale closure issues.
  const messagesRef = useRef<PanelMessage[]>([]);
  messagesRef.current = messagesInSession;

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
            name: defaultSessionName(0),
            mode,
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
      } catch (error) {
        message.error(`加载会话失败: ${formatError(error)}`);
        setSessions([]);
        setCurrentSessionId(null);
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
      setLastContextDiagnostics(null);
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      setLoadingMessages(true);
      setMessagesInSession([]);
      setDismissedDraftIds([]);
      setLastContextDiagnostics(null);
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
    for (let i = messagesInSession.length - 1; i >= 0; i -= 1) {
      const msg = messagesInSession[i];
      if (msg.role !== "assistant") continue;
      if (msg.metadata?.applied !== false) continue;
      if (dismissedDraftIds.includes(msg.id)) continue;
      return msg.id;
    }
    return null;
  }, [messagesInSession, dismissedDraftIds]);

  const selectSession = (id: string | null) => {
    setCurrentSessionId(id);
    if (id) localStorage.setItem(currentKey, id);
  };

  const handleCreateSession = () => {
    if (loadingSessions) return;
    const name = defaultSessionName(sessions.length);
    const chapterIdForSession = currentChapterId;

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
    selectSession(id);
  };

  function resolveContinueChapter(session: Session): { chapterId: string; chapterTitle: string | null } | null {
    const chapterId = session.chapter_id ?? currentChapterId;
    if (!chapterId) return null;
    const title = chapterId === currentChapterId ? currentChapterTitle : null;
    return { chapterId, chapterTitle: title };
  }

  function inferContinuePhase(userText: string): ContinuePhase {
    const normalized = userText.trim().replace(/[。！？.!?]+$/g, "");
    if (!normalized) return "draft";

    // Read from ref to get the latest messages (avoids stale closure)
    const currentMessages = messagesRef.current;

    // Only treat "确认/可以/好" as apply when the most recent assistant message is a draft preview.
    let lastAssistantIndex = -1;
    let lastDraftIndex = -1;
    for (let i = currentMessages.length - 1; i >= 0; i -= 1) {
      const msg = currentMessages[i];
      if (lastAssistantIndex === -1 && msg.role === "assistant") lastAssistantIndex = i;
      if (lastDraftIndex === -1 && msg.role === "assistant" && msg.metadata?.applied === false) {
        lastDraftIndex = i;
      }
      if (lastAssistantIndex !== -1 && lastDraftIndex !== -1) break;
    }

    if (lastDraftIndex === -1) return "draft";

    // Explicit confirm is always treated as apply when there is any draft.
    if (/确认追加/.test(normalized)) return "apply";

    const lastAssistantIsDraft = lastAssistantIndex === lastDraftIndex;
    if (!lastAssistantIsDraft) return "draft";

    if (/^(确认|可以|好|行|ok|OK|okay|Okay)$/.test(normalized)) return "apply";
    if (/^(追加|追加吧|追加到章节|写入章节|应用到章节)$/.test(normalized)) return "apply";
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

    const continuePhase = options?.continuePhase ?? inferContinuePhase(content);
    const allowWrite = continuePhase === "apply";
    const sourceDraftMessageId = allowWrite ? (options?.sourceDraftMessageId ?? actionableDraftId ?? undefined) : undefined;

    const resolved = resolveContinueChapter(currentSession);
    if (allowWrite && !resolved) {
      message.error("当前未选择章节，无法追加。请先在左侧选择要续写的章节。");
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

      // Build working messages from ref (latest state) + uiUser.
      // setState is async so messagesRef may not yet include uiUser — append it explicitly.
      // Deduplicate by id in case a re-render already added it.
      const currentMsgs = messagesRef.current;
      let workingMessages: PanelMessage[] = currentMsgs.some((m) => m.id === uiUser.id)
        ? [...currentMsgs]
        : [...currentMsgs, uiUser];
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

      let worldSummary = "";
      try {
        worldSummary = buildWorldSummary();
      } catch {
        // Store not ready — proceed without worldbuilding context
      }
      const { messagesForAi, finalSystemPrompt, diagnostics } = buildWritingContextBundle({
        projectPath,
        workingMessages,
        preset: activePreset,
        allowWrite,
        continuePhase,
        chapterId: resolved?.chapterId ?? null,
        chapterTitle: resolved?.chapterTitle ?? null,
        worldSummary,
      });
      setLastContextDiagnostics(diagnostics);

      const { content: reply, toolCalls } = await aiChat({
        projectDir: projectPath,
        messages: messagesForAi,
        mode,
        systemPrompt: finalSystemPrompt,
        chapterId: resolved?.chapterId ?? null,
        allowWrite,
      });

      const parsed = stripContinueDraftMarker(reply);
      const displayReply = parsed.content;

      const assistantMeta: MessageMetadata = {};
      if (toolCalls.length) assistantMeta.tool_calls = toolCalls;

      if (parsed.isDraft && !allowWrite) {
        assistantMeta.applied = false;
        assistantMeta.word_count = countWords(displayReply);
      } else if (allowWrite) {
        assistantMeta.applied = true;
        const saved = extractSavedSummary(toolCalls);
        if (saved) assistantMeta.summary = saved;
      }

      // Save to database first, then run fake streaming animation.
      // This avoids the race where streaming runs concurrently with addSessionMessage,
      // which could leave ghost streaming content if the stop button is pressed mid-animation.
      const createdAssistant = await addSessionMessage({
        projectPath,
        sessionId: currentSession.id,
        role: "Assistant",
        content: displayReply,
        metadata: Object.keys(assistantMeta).length ? assistantMeta : null,
      });

      // Fake streaming animation (only if real streaming didn't happen)
      if (!realStreamingRef.current && displayReply.length > 0) {
        const chunkSize = displayReply.length > 3000 ? 80 : 40;
        const intervalMs = displayReply.length > 3000 ? 10 : 16;
        for (let i = 0; i < displayReply.length; i += chunkSize) {
          if (streamTokenRef.current !== streamToken) break;
          setStreamingContent(displayReply.slice(0, i + chunkSize));
          await delay(intervalMs);
        }
      }

      const uiAssistant = toPanelMessage(createdAssistant);
      setMessagesInSession((prev) => [...prev, uiAssistant]);
      setStreamingContent("");
      setPendingToolCalls([]);

      const appended = toolCalls.some((c) => c.name === "append" && c.status === "success");
      if (appended) {
        const appendedContent = toolCalls
          .filter((c) => c.name === "append" && c.status === "success")
          .map((c) => (typeof c.args?.content === "string" ? c.args.content : ""))
          .join("");
        if (resolved?.chapterId) {
          window.dispatchEvent(
            new CustomEvent("creatorai:chapterAppended", {
              detail: { projectPath, chapterId: resolved.chapterId, content: appendedContent },
            }),
          );
        }
        window.dispatchEvent(
          new CustomEvent("creatorai:chaptersChanged", { detail: { projectPath, reason: "append" } }),
        );
      }

      const summarySaved = toolCalls.some((c) => c.name === "save_summary" && c.status === "success");
      if (summarySaved) {
        window.dispatchEvent(
          new CustomEvent("creatorai:summariesChanged", {
            detail: { projectPath, chapterId: resolved?.chapterId ?? null },
          }),
        );
      }

      if (allowWrite && typeof sourceDraftMessageId === "string" && appended) {
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
      if (/已停止生成|cancelled|canceled|aborted|取消/i.test(text)) {
        message.info("已停止生成");
        return;
      }
      if (text.includes("请先在设置") || text.includes("Provider") || text.includes("模型")) {
        setConfigMissing(true);
      }
      let displayMsg: string;
      if (text.includes("ai-engine") || text.includes("spawn")) {
        displayMsg = `AI 引擎启动失败: ${text}\n请确认已运行 npm run ai-engine:build`;
      } else if (text.includes("Provider") || text.includes("API Key")) {
        displayMsg = `配置错误: ${text}`;
      } else if (text.includes("timeout") || text.includes("Timeout")) {
        displayMsg = `请求超时，请稍后重试`;
      } else if (text.includes("连续失败") || text.includes("consecutive")) {
        displayMsg = `工具调用失败: ${text}`;
      } else {
        displayMsg = `AI 调用失败: ${text}`;
      }
      message.error(displayMsg);
    } finally {
      setLoading(false);
      setStreamingContent("");
      setPendingToolCalls([]);
    }
  };

  const handleSend = async (content: string) => {
    await sendMessage(content);
  };

  const handleStop = async () => {
    if (!loading) return;
    // Stop simulated streaming immediately (show final message faster).
    streamTokenRef.current += 1;
    if (!streamingContent) setStreamingContent("正在停止…");
    try {
      await invoke("ai_cancel");
    } catch {
      // ignore
    }
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

        <PresetSelector
          presets={presets.length ? presets : [createDefaultWritingPreset()]}
          activePresetId={activePresetId}
          onSelect={handleSelectPreset}
          onOpenSettings={() => setPresetSettingsOpen(true)}
          disabled={busy || loadingPresets}
        />

        <div className="ai-panel-session">
          <SessionList
            sessions={sessions.map((s) => ({ id: s.id, name: s.name }))}
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

      <div className="ai-panel-diagnostics">
        <ContextDiagnosticsPanel diagnostics={lastContextDiagnostics} />
      </div>

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

      <ChatInput
        onSend={handleSend}
        onStop={() => void handleStop()}
        generating={loading}
        disabled={busy || !currentSession}
      />
    </div>
  );
}
