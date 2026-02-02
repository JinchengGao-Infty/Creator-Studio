import { Tabs } from "antd";
import ModelSettings from "./ModelSettings";
import ProviderSettings from "./ProviderSettings";

export default function SettingsPanel() {
  return (
    <div style={{ padding: 16 }}>
      <Tabs
        items={[
          {
            key: "provider",
            label: "Provider 配置",
            children: <ProviderSettings />,
          },
          {
            key: "model",
            label: "模型参数",
            children: <ModelSettings />,
          },
        ]}
      />
    </div>
  );
}

