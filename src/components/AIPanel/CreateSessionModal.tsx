import { Form, Input, Modal, Radio } from "antd";
import { useEffect, useState } from "react";
import type { SessionMode } from "../../lib/sessions";

interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, mode: SessionMode) => Promise<void>;
  defaultMode?: SessionMode;
  confirmLoading?: boolean;
}

export default function CreateSessionModal({
  open,
  onClose,
  onCreate,
  defaultMode,
  confirmLoading,
}: CreateSessionModalProps) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SessionMode>(defaultMode ?? "Discussion");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setNameError(null);
    setMode(defaultMode ?? "Discussion");
  }, [open, defaultMode]);

  const handleOk = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("请输入会话名称");
      return;
    }

    setNameError(null);
    try {
      await onCreate(trimmed, mode);
      onClose();
    } catch {
      // Error message handled by caller.
    }
  };

  return (
    <Modal
      title="新建会话"
      open={open}
      onOk={() => void handleOk()}
      onCancel={onClose}
      confirmLoading={confirmLoading}
      okText="创建"
    >
      <Form layout="vertical">
        <Form.Item label="会话名称" required validateStatus={nameError ? "error" : undefined} help={nameError}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：讨论主角性格"
            onPressEnter={() => void handleOk()}
          />
        </Form.Item>
        <Form.Item label="会话模式">
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as SessionMode)}>
            <Radio value="Discussion">📝 讨论模式</Radio>
            <Radio value="Continue">✍️ 续写模式</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}

