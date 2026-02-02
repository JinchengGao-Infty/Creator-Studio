import { DownOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Dropdown, Empty, Input } from "antd";
import { useMemo, useState } from "react";
import type { Session } from "../../lib/sessions";
import SessionItem from "./SessionItem";

interface SessionSelectorProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onOpenCreate: () => void;
  onRename: (sessionId: string, newName: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  disabled?: boolean;
}

export default function SessionSelector({
  sessions,
  currentSessionId,
  onSelect,
  onOpenCreate,
  onRename,
  onDelete,
  disabled,
}: SessionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId],
  );

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.name.toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  return (
    <Dropdown
      trigger={["click"]}
      open={open}
      onOpenChange={(nextOpen) => {
        if (disabled) return;
        setOpen(nextOpen);
        if (!nextOpen) setSearchQuery("");
      }}
      dropdownRender={() => (
        <div className="session-dropdown">
          <div className="session-dropdown-search">
            <Input
              size="small"
              placeholder="搜索会话..."
              prefix={<SearchOutlined />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              allowClear
            />
          </div>

          <div className="session-list">
            {filteredSessions.length ? (
              filteredSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={session.id === currentSessionId}
                  onSelect={() => {
                    onSelect(session.id);
                    setOpen(false);
                  }}
                  onRename={onRename}
                  onDelete={onDelete}
                  disabled={disabled}
                />
              ))
            ) : sessions.length ? (
              <div className="session-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到会话" />
              </div>
            ) : (
              <div className="session-empty">
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话，点击新建" />
              </div>
            )}
          </div>

          <div className="session-dropdown-footer">
            <Button
              type="link"
              icon={<PlusOutlined />}
              onClick={() => {
                setOpen(false);
                onOpenCreate();
              }}
              disabled={disabled}
            >
              新建会话
            </Button>
          </div>
        </div>
      )}
    >
      <Button className="session-selector-trigger" block disabled={disabled}>
        <span className="session-trigger-text">{currentSession?.name || "选择会话"}</span>
        <DownOutlined className="session-trigger-icon" />
      </Button>
    </Dropdown>
  );
}

