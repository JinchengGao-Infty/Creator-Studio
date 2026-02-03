import { Button, Input } from "antd";
import { SendOutlined, StopOutlined } from "@ant-design/icons";
import { useState } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop?: () => void;
  generating?: boolean;
  disabled?: boolean;
}

export default function ChatInput({ onSend, onStop, generating, disabled }: ChatInputProps) {
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
        placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPressEnter={(e) => {
          if ((e.nativeEvent as unknown as { isComposing?: boolean })?.isComposing) return;
          if (e.shiftKey) return;
          e.preventDefault();
          handleSend();
        }}
        disabled={disabled || generating}
      />
      <div className="chat-input-actions">
        {generating ? (
          <Button
            danger
            icon={<StopOutlined />}
            onClick={onStop}
            disabled={!onStop}
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={disabled || !value.trim()}
          >
            发送
          </Button>
        )}
      </div>
    </div>
  );
}
