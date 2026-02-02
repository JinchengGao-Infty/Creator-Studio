import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Radio, Space, Typography, message } from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import ChatInput from "./ChatInput";
import ChatHistory from "./ChatHistory";
import CreateSessionModal from "./CreateSessionModal";
import SessionSelector from "./SessionSelector";
import { aiChat, type ChatMessage } from "../../lib/ai";
import {
  addSessionMessage,
  createSession,
  deleteSession,
  getSessionMessages,
  listSessions,
  renameSession,
  type Session,
  type SessionMode,
} from "../../lib/sessions";
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

function toPanelMessage(msg: { id: string; role: string; content: string; timestamp: number; metadata?: unknown }): PanelMessage {
  const role = msg.role === "User" ? "user" : msg.role === "System" ? "system" : "assistant";
  return {
    id: msg.id,
    role,
    content: msg.content,
    timestamp: msg.timestamp * 1000,
    metadata: msg.metadata,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function openSettings(projectPath: string) {
  window.dispatchEvent(new CustomEvent("creatorai:openSettings", { detail: { projectPath } }));
}

export default function AIPanel({ projectPath }: AIPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<SessionMode>(defaultMode());
  const [messagesInSession, setMessagesInSession] = useState<PanelMessage[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const streamTokenRef = useRef(0);
  const toolCallStartTimesRef = useRef<Map<string, number>>(new Map());
  const realStreamingRef = useRef(false);

  const currentKey = useMemo(() => storageCurrentKey(projectPath), [projectPath]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingSessions(true);
      try {
        let next = await listSessions(projectPath);

        if (cancelled) return;

        setSessions(next);

        const stored = localStorage.getItem(currentKey);
        const storedValid = stored && next.some((s) => s.id === stored);
        const fallbackId = next[0]?.id ?? null;
        const selectedId = storedValid ? stored : fallbackId;

        setCurrentSessionId(selectedId);
        if (selectedId) localStorage.setItem(currentKey, selectedId);
        else localStorage.removeItem(currentKey);

        const selected = next.find((s) => s.id === selectedId);
        setMode(selected?.mode ?? defaultMode());
      } catch (error) {
        message.error(`加载会话失败: ${String(error)}`);
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
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      setLoadingMessages(true);
      setMessagesInSession([]);
      try {
        const msgs = await getSessionMessages({ projectPath, sessionId: currentSessionId });
        if (cancelled) return;
        setMessagesInSession(msgs.map(toPanelMessage));
      } catch (error) {
        if (cancelled) return;
        message.error(`加载消息失败: ${String(error)}`);
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
  const busy = loading || loadingSessions || loadingMessages;

  const selectSession = (id: string | null, nextSessions: Session[] = sessions) => {
    setCurrentSessionId(id);
    if (id) localStorage.setItem(currentKey, id);
    else localStorage.removeItem(currentKey);

    const selected = id ? nextSessions.find((s) => s.id === id) : null;
    if (selected) setMode(selected.mode);
  };

  const refreshSessions = async () => {
    const next = await listSessions(projectPath);
    setSessions(next);

    const stillValid = currentSessionId && next.some((s) => s.id === currentSessionId);
    const nextId = stillValid ? currentSessionId : next[0]?.id ?? null;
    selectSession(nextId, next);
  };

  const handleCreateSession = async (name: string, sessionMode: SessionMode) => {
    setLoadingSessions(true);
    try {
      const created = await createSession({ projectPath, name, mode: sessionMode });
      setSessions((prev) => {
        const next = [created, ...prev.filter((s) => s.id !== created.id)];
        next.sort((a, b) => b.updated_at - a.updated_at);
        return next;
      });
      selectSession(created.id, [created, ...sessions]);
    } catch (error) {
      message.error(`创建会话失败: ${String(error)}`);
      throw error;
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleSelectSession = (id: string) => {
    if (!sessions.some((s) => s.id === id)) return;
    selectSession(id);
  };

  const handleModeChange = (nextMode: SessionMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);

    const nextId = sessions.find((s) => s.mode === nextMode)?.id ?? null;
    selectSession(nextId);
  };

  const handleRenameSession = async (sessionId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) {
      message.error("会话名称不能为空");
      throw new Error("Session name cannot be empty");
    }

    setLoadingSessions(true);
    try {
      await renameSession({ projectPath, sessionId, newName: trimmed });
      await refreshSessions();
    } catch (error) {
      message.error(`重命名会话失败: ${String(error)}`);
      throw error;
    } finally {
      setLoadingSessions(false);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    setLoadingSessions(true);
    try {
      await deleteSession({ projectPath, sessionId });
      await refreshSessions();
    } catch (error) {
      message.error(`删除会话失败: ${String(error)}`);
      throw error;
    } finally {
      setLoadingSessions(false);
    }
  };

  const sortedSessions = useMemo(() => {
    const next = sessions.slice();
    next.sort((a, b) => b.updated_at - a.updated_at);
    return next;
  }, [sessions]);

  const handleSend = async (content: string) => {
    if (!currentSession || busy) return;

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

      const messagesForAi: ChatMessage[] = [...messagesInSession, uiUser]
        .filter((m) => m.role !== "system")
        .slice(-20)
        .map((m) => ({ role: m.role as ChatMessage["role"], content: m.content }));

      const reply = await aiChat({
        projectDir: projectPath,
        messages: messagesForAi,
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

      const createdAssistant = await addSessionMessage({
        projectPath,
        sessionId: currentSession.id,
        role: "Assistant",
        content: reply,
      });

      await streamPromise;

      const uiAssistant = toPanelMessage(createdAssistant);
      setMessagesInSession((prev) => [...prev, uiAssistant]);
      setStreamingContent("");
      setPendingToolCalls([]);

      const refreshed = await listSessions(projectPath);
      setSessions(refreshed);
    } catch (error) {
      const text = String(error);
      if (text.includes("Provider")) setConfigMissing(true);
      message.error(`发送失败: ${text}`);
    } finally {
      setLoading(false);
      setStreamingContent("");
      setPendingToolCalls([]);
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
              onClick={() => setCreateModalOpen(true)}
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

        <div className="ai-panel-session">
          <SessionSelector
            sessions={sortedSessions}
            currentSessionId={currentSessionId}
            onSelect={handleSelectSession}
            onOpenCreate={() => setCreateModalOpen(true)}
            onRename={handleRenameSession}
            onDelete={handleDeleteSession}
            disabled={busy}
          />
        </div>
      </div>

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

      <ChatHistory
        messages={messagesInSession}
        loading={loading}
        loadingHistory={loadingMessages}
        pendingContent={streamingContent}
        pendingToolCalls={pendingToolCalls}
      />

      <ChatInput onSend={handleSend} disabled={busy || !currentSession} />

      <CreateSessionModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreate={handleCreateSession}
        defaultMode={mode}
        confirmLoading={loadingSessions}
      />
    </div>
  );
}
