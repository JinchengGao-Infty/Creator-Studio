# T4.5 实现多对话会话管理 UI

## 目标
实现会话列表的完整 UI，支持创建、切换、重命名、删除会话。

## 输入
- T4.2 完成的 AI 面板框架
- T4.1 完成的会话后端 API

## 输出
- 完善的会话管理 UI 组件
- 会话列表侧边栏或下拉菜单

## UI 设计

### 方案 A：下拉菜单（推荐，节省空间）
```
┌─────────────────────────────────┐
│  当前会话: 讨论角色设定  ▼      │
└─────────────────────────────────┘
         │
         ▼ 点击展开
┌─────────────────────────────────┐
│  🔍 搜索会话...                 │
├─────────────────────────────────┤
│  + 新建会话                     │
├─────────────────────────────────┤
│  📝 讨论角色设定      ✓  •••   │  ← 当前选中 + 更多菜单
│  📝 情节讨论              •••   │
│  ✍️ 第一章续写            •••   │  ← 续写模式图标不同
│  ✍️ 第三章续写            •••   │
└─────────────────────────────────┘
```

### 方案 B：侧边抽屉
```
点击会话图标 → 从右侧滑出会话列表抽屉
```

## 组件结构

### SessionSelector.tsx（下拉选择器）
```tsx
interface SessionSelectorProps {
  sessions: Session[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: (name: string, mode: SessionMode) => void;
  onRename: (sessionId: string, newName: string) => void;
  onDelete: (sessionId: string) => void;
}

function SessionSelector(props: SessionSelectorProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredSessions = sessions.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  
  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      dropdownRender={() => (
        <div className="session-dropdown">
          <Input 
            placeholder="搜索会话..." 
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <div className="session-list">
            {filteredSessions.map(session => (
              <SessionItem 
                key={session.id}
                session={session}
                isActive={session.id === currentSessionId}
                onSelect={() => { onSelect(session.id); setOpen(false); }}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </div>
          <Button type="link" icon={<PlusOutlined />} onClick={handleCreate}>
            新建会话
          </Button>
        </div>
      )}
    >
      <Button className="session-selector-trigger">
        {currentSession?.name || '选择会话'}
        <DownOutlined />
      </Button>
    </Dropdown>
  );
}
```

### SessionItem.tsx（会话列表项）
```tsx
interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onSelect: () => void;
  onRename: (sessionId: string, newName: string) => void;
  onDelete: (sessionId: string) => void;
}

function SessionItem({ session, isActive, onSelect, onRename, onDelete }: SessionItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  
  const modeIcon = session.mode === 'Discussion' ? '📝' : '✍️';
  
  const menuItems = [
    { key: 'rename', label: '重命名', onClick: () => setIsEditing(true) },
    { key: 'delete', label: '删除', danger: true, onClick: () => handleDelete() },
  ];
  
  const handleDelete = () => {
    Modal.confirm({
      title: '删除会话',
      content: `确定要删除会话"${session.name}"吗？对话历史将被清除。`,
      okText: '删除',
      okType: 'danger',
      onOk: () => onDelete(session.id),
    });
  };
  
  return (
    <div className={`session-item ${isActive ? 'active' : ''}`} onClick={onSelect}>
      <span className="session-icon">{modeIcon}</span>
      {isEditing ? (
        <Input
          size="small"
          value={editName}
          onChange={e => setEditName(e.target.value)}
          onBlur={() => { onRename(session.id, editName); setIsEditing(false); }}
          onPressEnter={() => { onRename(session.id, editName); setIsEditing(false); }}
          autoFocus
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="session-name">{session.name}</span>
      )}
      {isActive && <CheckOutlined className="active-icon" />}
      <Dropdown menu={{ items: menuItems }} trigger={['click']}>
        <Button 
          type="text" 
          size="small" 
          icon={<MoreOutlined />}
          onClick={e => e.stopPropagation()}
        />
      </Dropdown>
    </div>
  );
}
```

### CreateSessionModal.tsx（新建会话弹窗）
```tsx
interface CreateSessionModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, mode: SessionMode) => void;
  defaultMode?: SessionMode;
}

function CreateSessionModal({ open, onClose, onCreate, defaultMode }: CreateSessionModalProps) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<SessionMode>(defaultMode || 'Discussion');
  
  const handleOk = () => {
    if (!name.trim()) {
      message.error('请输入会话名称');
      return;
    }
    onCreate(name.trim(), mode);
    setName('');
    onClose();
  };
  
  return (
    <Modal
      title="新建会话"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
    >
      <Form layout="vertical">
        <Form.Item label="会话名称" required>
          <Input 
            value={name} 
            onChange={e => setName(e.target.value)}
            placeholder="例如：讨论主角性格"
          />
        </Form.Item>
        <Form.Item label="会话模式">
          <Radio.Group value={mode} onChange={e => setMode(e.target.value)}>
            <Radio value="Discussion">📝 讨论模式</Radio>
            <Radio value="Continue">✍️ 续写模式</Radio>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

## 样式

```css
.session-dropdown {
  width: 280px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.session-list {
  max-height: 300px;
  overflow-y: auto;
}

.session-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  cursor: pointer;
  gap: 8px;
}

.session-item:hover {
  background: var(--bg-tertiary);
}

.session-item.active {
  background: var(--accent-light);
}

.session-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

## 验收标准
1. [ ] 能显示会话列表
2. [ ] 能搜索过滤会话
3. [ ] 能创建新会话（选择模式）
4. [ ] 能切换会话
5. [ ] 能重命名会话（内联编辑）
6. [ ] 能删除会话（确认弹窗）
7. [ ] 当前会话高亮显示
8. [ ] 不同模式显示不同图标
9. [ ] 样式适配双主题
10. [ ] `npm run build` 通过

## 注意事项
- 删除会话需要二次确认
- 会话列表按更新时间倒序排列
- 空状态提示"暂无会话，点击新建"
