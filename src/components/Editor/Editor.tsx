import { Empty, Typography } from "antd";

export default function Editor() {
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        编辑器
      </Typography.Title>
      <Empty description="编辑器 UI 将在 t3006 实现，这里先占位用于布局联调" />
    </div>
  );
}

