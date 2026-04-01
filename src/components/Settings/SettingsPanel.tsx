import { QuickConfigPanel } from "../../features/settings/QuickConfigPanel";
import { EditorSettingsPanel } from "../../features/settings/EditorSettingsPanel";

export default function SettingsPanel() {
  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      {/* 快速配置面板 */}
      <QuickConfigPanel />
      {/* 编辑器设置面板 */}
      <EditorSettingsPanel />
    </div>
  );
}
