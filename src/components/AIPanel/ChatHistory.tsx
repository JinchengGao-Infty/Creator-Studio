import { useEffect, useRef } from "react";
import { Spin } from "antd";
import ChatMessage from "./ChatMessage";
import ToolCallDisplay from "./ToolCallDisplay";
import type { SessionMode } from "../../lib/sessions";
import type { PanelMessage, ToolCall } from "./types";

interface ChatHistoryProps {
  messages: PanelMessage[];
  mode: SessionMode;
  continueDraftId?: string | null;
  onConfirmDraft?: (message: PanelMessage) => void;
  onRegenerateDraft?: (message: PanelMessage) => void;
  onDiscardDraft?: (message: PanelMessage) => void;
  draftActionsDisabled?: boolean;
  loading?: boolean;
  loadingHistory?: boolean;
  pendingContent?: string;
  pendingToolCalls?: ToolCall[];
}

export default function ChatHistory({
  messages,
  mode,
  continueDraftId,
  onConfirmDraft,
  onRegenerateDraft,
  onDiscardDraft,
  draftActionsDisabled,
  loading,
  loadingHistory,
  pendingContent,
  pendingToolCalls,
}: ChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, pendingContent, pendingToolCalls]);

  return (
    <div className="chat-history">
      {messages.map((msg) => (
        <ChatMessage
          key={msg.id}
          message={msg}
          mode={mode}
          continueDraftId={continueDraftId ?? null}
          onConfirmDraft={onConfirmDraft}
          onRegenerateDraft={onRegenerateDraft}
          onDiscardDraft={onDiscardDraft}
          draftActionsDisabled={draftActionsDisabled}
        />
      ))}

      {loadingHistory && !messages.length && !loading ? (
        <div className="chat-history-loading">
          <Spin size="small" /> <span style={{ marginLeft: 8 }}>加载中...</span>
        </div>
      ) : null}

      {loading ? (
        <div className="chat-message assistant chat-message-processing">
          <div className="message-avatar" aria-hidden>
            🤖
          </div>
          <div className="message-body">
            {pendingToolCalls && pendingToolCalls.length ? (
              <div className="tool-calls-container">
                {pendingToolCalls.map((call) => (
                  <ToolCallDisplay key={call.id} toolCall={call} />
                ))}
              </div>
            ) : null}
            <div className="message-content">
              {pendingContent ? (
                <>
                  {pendingContent}
                  <span className="message-cursor" aria-hidden>
                    ▋
                  </span>
                </>
              ) : (
                <>
                  <Spin size="small" /> <span style={{ marginLeft: 8 }}>思考中...</span>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
