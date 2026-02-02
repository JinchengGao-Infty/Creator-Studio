import { Spin } from "antd";
import { useEffect, useRef } from "react";
import type { ChatRole } from "../../lib/ai";

export interface HistoryMessage {
  role: ChatRole;
  content: string;
  timestamp: number;
}

interface ChatHistoryProps {
  messages: HistoryMessage[];
  loading?: boolean;
}

export default function ChatHistory({ messages, loading }: ChatHistoryProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="chat-history">
      {messages.map((msg, i) => (
        <div key={`${msg.timestamp}-${i}`} className={`chat-message ${msg.role}`}>
          <div className="chat-message-content">{msg.content}</div>
        </div>
      ))}

      {loading ? (
        <div className="chat-message assistant">
          <div className="chat-message-content">
            <Spin size="small" /> <span style={{ marginLeft: 8 }}>思考中...</span>
          </div>
        </div>
      ) : null}

      <div ref={bottomRef} />
    </div>
  );
}
