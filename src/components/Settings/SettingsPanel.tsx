import { AIConfigPanel } from "../../features/settings/AIConfigPanel";
import { EditorSettingsPanel } from "../../features/settings/EditorSettingsPanel";

export default function SettingsPanel() {
  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      {/* 统一 AI 配置面板 */}
      <AIConfigPanel />
      {/* 编辑器设置面板 */}
      <EditorSettingsPanel />
    </div>
  );
}
