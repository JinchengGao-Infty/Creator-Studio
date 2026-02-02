import { Button, Select, Space } from "antd";
import { PlusOutlined } from "@ant-design/icons";

export interface SessionSummary {
  id: string;
  name: string;
}

interface SessionListProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export default function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  onCreate,
}: SessionListProps) {
  return (
    <Space style={{ width: "100%", justifyContent: "space-between" }} size={8}>
      <Select
        value={currentSessionId ?? undefined}
        onChange={onSelect}
        placeholder="选择会话"
        style={{ flex: 1, minWidth: 0 }}
        options={sessions.map((s) => ({ value: s.id, label: s.name }))}
      />
      <Button icon={<PlusOutlined />} onClick={onCreate} />
    </Space>
  );
}

