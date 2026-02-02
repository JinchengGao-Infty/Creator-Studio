import ToolCallDisplay from "./ToolCallDisplay";
import type { PanelMessage } from "./types";

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

export default function ChatMessage({ message }: { message: PanelMessage }) {
  const avatar = getAvatar(message.role);
  const showToolCalls = message.role === "assistant" && (message.toolCalls?.length ?? 0) > 0;

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

        <div className="message-content">{message.content}</div>

        <div className="message-time">{formatTime(message.timestamp)}</div>
      </div>
    </div>
  );
}

