import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { ConfigProvider, message, theme as antdTheme } from "antd";
import { CreateProjectModal, type RecentProject, WelcomePage } from "./components/Project";
import { useTheme } from "./hooks/useTheme";
import MainLayout from "./layouts/MainLayout";
import { formatError } from "./utils/error";

interface ProjectSettings {
  autoSave: boolean;
  autoSaveInterval: number;
}

interface ProjectConfig {
  name: string;
  created: number;
  updated: number;
  version: string;
  settings: ProjectSettings;
}

function joinPath(parent: string, child: string): string {
  const trimmedParent = parent.replace(/[\\/]+$/, "");
  const separator = trimmedParent.includes("\\") ? "\\" : "/";
  if (!trimmedParent) return child;
  return `${trimmedParent}${separator}${child}`;
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [currentProject, setCurrentProject] = useState<{ path: string; config: ProjectConfig } | null>(
    null,
  );
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [projectBusy, setProjectBusy] = useState(false);

  const loadRecentProjects = async () => {
    try {
      const recent = (await invoke("get_recent_projects")) as RecentProject[];
      setRecentProjects(recent || []);
    } catch {
      setRecentProjects([]);
    }
  };

  useEffect(() => {
    void loadRecentProjects();
  }, []);

  useEffect(() => {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      // eslint-disable-next-line no-console
      console.error("Unhandled promise rejection:", event.reason);
      message.error(`发生未处理异常：${formatError(event.reason)}`);
    };

    const onError = (event: ErrorEvent) => {
      if (!event.error && !event.message) return;
      // eslint-disable-next-line no-console
      console.error("Uncaught error:", event.error ?? event.message);
      message.error(`发生错误：${formatError(event.error ?? event.message)}`);
    };

    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  const openProject = async (path: string) => {
    if (!path.trim()) return;

    setProjectBusy(true);
    message.loading({ content: "正在打开项目...", key: "project" });
    try {
      const config = (await invoke("open_project", { path })) as ProjectConfig;
      setCurrentProject({ path, config });
      await invoke("add_recent_project", { name: config.name, path });
      await loadRecentProjects();
      message.success({ content: `已打开项目：${config.name}`, key: "project" });
    } catch (error) {
      message.error({ content: `打开失败: ${formatError(error)}`, key: "project" });
    } finally {
      setProjectBusy(false);
    }
  };

  const handleOpenProjectDialog = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择项目文件夹",
      });
      if (typeof selected === "string" && selected.trim()) {
        await openProject(selected);
      }
    } catch (error) {
      message.error(`打开失败: ${formatError(error)}`);
    }
  };

  const createProject = async (name: string, parentPath: string) => {
    const trimmedName = name.trim();
    const trimmedParent = parentPath.trim();
    if (!trimmedName || !trimmedParent) return;

    const folderName = trimmedName.replace(/[\\/]/g, "-");
    const projectPath = joinPath(trimmedParent, folderName);

    setProjectBusy(true);
    message.loading({ content: "正在创建项目...", key: "project" });
    try {
      const config = (await invoke("create_project", {
        path: projectPath,
        name: trimmedName,
      })) as ProjectConfig;
      setCurrentProject({ path: projectPath, config });
      await invoke("add_recent_project", { name: config.name, path: projectPath });
      await loadRecentProjects();
      setCreateProjectModalOpen(false);
      message.success({ content: `项目已创建：${config.name}`, key: "project" });
    } catch (error) {
      message.error({ content: `创建失败: ${formatError(error)}`, key: "project" });
    } finally {
      setProjectBusy(false);
    }
  };

  const closeProject = () => {
    setCurrentProject(null);
  };

  const antdThemeConfig = useMemo(() => {
    const tokens =
      theme === "dark"
        ? {
            colorBgBase: "#1a1a1a",
            colorBgContainer: "#242424",
            colorBgElevated: "#242424",
            colorBorder: "#3a3a3a",
            colorText: "#e8e8e8",
            colorTextSecondary: "#a0a0a0",
            colorTextTertiary: "#666666",
            colorPrimary: "#c9a66b",
            colorPrimaryHover: "#d4b896",
            colorLink: "#c9a66b",
            colorLinkHover: "#d4b896",
            borderRadius: 10,
          }
        : {
            colorBgBase: "#fffff0",
            colorBgContainer: "#fafaf5",
            colorBgElevated: "#fafaf5",
            colorBorder: "#e8e8d8",
            colorText: "#333333",
            colorTextSecondary: "#666666",
            colorTextTertiary: "#999999",
            colorPrimary: "#8b7355",
            colorPrimaryHover: "#d4a574",
            colorLink: "#8b7355",
            colorLinkHover: "#d4a574",
            borderRadius: 10,
          };

    return {
      algorithm: theme === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: tokens,
      components: {
        Layout: {
          bodyBg: tokens.colorBgBase,
          headerBg: tokens.colorBgContainer,
          footerBg: tokens.colorBgContainer,
          siderBg: tokens.colorBgContainer,
        },
        Tooltip: {
          colorBgSpotlight: tokens.colorBgElevated,
          colorTextLightSolid: tokens.colorText,
        },
      },
    };
  }, [theme]);

  return (
    <ConfigProvider theme={antdThemeConfig}>
      {currentProject ? (
        <>
          <MainLayout
            projectPath={currentProject.path}
            projectName={currentProject.config.name}
            projectBusy={projectBusy}
            theme={theme}
            onToggleTheme={toggle}
            onCreateProject={() => setCreateProjectModalOpen(true)}
            onOpenProject={() => void handleOpenProjectDialog()}
            onCloseProject={closeProject}
          />
          <CreateProjectModal
            visible={createProjectModalOpen}
            onCancel={() => setCreateProjectModalOpen(false)}
            onCreate={(name, parentPath) => void createProject(name, parentPath)}
          />
        </>
      ) : (
        <>
          <WelcomePage
            onCreateProject={() => setCreateProjectModalOpen(true)}
            onOpenProject={() => void handleOpenProjectDialog()}
            recentProjects={recentProjects}
            onOpenRecent={(path) => void openProject(path)}
          />
          <CreateProjectModal
            visible={createProjectModalOpen}
            onCancel={() => setCreateProjectModalOpen(false)}
            onCreate={(name, parentPath) => void createProject(name, parentPath)}
          />
        </>
      )}
    </ConfigProvider>
  );
}
