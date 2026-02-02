import { Card, List, Typography } from "antd";

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
}

interface RecentProjectsProps {
  projects: RecentProject[];
  onOpen: (path: string) => void;
}

function formatLastOpened(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function RecentProjects({ projects, onOpen }: RecentProjectsProps) {
  return (
    <Card
      title="最近项目"
      size="small"
      style={{ width: "100%" }}
      styles={{ body: { padding: 0 } }}
    >
      <List
        dataSource={projects}
        locale={{ emptyText: "暂无最近项目" }}
        renderItem={(item) => (
          <List.Item
            style={{ padding: "12px 16px", cursor: "pointer" }}
            onClick={() => onOpen(item.path)}
          >
            <List.Item.Meta
              title={<Typography.Text strong>{item.name}</Typography.Text>}
              description={
                <div>
                  <Typography.Text type="secondary">{item.path}</Typography.Text>
                  {item.lastOpened ? (
                    <div style={{ marginTop: 4 }}>
                      <Typography.Text type="secondary">
                        上次打开：{formatLastOpened(item.lastOpened)}
                      </Typography.Text>
                    </div>
                  ) : null}
                </div>
              }
            />
          </List.Item>
        )}
      />
    </Card>
  );
}

