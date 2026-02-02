import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { message } from "antd";
import { CreateProjectModal, type RecentProject, WelcomePage } from "./components/Project";
import { useTheme } from "./hooks/useTheme";
import MainLayout from "./layouts/MainLayout";

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
      message.error({ content: `打开失败: ${String(error)}`, key: "project" });
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
      message.error(`打开失败: ${String(error)}`);
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
      message.error({ content: `创建失败: ${String(error)}`, key: "project" });
    } finally {
      setProjectBusy(false);
    }
  };

  const closeProject = () => {
    setCurrentProject(null);
  };

  if (!currentProject) {
    return (
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
    );
  }

  return (
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
  );
}
