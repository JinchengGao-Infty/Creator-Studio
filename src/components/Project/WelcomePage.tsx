import { Button, Space, Typography } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import RecentProjects, { type RecentProject } from "./RecentProjects";

interface WelcomePageProps {
  onCreateProject: () => void;
  onOpenProject: () => void;
  recentProjects: RecentProject[];
  onOpenRecent: (path: string) => void;
}

export default function WelcomePage({
  onCreateProject,
  onOpenProject,
  recentProjects,
  onOpenRecent,
}: WelcomePageProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
      }}
    >
      <div style={{ width: "min(860px, 100%)" }}>
        <Typography.Title level={1} style={{ marginBottom: 8 }}>
          📝 CreatorAI
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          AI 辅助小说写作工具
        </Typography.Paragraph>

        <Space size="middle" style={{ marginBottom: 24 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={onCreateProject}>
            新建项目
          </Button>
          <Button icon={<FolderOpenOutlined />} onClick={onOpenProject}>
            打开项目
          </Button>
        </Space>

        <RecentProjects projects={recentProjects} onOpen={onOpenRecent} />
      </div>
    </div>
  );
}
