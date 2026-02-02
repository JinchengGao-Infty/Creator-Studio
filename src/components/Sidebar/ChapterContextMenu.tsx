import type { MenuProps } from "antd";

interface ChapterContextMenuOptions {
  onRename: () => void;
  onDelete: () => void;
}

export function getChapterContextMenuItems(
  options: ChapterContextMenuOptions,
): NonNullable<MenuProps["items"]> {
  return [
    {
      key: "rename",
      label: "重命名",
      onClick: options.onRename,
    },
    {
      key: "delete",
      label: "删除",
      danger: true,
      onClick: options.onDelete,
    },
  ];
}

