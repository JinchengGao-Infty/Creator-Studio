import { Button, Space, Tag } from "antd";
import type { SessionMode } from "../../lib/sessions";
import ToolCallDisplay from "./ToolCallDisplay";
import type { PanelMessage } from "./types";
import { countWords } from "../../utils/wordCount";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function getAvatar(role: PanelMessage["role"]): string {
  switch (role) {
    case "user":
      return "👤";
    case "assistant":
      return "🤖";
    case "system":
      return "💡";
    default:
      return "💬";
  }
}

export default function ChatMessage({
  message,
  mode,
  continueDraftId,
  onConfirmDraft,
  onRegenerateDraft,
  onDiscardDraft,
  draftActionsDisabled,
}: {
  message: PanelMessage;
  mode: SessionMode;
  continueDraftId?: string | null;
  onConfirmDraft?: (message: PanelMessage) => void;
  onRegenerateDraft?: (message: PanelMessage) => void;
  onDiscardDraft?: (message: PanelMessage) => void;
  draftActionsDisabled?: boolean;
}) {
  const avatar = getAvatar(message.role);
  const showToolCalls = message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0;
  const isContinueDraft = mode === "Continue" && message.role === "assistant" && message.metadata?.applied === false;
  const showDraftActions =
    isContinueDraft &&
    !!continueDraftId &&
    message.id === continueDraftId &&
    !draftActionsDisabled &&
    (onConfirmDraft || onRegenerateDraft || onDiscardDraft);
  const wordCount =
    typeof message.metadata?.word_count === "number" ? message.metadata.word_count : countWords(message.content);

  return (
    <div className={`chat-message ${message.role}`}>
      <div className="message-avatar" aria-hidden>
        {avatar}
      </div>

      <div className="message-body">
        {showToolCalls ? (
          <div className="tool-calls-container">
            {message.toolCalls?.map((call) => (
              <ToolCallDisplay key={call.id} toolCall={call} />
            ))}
          </div>
        ) : null}

        {isContinueDraft ? (
          <div className="continue-preview">
            <div className="continue-preview-header">
              <span>续写预览</span>
              <span className="continue-word-count">{wordCount.toLocaleString()} 字</span>
            </div>
            <div className="continue-preview-content">{message.content}</div>
            {showDraftActions ? (
              <Space size={8} className="continue-preview-actions">
                <Button type="primary" onClick={() => onConfirmDraft?.(message)}>
                  确认追加
                </Button>
                <Button onClick={() => onRegenerateDraft?.(message)}>重新生成</Button>
                <Button onClick={() => onDiscardDraft?.(message)}>放弃</Button>
              </Space>
            ) : null}
          </div>
        ) : (
          <div className="message-content">{message.content}</div>
        )}

        {mode === "Continue" && message.metadata?.summary ? (
          <div className="continue-summary">
            <Tag color="green">摘要已保存</Tag>
            <span className="continue-summary-text">{message.metadata.summary}</span>
          </div>
        ) : null}

        <div className="message-time">{formatTime(message.timestamp)}</div>
      </div>
    </div>
  );
}
