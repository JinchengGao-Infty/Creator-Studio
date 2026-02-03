import { Tooltip } from "antd";
import {
  BookOutlined,
  FileTextOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";
import type { Theme } from "../../hooks/useTheme";
import type { SidebarView } from "../../layouts/MainLayout";
import "./activity-bar.css";

interface ActivityBarProps {
  activeView: SidebarView;
  onViewChange: (view: SidebarView) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function ActivityBar({
  activeView,
  onViewChange,
  theme,
  onToggleTheme,
}: ActivityBarProps) {
  const items: Array<{ key: SidebarView; label: string; icon: ReactNode }> = [
    { key: "chapters", label: "章节", icon: <FileTextOutlined /> },
    { key: "knowledge", label: "知识库", icon: <BookOutlined /> },
    { key: "settings", label: "设置", icon: <SettingOutlined /> },
  ];

  return (
    <div className="activity-bar">
      <div className="activity-bar-items">
        {items.map((item) => (
          <Tooltip key={item.key} title={item.label} placement="right">
            <button
              type="button"
              className={`activity-bar-item ${activeView === item.key ? "active" : ""}`}
              onClick={() => onViewChange(item.key)}
            >
              {item.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      <div className="activity-bar-spacer" />

      <div className="activity-bar-items">
        <Tooltip title={theme === "light" ? "深色主题" : "浅色主题"} placement="right">
          <button type="button" className="activity-bar-item" onClick={onToggleTheme}>
            {theme === "light" ? <MoonOutlined /> : <SunOutlined />}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
