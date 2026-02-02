import { Select } from "antd";

export interface SessionSummary {
  id: string;
  name: string;
}

interface SessionListProps {
  sessions: SessionSummary[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export default function SessionList({
  sessions,
  currentSessionId,
  onSelect,
  disabled,
}: SessionListProps) {
  return (
    <Select
      value={currentSessionId ?? undefined}
      onChange={onSelect}
      placeholder="选择会话"
      style={{ width: "100%" }}
      options={sessions.map((s) => ({ value: s.id, label: s.name }))}
      disabled={disabled}
    />
  );
}
