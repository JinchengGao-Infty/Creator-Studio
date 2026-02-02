# T3.4 实现章节列表 UI

## 目标

实现侧边栏的章节列表组件，支持章节的浏览、选择、新建、重命名、删除。

## 背景

章节列表是用户管理小说结构的核心界面，需要：
- 显示所有章节（标题 + 字数）
- 点击切换当前章节
- 右键菜单（重命名/删除）
- 新建章节按钮
- 拖拽排序（可选）

## UI 设计

```
┌─────────────────────┐
│  章节列表    [+]    │
├─────────────────────┤
│ ▸ 第一章 开端       │  ← 当前选中（高亮）
│   3,500 字          │
├─────────────────────┤
│   第二章 转折       │
│   4,200 字          │
├─────────────────────┤
│   第三章 高潮       │
│   2,800 字          │
├─────────────────────┤
│   ...               │
└─────────────────────┘

右键菜单：
┌─────────────┐
│ 重命名      │
│ 删除        │
└─────────────┘
```

## 组件结构

```
src/components/
├── Sidebar/
│   ├── index.ts
│   ├── ChapterList.tsx      # 章节列表主组件
│   ├── ChapterItem.tsx      # 单个章节项
│   └── ChapterContextMenu.tsx  # 右键菜单
```

## 实现要点

### 1. ChapterList.tsx

```tsx
import { List, Button, Dropdown } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ChapterItem } from "./ChapterItem";

interface ChapterListProps {
  chapters: ChapterMeta[];
  currentChapterId: string | null;
  onSelect: (chapterId: string) => void;
  onCreate: () => void;
  onRename: (chapterId: string, newTitle: string) => void;
  onDelete: (chapterId: string) => void;
}

export function ChapterList({
  chapters,
  currentChapterId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: ChapterListProps) {
  return (
    <div className="chapter-list">
      <div className="chapter-list-header">
        <span>章节列表</span>
        <Button
          type="text"
          icon={<PlusOutlined />}
          onClick={onCreate}
          title="新建章节"
        />
      </div>
      
      <List
        dataSource={chapters}
        renderItem={(chapter) => (
          <ChapterItem
            key={chapter.id}
            chapter={chapter}
            isActive={chapter.id === currentChapterId}
            onSelect={() => onSelect(chapter.id)}
            onRename={(newTitle) => onRename(chapter.id, newTitle)}
            onDelete={() => onDelete(chapter.id)}
          />
        )}
      />
    </div>
  );
}
```

### 2. ChapterItem.tsx

```tsx
import { Dropdown, Input, Modal } from "antd";
import { useState } from "react";

interface ChapterItemProps {
  chapter: ChapterMeta;
  isActive: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}

export function ChapterItem({
  chapter,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: ChapterItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(chapter.title);

  const handleRename = () => {
    if (newTitle.trim() && newTitle !== chapter.title) {
      onRename(newTitle.trim());
    }
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

  const menuItems = [
    { key: "rename", label: "重命名", onClick: () => setIsRenaming(true) },
    { key: "delete", label: "删除", danger: true, onClick: handleDelete },
  ];

  return (
    <Dropdown menu={{ items: menuItems }} trigger={["contextMenu"]}>
      <div
        className={`chapter-item ${isActive ? "active" : ""}`}
        onClick={onSelect}
      >
        {isRenaming ? (
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={handleRename}
            onPressEnter={handleRename}
            autoFocus
            size="small"
          />
        ) : (
          <>
            <div className="chapter-title">{chapter.title}</div>
            <div className="chapter-word-count">
              {chapter.wordCount.toLocaleString()} 字
            </div>
          </>
        )}
      </div>
    </Dropdown>
  );
}
```

### 3. 样式

```css
.chapter-list {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.chapter-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-weight: 500;
}

.chapter-item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
  transition: background-color 0.2s;
}

.chapter-item:hover {
  background-color: #fafafa;
}

.chapter-item.active {
  background-color: #fff7e6;
  border-left: 3px solid #d4a574;
}

.chapter-title {
  font-size: 14px;
  margin-bottom: 4px;
}

.chapter-word-count {
  font-size: 12px;
  color: #999;
}
```

### 4. 集成到 Sidebar

```tsx
// src/components/Sidebar/index.tsx
import { ChapterList } from "./ChapterList";

interface SidebarProps {
  chapters: ChapterMeta[];
  currentChapterId: string | null;
  onSelectChapter: (id: string) => void;
  onCreateChapter: () => void;
  onRenameChapter: (id: string, title: string) => void;
  onDeleteChapter: (id: string) => void;
}

export function Sidebar({ ... }: SidebarProps) {
  return (
    <aside className="sidebar">
      <ChapterList
        chapters={chapters}
        currentChapterId={currentChapterId}
        onSelect={onSelectChapter}
        onCreate={onCreateChapter}
        onRename={onRenameChapter}
        onDelete={onDeleteChapter}
      />
    </aside>
  );
}
```

## 验收标准

- [ ] 章节列表正常显示
- [ ] 点击章节能切换选中状态
- [ ] 当前章节有高亮样式
- [ ] 新建按钮能触发创建
- [ ] 右键菜单正常弹出
- [ ] 重命名功能正常（内联编辑）
- [ ] 删除有确认对话框
- [ ] 字数显示正确

## 文件变更

- 新增：`src/components/Sidebar/ChapterList.tsx`
- 新增：`src/components/Sidebar/ChapterItem.tsx`
- 新增：`src/components/Sidebar/index.ts`
- 新增：`src/styles/sidebar.css`
- 修改：`src/App.tsx`（集成 Sidebar）

## 依赖

- T3.2 完成（项目 UI）
- T3.3 完成（章节 CRUD 后端）

---

*任务创建时间：2026-02-02*
