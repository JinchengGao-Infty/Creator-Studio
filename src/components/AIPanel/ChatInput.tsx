import { Button, Input } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { useState } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="chat-input">
      <Input.TextArea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="输入消息…（Ctrl/Cmd + Enter 发送）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPressEnter={(e) => {
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
      />
      <div className="chat-input-actions">
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || !value.trim()}
        >
          发送
        </Button>
      </div>
    </div>
  );
}

