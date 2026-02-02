import { invoke } from "@tauri-apps/api/core";
import { Button, Space, Typography } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityBar } from "../components/ActivityBar";
import { AIPanel } from "../components/AIPanel";
import { Editor } from "../components/Editor";
import { Sidebar } from "../components/Sidebar";
import { SettingsPanel } from "../components/Settings";
import { StatusBar, type SaveStatus } from "../components/StatusBar";
import type { Theme } from "../hooks/useTheme";
import "./main-layout.css";

export type SidebarView = "chapters" | "settings";

interface MainLayoutProps {
  projectPath: string;
  projectName: string;
  projectBusy?: boolean;
  theme: Theme;
  onToggleTheme: () => void;
  onCreateProject: () => void;
  onOpenProject: () => void;
  onCloseProject: () => void;
}

interface ChapterMeta {
  id: string;
  title: string;
  order: number;
  created: number;
  updated: number;
  wordCount: number;
}

function currentChapterStorageKey(projectPath: string) {
  return `creatorai:currentChapter:${encodeURIComponent(projectPath)}`;
}

export default function MainLayout({
  projectPath,
  projectName,
  projectBusy,
  theme,
  onToggleTheme,
  onCreateProject,
  onOpenProject,
  onCloseProject,
}: MainLayoutProps) {
  const [sidebarView, setSidebarView] = useState<SidebarView>("chapters");
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const refreshChapters = useCallback(async () => {
    try {
      const result = (await invoke("list_chapters", {
        project_path: projectPath,
      })) as ChapterMeta[];
      const next = (result || []).slice().sort((a, b) => a.order - b.order);
      setChapters(next);

      const stored = localStorage.getItem(currentChapterStorageKey(projectPath));
      const storedValid = stored && next.some((c) => c.id === stored);
      const fallbackId = next[0]?.id ?? null;

      setCurrentChapterId((prev) => {
        if (prev && next.some((c) => c.id === prev)) return prev;
        return storedValid ? stored : fallbackId;
      });
    } catch {
      setChapters([]);
      setCurrentChapterId(null);
    }
  }, [projectPath]);

  useEffect(() => {
    void refreshChapters();
  }, [refreshChapters]);

  useEffect(() => {
    const onSelected = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; chapterId: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setCurrentChapterId(detail.chapterId);
    };

    const onOpenSettings = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setSidebarView("settings");
    };

    const onChaptersChanged = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      void refreshChapters();
    };

    const onSaveStatus = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; saveStatus: SaveStatus }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setSaveStatus(detail.saveStatus);
    };

    window.addEventListener("creatorai:chapterSelected", onSelected);
    window.addEventListener("creatorai:openSettings", onOpenSettings);
    window.addEventListener("creatorai:chaptersChanged", onChaptersChanged);
    window.addEventListener("creatorai:saveStatus", onSaveStatus);
    return () => {
      window.removeEventListener("creatorai:chapterSelected", onSelected);
      window.removeEventListener("creatorai:openSettings", onOpenSettings);
      window.removeEventListener("creatorai:chaptersChanged", onChaptersChanged);
      window.removeEventListener("creatorai:saveStatus", onSaveStatus);
    };
  }, [projectPath, refreshChapters]);

  const totalWordCount = useMemo(() => {
    return chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
  }, [chapters]);

  const chapterWordCount = useMemo(() => {
    if (!currentChapterId) return 0;
    const current = chapters.find((c) => c.id === currentChapterId);
    return current?.wordCount ?? 0;
  }, [chapters, currentChapterId]);

  return (
    <div className="main-layout">
      <ActivityBar
        activeView={sidebarView}
        onViewChange={setSidebarView}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-project-title">
            <Typography.Text strong>{projectName}</Typography.Text>
          </div>
          <Typography.Text type="secondary" className="sidebar-project-path">
            {projectPath}
          </Typography.Text>
          <Space size={8} className="sidebar-project-actions">
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={onCreateProject}
              disabled={projectBusy}
            >
              新建
            </Button>
            <Button
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={onOpenProject}
              disabled={projectBusy}
            >
              打开
            </Button>
            <Button size="small" onClick={onCloseProject} disabled={projectBusy}>
              关闭
            </Button>
          </Space>
        </div>

        <div className="sidebar-content">
          {sidebarView === "chapters" && <Sidebar projectPath={projectPath} />}
          {sidebarView === "settings" && <SettingsPanel />}
        </div>
      </aside>

      <main className="editor-area">
        <Editor />
      </main>

      <aside className="ai-panel">
        <AIPanel projectPath={projectPath} />
      </aside>

      <div className="status-bar-container">
        <StatusBar
          chapterWordCount={chapterWordCount}
          totalWordCount={totalWordCount}
          saveStatus={saveStatus}
        />
      </div>
    </div>
  );
}
