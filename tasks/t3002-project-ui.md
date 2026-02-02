# T3.2 实现项目打开/新建 UI

## 目标

实现项目管理的前端界面，让用户可以新建项目或打开已有项目。

## 背景

用户启动应用后，需要选择一个项目才能开始写作。这个任务实现：
- 欢迎页面（无项目时显示）
- 新建项目对话框
- 打开项目对话框

## UI 设计

### 欢迎页面（WelcomePage）

当没有打开项目时显示：

```
┌─────────────────────────────────────────┐
│                                         │
│           📝 CreatorAI                  │
│                                         │
│      AI 辅助小说写作工具                 │
│                                         │
│   ┌─────────────┐  ┌─────────────┐     │
│   │  新建项目   │  │  打开项目   │     │
│   └─────────────┘  └─────────────┘     │
│                                         │
│   最近项目：                            │
│   • 我的小说 - /path/to/novel          │
│   • 另一个项目 - /path/to/other        │
│                                         │
└─────────────────────────────────────────┘
```

### 新建项目对话框（CreateProjectModal）

```
┌─────────────────────────────────────────┐
│  新建项目                          [X]  │
├─────────────────────────────────────────┤
│                                         │
│  项目名称：                             │
│  ┌─────────────────────────────────┐   │
│  │ 我的小说                        │   │
│  └─────────────────────────────────┘   │
│                                         │
│  保存位置：                             │
│  ┌─────────────────────────────┐ [选择]│
│  │ /Users/xxx/Documents        │       │
│  └─────────────────────────────┘       │
│                                         │
│           [取消]  [创建]               │
└─────────────────────────────────────────┘
```

### 打开项目对话框

使用系统原生文件夹选择对话框（Tauri dialog API）。

## 组件结构

```
src/components/
├── Project/
│   ├── index.ts
│   ├── WelcomePage.tsx      # 欢迎页面
│   ├── CreateProjectModal.tsx  # 新建项目对话框
│   └── RecentProjects.tsx   # 最近项目列表
```

## 实现要点

### 1. WelcomePage.tsx

```tsx
import { Button, Card, List } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";

interface WelcomePageProps {
  onCreateProject: () => void;
  onOpenProject: () => void;
  recentProjects: RecentProject[];
  onOpenRecent: (path: string) => void;
}

export function WelcomePage({ ... }: WelcomePageProps) {
  return (
    <div className="welcome-page">
      <h1>📝 CreatorAI</h1>
      <p>AI 辅助小说写作工具</p>
      
      <div className="actions">
        <Button icon={<PlusOutlined />} onClick={onCreateProject}>
          新建项目
        </Button>
        <Button icon={<FolderOpenOutlined />} onClick={onOpenProject}>
          打开项目
        </Button>
      </div>
      
      <RecentProjects projects={recentProjects} onOpen={onOpenRecent} />
    </div>
  );
}
```

### 2. CreateProjectModal.tsx

```tsx
import { Modal, Form, Input, Button } from "antd";
import { open } from "@tauri-apps/plugin-dialog";

interface CreateProjectModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string, path: string) => void;
}

export function CreateProjectModal({ ... }: CreateProjectModalProps) {
  const [form] = Form.useForm();
  
  const handleSelectPath = async () => {
    const selected = await open({
      directory: true,
      title: "选择保存位置",
    });
    if (selected) {
      form.setFieldValue("path", selected);
    }
  };
  
  return (
    <Modal title="新建项目" open={visible} onCancel={onCancel}>
      <Form form={form} onFinish={({ name, path }) => onCreate(name, path)}>
        <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
          <Input placeholder="我的小说" />
        </Form.Item>
        <Form.Item name="path" label="保存位置" rules={[{ required: true }]}>
          <Input.Search
            placeholder="选择文件夹"
            enterButton="选择"
            onSearch={handleSelectPath}
            readOnly
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
```

### 3. 状态管理

在 App.tsx 或使用 zustand/jotai 管理：

```tsx
interface AppState {
  currentProject: ProjectConfig | null;
  recentProjects: RecentProject[];
  
  openProject: (path: string) => Promise<void>;
  createProject: (name: string, path: string) => Promise<void>;
  closeProject: () => void;
}
```

### 4. 最近项目存储

最近项目列表存储在全局配置中（~/.creatorai/recent.json）：

```json
{
  "recent": [
    { "name": "我的小说", "path": "/path/to/novel", "lastOpened": 1769968900 }
  ]
}
```

需要新增 Tauri commands：
- `get_recent_projects() -> Vec<RecentProject>`
- `add_recent_project(name: String, path: String)`

## Tauri 依赖

需要安装 dialog 插件：

```bash
npm install @tauri-apps/plugin-dialog
```

在 `src-tauri/Cargo.toml` 添加：
```toml
tauri-plugin-dialog = "2"
```

在 `src-tauri/src/lib.rs` 注册：
```rust
.plugin(tauri_plugin_dialog::init())
```

## 验收标准

- [ ] 欢迎页面正常显示
- [ ] 新建项目对话框能打开
- [ ] 能选择文件夹路径
- [ ] 创建项目后跳转到主界面
- [ ] 打开项目能正确加载
- [ ] 最近项目列表正常显示和点击

## 文件变更

- 新增：`src/components/Project/WelcomePage.tsx`
- 新增：`src/components/Project/CreateProjectModal.tsx`
- 新增：`src/components/Project/RecentProjects.tsx`
- 新增：`src/components/Project/index.ts`
- 修改：`src/App.tsx`（集成项目状态）
- 修改：`src-tauri/src/lib.rs`（添加 dialog 插件）
- 修改：`src-tauri/Cargo.toml`（添加 dialog 依赖）

## 依赖

- T3.1 完成（项目数据结构）

---

*任务创建时间：2026-02-02*
