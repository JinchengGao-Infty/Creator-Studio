import { CheckCircleOutlined, SyncOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import "./status-bar.css";

export type SaveStatus = "saved" | "saving" | "unsaved";

interface StatusBarProps {
  chapterWordCount: number;
  totalWordCount: number;
  saveStatus: SaveStatus;
}

export default function StatusBar({ chapterWordCount, totalWordCount, saveStatus }: StatusBarProps) {
  const statusIcon = {
    saved: <CheckCircleOutlined className="status-icon status-icon-saved" />,
    saving: <SyncOutlined spin className="status-icon status-icon-saving" />,
    unsaved: <span className="status-icon status-icon-unsaved">●</span>,
  } satisfies Record<SaveStatus, ReactNode>;

  const statusText = {
    saved: "已保存",
    saving: "保存中...",
    unsaved: "未保存",
  } satisfies Record<SaveStatus, string>;

  return (
    <div className="status-bar">
      <div className="status-item">本章：{chapterWordCount.toLocaleString()} 字</div>
      <div className="status-divider">|</div>
      <div className="status-item">全书：{totalWordCount.toLocaleString()} 字</div>
      <div className="status-divider">|</div>
      <div className="status-item status-save">
        {statusIcon[saveStatus]} {statusText[saveStatus]}
      </div>
    </div>
  );
}
