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

function layoutStorageKey(projectPath: string, key: string) {
  return `creatorai:layout:${encodeURIComponent(projectPath)}:${key}`;
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

const ACTIVITY_BAR_WIDTH = 48;
const RESIZER_WIDTH = 6;
const EDITOR_MIN_WIDTH = 360;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const SIDEBAR_COLLAPSE_THRESHOLD = 80;
const AI_PANEL_DEFAULT = 360;
const AI_PANEL_MIN = 280;
const AI_PANEL_MAX = 720;
const AI_PANEL_COLLAPSE_THRESHOLD = 140;

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
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [sidebarView, setSidebarView] = useState<SidebarView>("chapters");
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [chapterContent, setChapterContent] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const editorRef = useRef<EditorHandle | null>(null);
  const contentLoadTokenRef = useRef(0);
  const [sidebarWidth, setSidebarWidth] = useState<number>(SIDEBAR_DEFAULT);
  const [aiPanelWidth, setAiPanelWidth] = useState<number>(AI_PANEL_DEFAULT);
  const sidebarLastWidthRef = useRef<number>(SIDEBAR_DEFAULT);
  const aiPanelLastWidthRef = useRef<number>(AI_PANEL_DEFAULT);
  const [dragging, setDragging] = useState<null | "sidebar" | "ai">(null);

  const sidebarCollapsed = sidebarWidth <= 0;
  const aiPanelCollapsed = aiPanelWidth <= 0;

  const getLayoutWidth = useCallback(() => {
    return layoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
  }, []);

  const clampSidebarWidth = useCallback(
    (value: number) => {
      if (value < SIDEBAR_COLLAPSE_THRESHOLD) return 0;
      const maxByLayout =
        getLayoutWidth() -
        ACTIVITY_BAR_WIDTH -
        RESIZER_WIDTH * 2 -
        (aiPanelCollapsed ? 0 : aiPanelWidth) -
        EDITOR_MIN_WIDTH;
      const max = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, maxByLayout));
      return Math.max(SIDEBAR_MIN, Math.min(max, value));
    },
    [aiPanelCollapsed, aiPanelWidth, getLayoutWidth],
  );

  const clampAiPanelWidth = useCallback(
    (value: number) => {
      if (value < AI_PANEL_COLLAPSE_THRESHOLD) return 0;
      const maxByLayout =
        getLayoutWidth() -
        ACTIVITY_BAR_WIDTH -
        RESIZER_WIDTH * 2 -
        (sidebarCollapsed ? 0 : sidebarWidth) -
        EDITOR_MIN_WIDTH;
      const max = Math.max(AI_PANEL_MIN, Math.min(AI_PANEL_MAX, maxByLayout));
      return Math.max(AI_PANEL_MIN, Math.min(max, value));
    },
    [sidebarCollapsed, sidebarWidth, getLayoutWidth],
  );

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarWidth((prev) => {
      if (prev <= 0) return sidebarLastWidthRef.current || SIDEBAR_DEFAULT;
      sidebarLastWidthRef.current = prev;
      return 0;
    });
  }, []);

  const toggleAiPanelCollapsed = useCallback(() => {
    setAiPanelWidth((prev) => {
      if (prev <= 0) return aiPanelLastWidthRef.current || AI_PANEL_DEFAULT;
      aiPanelLastWidthRef.current = prev;
      return 0;
    });
  }, []);

  useEffect(() => {
    const sidebarKey = layoutStorageKey(projectPath, "sidebarWidth");
    const sidebarLastKey = layoutStorageKey(projectPath, "sidebarLastWidth");
    const aiKey = layoutStorageKey(projectPath, "aiPanelWidth");
    const aiLastKey = layoutStorageKey(projectPath, "aiPanelLastWidth");

    const storedSidebar = readStoredNumber(sidebarKey, SIDEBAR_DEFAULT);
    const storedSidebarLast = readStoredNumber(sidebarLastKey, SIDEBAR_DEFAULT);
    const storedAi = readStoredNumber(aiKey, AI_PANEL_DEFAULT);
    const storedAiLast = readStoredNumber(aiLastKey, AI_PANEL_DEFAULT);

    setSidebarWidth(storedSidebar);
    sidebarLastWidthRef.current = storedSidebar > 0 ? storedSidebar : storedSidebarLast;

    setAiPanelWidth(storedAi);
    aiPanelLastWidthRef.current = storedAi > 0 ? storedAi : storedAiLast;
  }, [projectPath]);

  useEffect(() => {
    const sidebarKey = layoutStorageKey(projectPath, "sidebarWidth");
    const sidebarLastKey = layoutStorageKey(projectPath, "sidebarLastWidth");
    localStorage.setItem(sidebarKey, String(sidebarWidth));
    if (sidebarWidth > 0) {
      localStorage.setItem(sidebarLastKey, String(sidebarWidth));
      sidebarLastWidthRef.current = sidebarWidth;
    }
  }, [projectPath, sidebarWidth]);

  useEffect(() => {
    const aiKey = layoutStorageKey(projectPath, "aiPanelWidth");
    const aiLastKey = layoutStorageKey(projectPath, "aiPanelLastWidth");
    localStorage.setItem(aiKey, String(aiPanelWidth));
    if (aiPanelWidth > 0) {
      localStorage.setItem(aiLastKey, String(aiPanelWidth));
      aiPanelLastWidthRef.current = aiPanelWidth;
    }
  }, [projectPath, aiPanelWidth]);

  const beginResizeSidebar = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarCollapsed ? 0 : sidebarWidth;

      setDragging("sidebar");
      const previousCursor = document.body.style.cursor;
      const previousSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: PointerEvent) => {
        const next = clampSidebarWidth(startWidth + (e.clientX - startX));
        setSidebarWidth(next);
      };
      const onUp = () => {
        setDragging(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clampSidebarWidth, sidebarCollapsed, sidebarWidth],
  );

  const beginResizeAi = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = aiPanelCollapsed ? 0 : aiPanelWidth;

      setDragging("ai");
      const previousCursor = document.body.style.cursor;
      const previousSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: PointerEvent) => {
        const delta = e.clientX - startX;
        const next = clampAiPanelWidth(startWidth - delta);
        setAiPanelWidth(next);
      };
      const onUp = () => {
        setDragging(null);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelect;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [aiPanelCollapsed, aiPanelWidth, clampAiPanelWidth],
  );

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
      const previousChapterId = currentChapterId;

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
              window.dispatchEvent(
                new CustomEvent("creatorai:forceChapterSelection", {
                  detail: { projectPath, chapterId: previousChapterId ?? null },
                }),
              );
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
    };

    const onChapterAppended = (event: Event) => {
      const { detail } = event as CustomEvent<{
        projectPath: string;
        chapterId: string;
        content: string;
      }>;
      if (!detail || detail.projectPath !== projectPath) return;
      if (!detail.chapterId || detail.chapterId !== currentChapterId) return;

      const hasUnsaved = editorRef.current?.hasUnsavedChanges() ?? false;
      if (hasUnsaved) {
        editorRef.current?.applyExternalAppend(detail.content ?? "");
      } else {
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
    window.addEventListener("creatorai:chapterAppended", onChapterAppended);
    window.addEventListener("creatorai:saveStatus", onSaveStatus);
    return () => {
      window.removeEventListener("creatorai:chapterSelected", onSelected);
      window.removeEventListener("creatorai:openSettings", onOpenSettings);
      window.removeEventListener("creatorai:chaptersChanged", onChaptersChanged);
      window.removeEventListener("creatorai:chapterAppended", onChapterAppended);
      window.removeEventListener("creatorai:saveStatus", onSaveStatus);
    };
  }, [
    projectPath,
    refreshChapters,
    refreshCurrentChapterContent,
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
    <div
      className="main-layout"
      ref={layoutRef}
      style={{
        ["--sidebar-width" as never]: `${Math.max(0, sidebarWidth)}px`,
        ["--ai-panel-width" as never]: `${Math.max(0, aiPanelWidth)}px`,
      }}
    >
      <ActivityBar
        activeView={sidebarView}
        onViewChange={(next) => {
          setSidebarView(next);
          if (sidebarCollapsed) toggleSidebarCollapsed();
        }}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      <aside className={sidebarCollapsed ? "sidebar collapsed" : "sidebar"}>
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

      <div
        className={`panel-resizer sidebar-resizer ${dragging === "sidebar" ? "dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        title="拖拽调整宽度，双击隐藏/显示"
        onPointerDown={beginResizeSidebar}
        onDoubleClick={toggleSidebarCollapsed}
      />

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

      <div
        className={`panel-resizer ai-resizer ${dragging === "ai" ? "dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整 AI 面板宽度"
        title="拖拽调整宽度，双击隐藏/显示"
        onPointerDown={beginResizeAi}
        onDoubleClick={toggleAiPanelCollapsed}
      />

      <aside className={aiPanelCollapsed ? "ai-panel collapsed" : "ai-panel"}>
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
