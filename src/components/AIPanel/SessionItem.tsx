import { CheckOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Modal } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "../../lib/sessions";

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRename: (sessionId: string, newName: string) => Promise<void>;
  onDelete: (sessionId: string) => Promise<void>;
  disabled?: boolean;
}

export default function SessionItem({
  session,
  isActive,
  onSelect,
  onRename,
  onDelete,
  disabled,
}: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);

  useEffect(() => {
    if (isEditing) return;
    setEditName(session.name);
  }, [session.name, isEditing]);

  const modeIcon = session.mode === "Discussion" ? "📝" : "✍️";

  const menuItems = useMemo(
    () => [
      { key: "rename", label: "重命名" },
      { key: "delete", label: "删除", danger: true },
    ],
    [],
  );

  const commitRename = async () => {
    const nextName = editName.trim();
    if (!nextName) {
      setEditName(session.name);
      setIsEditing(false);
      return;
    }

    if (nextName === session.name) {
      setIsEditing(false);
      return;
    }

    try {
      await onRename(session.id, nextName);
      setIsEditing(false);
    } catch {
      // Error message handled by caller.
    }
  };

  const confirmDelete = () => {
    Modal.confirm({
      title: "删除会话",
      content: `确定要删除会话“${session.name}”吗？对话历史将被清除。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: () => onDelete(session.id),
    });
  };

  return (
    <div
      className={`session-item ${isActive ? "active" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => {
        if (disabled) return;
        if (isEditing) return;
        onSelect();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (disabled) return;
        if (isEditing) return;
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <span className="session-icon" aria-hidden>
        {modeIcon}
      </span>

      {isEditing ? (
        <Input
          size="small"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={() => void commitRename()}
          onPressEnter={() => void commitRename()}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          disabled={disabled}
        />
      ) : (
        <span className="session-name" title={session.name}>
          {session.name}
        </span>
      )}

      {isActive ? <CheckOutlined className="session-active-icon" /> : <span className="session-active-spacer" />}

      <Dropdown
        menu={{
          items: menuItems,
          onClick: ({ key, domEvent }) => {
            domEvent.stopPropagation();
            if (disabled) return;

            if (key === "rename") {
              setIsEditing(true);
              setEditName(session.name);
              return;
            }

            if (key === "delete") confirmDelete();
          },
        }}
        trigger={["click"]}
        placement="bottomRight"
      >
        <Button
          type="text"
          size="small"
          icon={<MoreOutlined />}
          onClick={(e) => e.stopPropagation()}
          disabled={disabled}
        />
      </Dropdown>
    </div>
  );
}

