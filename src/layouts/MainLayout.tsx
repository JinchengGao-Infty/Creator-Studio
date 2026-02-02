import { invoke } from "@tauri-apps/api/core";
import { Button, Space, Typography, message } from "antd";
import { FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityBar } from "../components/ActivityBar";
import { AIPanel } from "../components/AIPanel";
import { Editor, type EditorHandle } from "../components/Editor";
import { Sidebar } from "../components/Sidebar";
import { SettingsPanel } from "../components/Settings";
import { StatusBar, type SaveStatus } from "../components/StatusBar";
import type { Theme } from "../hooks/useTheme";
import { countWords } from "../utils/wordCount";
import { formatError } from "../utils/error";
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
  const [chapterContent, setChapterContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const editorRef = useRef<EditorHandle | null>(null);
  const contentLoadTokenRef = useRef(0);

  const refreshChapters = useCallback(async () => {
    try {
      const result = (await invoke("list_chapters", {
        projectPath,
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

  const refreshCurrentChapterContent = useCallback(async () => {
    const token = (contentLoadTokenRef.current += 1);
    if (!currentChapterId) {
      setChapterContent("");
      setDraftContent("");
      return;
    }

    try {
      const content = (await invoke("get_chapter_content", {
        projectPath,
        chapterId: currentChapterId,
      })) as string;
      if (contentLoadTokenRef.current !== token) return;
      setChapterContent(content ?? "");
      setDraftContent(content ?? "");
    } catch (error) {
      if (contentLoadTokenRef.current !== token) return;
      setChapterContent("");
      setDraftContent("");
      message.error(`加载章节内容失败: ${formatError(error)}`);
    }
  }, [projectPath, currentChapterId]);

  useEffect(() => {
    void refreshChapters();
  }, [refreshChapters]);

  useEffect(() => {
    void refreshCurrentChapterContent();
  }, [refreshCurrentChapterContent]);

  useEffect(() => {
    const onSelected = (event: Event) => {
      const { detail } = event as CustomEvent<{
        projectPath: string;
        chapterId: string | null;
        cause?: "user" | "create" | "delete" | "load";
      }>;
      if (!detail || detail.projectPath !== projectPath) return;
      if (detail.chapterId === currentChapterId) return;

      const nextChapterId = detail.chapterId;
      const cause = detail.cause ?? "user";

      void (async () => {
        if (!nextChapterId) {
          setCurrentChapterId(null);
          return;
        }
        if (cause !== "delete") {
          const hasUnsaved = editorRef.current?.hasUnsavedChanges() ?? false;
          if (hasUnsaved) {
            const ok = await editorRef.current?.saveNow();
            if (ok === false) {
              message.error("切换章节前自动保存失败，请稍后重试。");
              return;
            }
          }
        }

        setCurrentChapterId(nextChapterId);
      })();
    };

    const onOpenSettings = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      setSidebarView("settings");
    };

    const onChaptersChanged = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; reason?: string }>;
      if (!detail || detail.projectPath !== projectPath) return;
      void refreshChapters();
      if (detail.reason === "append" && saveStatus === "saved") {
        void refreshCurrentChapterContent();
      }
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
  }, [
    projectPath,
    refreshChapters,
    refreshCurrentChapterContent,
    saveStatus,
    currentChapterId,
  ]);

  const chapterWordCount = useMemo(() => {
    if (!currentChapterId) return 0;
    return countWords(draftContent);
  }, [currentChapterId, draftContent]);

  const totalWordCount = useMemo(() => {
    if (!currentChapterId) return chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0);
    return chapters.reduce((sum, c) => {
      if (c.id === currentChapterId) return sum + chapterWordCount;
      return sum + (c.wordCount || 0);
    }, 0);
  }, [chapters, currentChapterId, chapterWordCount]);

  const chapterTitle = useMemo(() => {
    if (!currentChapterId) return "未选择章节";
    return chapters.find((c) => c.id === currentChapterId)?.title ?? currentChapterId;
  }, [chapters, currentChapterId]);

  const handleSave = useCallback(
    async (content: string) => {
      if (!currentChapterId) return;
      await invoke("save_chapter_content", {
        projectPath,
        chapterId: currentChapterId,
        content,
      });
    },
    [projectPath, currentChapterId],
  );

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
        <Editor
          ref={editorRef}
          projectPath={projectPath}
          chapterId={currentChapterId}
          chapterTitle={chapterTitle}
          initialContent={chapterContent}
          onChange={setDraftContent}
          onSave={handleSave}
        />
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
