/**
 * 章节管理 Hook
 * 
 * 封装章节加载、保存、切换等操作
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { message } from "antd";
import { formatError } from "../utils/error";

// ==================== 网页版章节存储 ====================

const WEB_CHAPTERS_KEY = "creator-web-chapters";

interface WebChapter {
  id: string;
  title: string;
  content: string;
  order: number;
  created: number;
  updated: number;
  wordCount: number;
}

function getWebChapters(): WebChapter[] {
  try {
    const stored = localStorage.getItem(WEB_CHAPTERS_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {}
  return [];
}

function setWebChapters(chapters: WebChapter[]): void {
  try {
    localStorage.setItem(WEB_CHAPTERS_KEY, JSON.stringify(chapters));
  } catch {}
}

function createWebChapter(title: string): WebChapter {
  return {
    id: `chapter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    content: "",
    order: getWebChapters().length,
    created: Date.now(),
    updated: Date.now(),
    wordCount: 0,
  };
}

// ==================== 类型定义 ====================

export interface ChapterMeta {
  id: string;
  title: string;
  order: number;
  created: number;
  updated: number;
  wordCount: number;
}

function currentChapterStorageKey(projectPath: string): string {
  return `creatorai:currentChapter:${encodeURIComponent(projectPath)}`;
}

export interface ChapterState {
  chapters: ChapterMeta[];
  currentChapterId: string | null;
  chapterContent: string;
  draftContent: string;
  saveStatus: "saved" | "saving" | "unsaved";
}

export interface ChapterActions {
  refreshChapters: () => Promise<void>;
  selectChapter: (chapterId: string | null) => void;
  loadChapterContent: (chapterId: string) => Promise<void>;
  saveChapter: (content: string) => Promise<void>;
  setDraftContent: (content: string) => void;
}

export function useChapterManager(
  projectPath: string,
  onContentChange?: (content: string) => void
): ChapterState & ChapterActions {
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [currentChapterId, setCurrentChapterId] = useState<string | null>(null);
  const [chapterContent, setChapterContent] = useState("");
  const [draftContent, setDraftContentState] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const contentLoadTokenRef = useRef(0);
  const isInitializedRef = useRef(false);

  // 检查是否为网页版
  const isWebEnv = !isTauri();
  const isWebDemo = projectPath.startsWith("web-demo://");

  // 刷新章节列表
  const refreshChapters = useCallback(async () => {
    try {
      let result: ChapterMeta[];

      if (isWebDemo) {
        // 网页版演示项目
        let webChapters = getWebChapters();
        if (webChapters.length === 0) {
          // 创建默认章节
          const defaultChapter = createWebChapter("第一章");
          defaultChapter.content = "欢迎使用 CreatorAI 网页版！\n\n您可以在此编写故事，同时体验世界观编辑器的功能。";
          defaultChapter.wordCount = defaultChapter.content.length;
          webChapters = [defaultChapter];
          setWebChapters(webChapters);
        }
        result = webChapters.map((c) => ({
          id: c.id,
          title: c.title,
          order: c.order,
          created: c.created,
          updated: c.updated,
          wordCount: c.wordCount,
        }));
      } else if (isTauri()) {
        result = (await invoke("list_chapters", { projectPath })) as ChapterMeta[];
      } else {
        setChapters([]);
        setCurrentChapterId(null);
        return;
      }

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
  }, [projectPath, isWebEnv, isWebDemo]);

  // 加载章节内容
  const loadChapterContent = useCallback(async (chapterId: string) => {
    const token = (contentLoadTokenRef.current += 1);
    try {
      let content: string;

      if (isWebDemo) {
        const webChapters = getWebChapters();
        const chapter = webChapters.find((c) => c.id === chapterId);
        content = chapter?.content || "";
      } else if (isTauri()) {
        content = (await invoke("get_chapter_content", {
          projectPath,
          chapterId,
        })) as string;
      } else {
        content = "";
      }

      if (contentLoadTokenRef.current !== token) return;
      setChapterContent(content ?? "");
      setDraftContentState(content ?? "");
      onContentChange?.(content ?? "");
      setSaveStatus("saved");
    } catch (error) {
      if (contentLoadTokenRef.current !== token) return;
      setChapterContent("");
      setDraftContentState("");
      onContentChange?.("");
      message.error(`加载章节内容失败: ${formatError(error)}`);
    }
  }, [projectPath, onContentChange, isWebDemo]);

  // 选择章节
  const selectChapter = useCallback((chapterId: string | null) => {
    setCurrentChapterId(chapterId);
    if (chapterId) {
      localStorage.setItem(currentChapterStorageKey(projectPath), chapterId);
    }
  }, [projectPath]);

  // 保存章节
  const saveChapter = useCallback(async (content: string) => {
    if (!currentChapterId) return;
    setSaveStatus("saving");
    try {
      if (isWebDemo) {
        // 网页版保存
        const webChapters = getWebChapters();
        const index = webChapters.findIndex((c) => c.id === currentChapterId);
        if (index !== -1) {
          webChapters[index].content = content;
          webChapters[index].wordCount = content.length;
          webChapters[index].updated = Date.now();
          setWebChapters(webChapters);
        }
      } else if (isTauri()) {
        await invoke("save_chapter_content", {
          projectPath,
          chapterId: currentChapterId,
          content,
        });
      }
      setChapterContent(content);
      setDraftContentState(content);
      onContentChange?.(content);
      setSaveStatus("saved");

      // 广播保存状态
      window.dispatchEvent(
        new CustomEvent("creatorai:saveStatus", {
          detail: { projectPath, saveStatus: "saved" },
        }),
      );
    } catch (error) {
      setSaveStatus("unsaved");
      message.error(`保存失败: ${formatError(error)}`);
    }
  }, [projectPath, currentChapterId, onContentChange, isWebDemo]);

  // 更新草稿内容
  const setDraftContent = useCallback((content: string) => {
    setDraftContentState(content);
    setSaveStatus("unsaved");
  }, []);

  // 初始化加载章节
  useEffect(() => {
    void refreshChapters().then(() => {
      // 初始化完成后允许处理 ChapterList 的章节切换事件
      isInitializedRef.current = true;
    });
  }, [refreshChapters]);

  // 当章节 ID 变化时加载内容
  useEffect(() => {
    if (currentChapterId) {
      void loadChapterContent(currentChapterId);
    } else {
      setChapterContent("");
      setDraftContentState("");
      onContentChange?.("");
    }
  }, [currentChapterId, loadChapterContent, onContentChange]);

  // 监听 ChapterList 的章节切换事件
  // 使用 isInitializedRef 避免初始化时的循环调用
  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<{
        projectPath: string;
        chapterId: string | null;
        cause?: string;
      }>;

      // 只处理当前项目的章节切换
      if (!detail || detail.projectPath !== projectPath) return;

      // 初始化阶段忽略（初始化通过 refreshChapters 内部的 setCurrentChapterId 完成）
      if (!isInitializedRef.current) return;

      // 如果章节 ID 变化，切换章节
      if (detail.chapterId !== currentChapterId) {
        setCurrentChapterId(detail.chapterId);

        // 同时更新 localStorage
        if (detail.chapterId) {
          localStorage.setItem(
            currentChapterStorageKey(projectPath),
            detail.chapterId
          );
        }
      }
    };

    window.addEventListener("creatorai:chapterSelected", handler);
    return () => window.removeEventListener("creatorai:chapterSelected", handler);
  }, [projectPath, currentChapterId]);

  return {
    // State
    chapters,
    currentChapterId,
    chapterContent,
    draftContent,
    saveStatus,
    // Actions
    refreshChapters,
    selectChapter,
    loadChapterContent,
    saveChapter,
    setDraftContent,
  };
}
