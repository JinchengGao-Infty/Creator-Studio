/**
 * 布局管理 Hook
 * 
 * 统一管理侧边栏、AI 面板的宽度和折叠状态
 */

import { useCallback, useEffect, useRef, useState } from "react";

const ACTIVITY_BAR_WIDTH = 48;
const RESIZER_WIDTH = 6;
const EDITOR_MIN_WIDTH = 300;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 800;
const SIDEBAR_COLLAPSE_THRESHOLD = 80;
const AI_PANEL_DEFAULT = 360;
const AI_PANEL_MIN = 280;
const AI_PANEL_MAX = 720;
const AI_PANEL_COLLAPSE_THRESHOLD = 140;

function layoutStorageKey(projectPath: string, key: string): string {
  return `creatorai:layout:${encodeURIComponent(projectPath)}:${key}`;
}

function readStoredNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export interface LayoutState {
  sidebarWidth: number;
  aiPanelWidth: number;
  sidebarCollapsed: boolean;
  aiPanelCollapsed: boolean;
  dragging: null | "sidebar" | "ai";
}

export interface LayoutActions {
  setSidebarWidth: (width: number) => void;
  setAiPanelWidth: (width: number) => void;
  setDragging: (dragging: null | "sidebar" | "ai") => void;
  toggleSidebarCollapsed: () => void;
  toggleAiPanelCollapsed: () => void;
  beginResizeSidebar: (event: React.PointerEvent) => void;
  beginResizeAi: (event: React.PointerEvent) => void;
  layoutRef: React.RefObject<HTMLDivElement | null>;
}

export function useLayoutManager(projectPath: string): LayoutState & LayoutActions {
  const layoutRef = useRef<HTMLDivElement | null>(null);
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

  // 初始化布局宽度
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

  // 持久化侧边栏宽度
  useEffect(() => {
    const sidebarKey = layoutStorageKey(projectPath, "sidebarWidth");
    const sidebarLastKey = layoutStorageKey(projectPath, "sidebarLastWidth");
    localStorage.setItem(sidebarKey, String(sidebarWidth));
    if (sidebarWidth > 0) {
      localStorage.setItem(sidebarLastKey, String(sidebarWidth));
      sidebarLastWidthRef.current = sidebarWidth;
    }
  }, [projectPath, sidebarWidth]);

  // 持久化 AI 面板宽度
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

  return {
    // State
    sidebarWidth,
    aiPanelWidth,
    sidebarCollapsed,
    aiPanelCollapsed,
    dragging,
    // Setters
    setSidebarWidth,
    setAiPanelWidth,
    setDragging,
    // Actions
    toggleSidebarCollapsed,
    toggleAiPanelCollapsed,
    beginResizeSidebar,
    beginResizeAi,
    // Ref for layout container
    layoutRef,
  };
}
