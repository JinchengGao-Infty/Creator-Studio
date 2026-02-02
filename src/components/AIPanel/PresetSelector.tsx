import { Button, Select, Space, Typography } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { WritingPreset } from "../../types/writingPreset";

interface PresetSelectorProps {
  presets: WritingPreset[];
  activePresetId: string;
  onSelect: (presetId: string) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
}

export default function PresetSelector({
  presets,
  activePresetId,
  onSelect,
  onOpenSettings,
  disabled,
}: PresetSelectorProps) {
  return (
    <div className="ai-panel-preset">
      <Space size={8} style={{ width: "100%" }}>
        <Typography.Text type="secondary" style={{ whiteSpace: "nowrap" }}>
          预设:
        </Typography.Text>
        <Select
          size="small"
          value={activePresetId}
          onChange={onSelect}
          options={presets.map((p) => ({ value: p.id, label: p.name }))}
          style={{ flex: 1, minWidth: 0 }}
          disabled={disabled}
        />
        <Button
          size="small"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
          disabled={disabled}
        />
      </Space>
    </div>
  );
}

