import { Dropdown, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { getChapterContextMenuItems } from "./ChapterContextMenu";

export interface ChapterMeta {
  id: string;
  title: string;
  order: number;
  created: number;
  updated: number;
  wordCount: number;
}

interface ChapterItemProps {
  chapter: ChapterMeta;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}

export default function ChapterItem({ chapter, isActive, onSelect, onRename, onDelete }: ChapterItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(chapter.title);

  useEffect(() => {
    if (!isRenaming) setNewTitle(chapter.title);
  }, [chapter.title, isRenaming]);

  const commitRename = () => {
    const next = newTitle.trim();
    if (next && next !== chapter.title) onRename(next);
    setIsRenaming(false);
  };

  const handleDelete = () => {
    Modal.confirm({
      title: "删除章节",
      content: `确定要删除「${chapter.title}」吗？此操作不可恢复。`,
      okText: "删除",
      okType: "danger",
      cancelText: "取消",
      onOk: onDelete,
    });
  };

  const menuItems = getChapterContextMenuItems({
    onRename: () => setIsRenaming(true),
    onDelete: handleDelete,
  });

  return (
    <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
      <div className={`chapter-item ${isActive ? "active" : ""}`} onClick={onSelect}>
        {isRenaming ? (
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={commitRename}
            onPressEnter={commitRename}
            autoFocus
            size="small"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="chapter-title">{chapter.title}</div>
            <div className="chapter-word-count">{chapter.wordCount.toLocaleString()} 字</div>
          </>
        )}
      </div>
    </Dropdown>
  );
}

