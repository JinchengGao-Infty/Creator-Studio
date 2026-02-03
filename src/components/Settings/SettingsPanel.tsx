import { Tabs } from "antd";
import ModelSettings from "./ModelSettings";
import ProviderSettings from "./ProviderSettings";

export default function SettingsPanel() {
  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      <Tabs
        size="small"
        destroyInactiveTabPane
        items={[
          {
            key: "provider",
            label: "服务商",
            children: <ProviderSettings />,
          },
          {
            key: "model",
            label: "模型",
            children: <ModelSettings />,
          },
        ]}
      />
    </div>
  );
}
