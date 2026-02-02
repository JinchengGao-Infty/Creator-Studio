import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Typography, message } from "antd";
import ChatInput from "./ChatInput";
import ChatHistory, { type HistoryMessage } from "./ChatHistory";
import SessionList from "./SessionList";
import { aiChat, type ChatMessage } from "../../lib/ai";
import "./ai-panel.css";

interface Session {
  id: string;
  name: string;
  messages: HistoryMessage[];
  created: number;
}

interface AIPanelProps {
  projectPath: string;
}

function storageKey(projectPath: string) {
  return `creatorai:sessions:${encodeURIComponent(projectPath)}`;
}

function storageCurrentKey(projectPath: string) {
  return `creatorai:currentSession:${encodeURIComponent(projectPath)}`;
}

function makeDefaultSession(existingCount: number): Session {
  const created = Date.now();
  const index = existingCount + 1;
  return {
    id: `session_${created}`,
    name: `会话 ${index}`,
    messages: [],
    created,
  };
}

export default function AIPanel({ projectPath }: AIPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [configMissing, setConfigMissing] = useState(false);

  const sessionsKey = useMemo(() => storageKey(projectPath), [projectPath]);
  const currentKey = useMemo(() => storageCurrentKey(projectPath), [projectPath]);

  const persist = (nextSessions: Session[], nextCurrentId: string) => {
    localStorage.setItem(sessionsKey, JSON.stringify(nextSessions));
    localStorage.setItem(currentKey, nextCurrentId);
  };

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    const raw = localStorage.getItem(sessionsKey);
    const rawCurrent = localStorage.getItem(currentKey);

    let parsed: Session[] = [];
    try {
      parsed = raw ? (JSON.parse(raw) as Session[]) : [];
    } catch {
      parsed = [];
    }

    if (!parsed.length) {
      const initial = makeDefaultSession(0);
      setSessions([initial]);
      setCurrentSessionId(initial.id);
      persist([initial], initial.id);
      return;
    }

    const fallbackId = parsed[0]?.id ?? null;
    const nextCurrent = rawCurrent && parsed.some((s) => s.id === rawCurrent) ? rawCurrent : fallbackId;

    setSessions(parsed);
    setCurrentSessionId(nextCurrent);
    if (nextCurrent) persist(parsed, nextCurrent);
  }, [sessionsKey, currentKey]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  const handleCreateSession = () => {
    const next = makeDefaultSession(sessions.length);
    const nextSessions = [next, ...sessions];
    setSessions(nextSessions);
    setCurrentSessionId(next.id);
    persist(nextSessions, next.id);
  };

  const handleSelectSession = (id: string) => {
    if (!sessions.some((s) => s.id === id)) return;
    setCurrentSessionId(id);
    persist(sessions, id);
  };

  const updateSessionMessages = (
    sessionId: string,
    updater: (prev: HistoryMessage[]) => HistoryMessage[],
  ) => {
    setSessions((prevSessions) => {
      const nextSessions = prevSessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, messages: updater(s.messages) };
      });
      const activeId = currentSessionIdRef.current ?? sessionId;
      persist(nextSessions, activeId);
      return nextSessions;
    });
  };

  const handleSend = async (content: string) => {
    if (!currentSession || loading) return;

    setConfigMissing(false);

    const userMessage: HistoryMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
    };

    updateSessionMessages(currentSession.id, (prev) => [...prev, userMessage]);

    const messagesForAi: ChatMessage[] = [...currentSession.messages, userMessage].slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setLoading(true);
    try {
      const reply = await aiChat({
        projectDir: projectPath,
        messages: messagesForAi,
      });

      const assistantMessage: HistoryMessage = {
        role: "assistant",
        content: reply,
        timestamp: Date.now(),
      };

      updateSessionMessages(currentSession.id, (prev) => [...prev, assistantMessage]);
    } catch (error) {
      const text = String(error);
      if (text.includes("Provider")) setConfigMissing(true);
      message.error(`发送失败: ${text}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-panel-root">
      <div className="ai-panel-header">
        <div style={{ marginBottom: 8 }}>
          <Typography.Text strong>AI 助手</Typography.Text>
        </div>
        <SessionList
          sessions={sessions.map((s) => ({ id: s.id, name: s.name }))}
          currentSessionId={currentSessionId}
          onSelect={handleSelectSession}
          onCreate={handleCreateSession}
        />
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

      <ChatHistory messages={currentSession?.messages || []} loading={loading} />

      <ChatInput onSend={handleSend} disabled={loading || !currentSession} />
    </div>
  );
}
