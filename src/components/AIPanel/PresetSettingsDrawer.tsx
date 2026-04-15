import { CheckOutlined, DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Divider, Drawer, List, Space, Typography, message } from "antd";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { WritingPreset } from "../../types/writingPreset";
import { createBuiltinWritingPresets, createDefaultWritingPreset } from "../../types/writingPreset";
import PresetForm from "./PresetForm";
import { formatError } from "../../utils/error";
import { formatPresetAsMarkdown, parsePresetFromText } from "../../lib/writingPresetFiles";

interface PresetSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  presets: WritingPreset[];
  activePresetId: string;
  onSave: (presets: WritingPreset[], activeId: string) => Promise<void> | void;
}

function clonePreset(p: WritingPreset): WritingPreset {
  return {
    ...p,
    style: { ...p.style },
    rules: Array.isArray(p.rules) ? [...p.rules] : [],
  };
}

function clonePresets(presets: WritingPreset[]): WritingPreset[] {
  return presets.map(clonePreset);
}

function generateId() {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function PresetSettingsDrawer({
  open,
  onClose,
  presets,
  activePresetId,
  onSave,
}: PresetSettingsDrawerProps) {
  const [workingPresets, setWorkingPresets] = useState<WritingPreset[]>([]);
  const [workingActiveId, setWorkingActiveId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const builtinPresets = useMemo(() => createBuiltinWritingPresets(), []);

  useEffect(() => {
    if (!open) return;
    const next = presets.length ? clonePresets(presets) : clonePresets(builtinPresets);
    const active =
      activePresetId && next.some((p) => p.id === activePresetId)
        ? activePresetId
        : next.find((p) => p.isDefault)?.id ?? next[0]?.id ?? createDefaultWritingPreset().id;

    setWorkingPresets(next);
    setWorkingActiveId(active);
    setSelectedId(active);
    setSaving(false);
    setDirty(false);
  }, [open, presets, activePresetId, builtinPresets]);

  const selectedPreset = useMemo(() => {
    return workingPresets.find((p) => p.id === selectedId) ?? null;
  }, [workingPresets, selectedId]);

  const activeName = useMemo(() => {
    return workingPresets.find((p) => p.id === workingActiveId)?.name ?? "";
  }, [workingPresets, workingActiveId]);

  const updatePreset = (nextPreset: WritingPreset) => {
    setWorkingPresets((prev) => prev.map((p) => (p.id === nextPreset.id ? clonePreset(nextPreset) : p)));
    setDirty(true);
  };

  const setActive = (id: string) => {
    setSelectedId(id);
    setWorkingActiveId(id);
    setDirty(true);
  };

  const handleCreate = () => {
    const base = workingPresets.find((p) => p.id === workingActiveId) ?? createDefaultWritingPreset();
    const id = generateId();
    const next: WritingPreset = {
      ...clonePreset(base),
      id,
      name: "新建预设",
      isDefault: false,
    };
    setWorkingPresets((prev) => [next, ...prev]);
    setSelectedId(id);
    setWorkingActiveId(id);
    setDirty(true);
  };

  const handleReset = () => {
    const current = selectedPreset;
    if (!current) return;
    const base = createDefaultWritingPreset();
    const next: WritingPreset = {
      ...current,
      name: current.isDefault ? base.name : current.name,
      style: { ...base.style },
      rules: [],
      customPrompt: "",
    };
    updatePreset(next);
  };

  const handleSave = async () => {
    if (saving) return;
    const normalized = workingPresets.length ? workingPresets : clonePresets(builtinPresets);
    const active =
      workingActiveId && normalized.some((p) => p.id === workingActiveId)
        ? workingActiveId
        : normalized.find((p) => p.isDefault)?.id ?? normalized[0].id;

    setSaving(true);
    try {
      await Promise.resolve(onSave(normalized, active));
      setDirty(false);
    } catch (error) {
      message.error(`保存写作预设失败: ${formatError(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!selectedPreset) return;
    const blob = new Blob([formatPresetAsMarkdown(selectedPreset)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = (selectedPreset.name || "preset").replace(/[\\/:*?"<>|]/g, "-");
    anchor.href = url;
    anchor.download = `${safeName}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    message.success("已导出当前预设");
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const imported = parsePresetFromText(await file.text(), file.name);
      const nextPreset: WritingPreset = {
        ...imported,
        id: generateId(),
        isDefault: false,
      };
      setWorkingPresets((prev) => [nextPreset, ...prev.map(clonePreset)]);
      setSelectedId(nextPreset.id);
      setWorkingActiveId(nextPreset.id);
      setDirty(true);
      message.success(`已导入预设：${nextPreset.name}`);
    } catch (error) {
      message.error(`导入预设失败: ${formatError(error)}`);
    }
  };

  return (
    <Drawer
      title="写作预设设置"
      open={open}
      onClose={onClose}
      placement="right"
      width={520}
      destroyOnClose
      className="writing-preset-drawer"
      styles={{
        header: { background: "var(--bg-secondary)", borderBottom: "1px solid var(--border)" },
        body: { background: "var(--bg-secondary)", color: "var(--text-primary)" },
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Typography.Text strong>预设列表</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <input
              ref={importInputRef}
              type="file"
              accept=".md,.txt,text/plain,text/markdown"
              style={{ display: "none" }}
              onChange={(e) => void handleImportFile(e)}
            />
            <List
              size="small"
              bordered
              dataSource={workingPresets}
              renderItem={(item) => {
                const isActive = item.id === workingActiveId;
                return (
                  <List.Item
                    className={isActive ? "writing-preset-item active" : "writing-preset-item"}
                    onClick={() => setActive(item.id)}
                    actions={[
                      <Button
                        key="edit"
                        size="small"
                        type="link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(item.id);
                        }}
                      >
                        编辑
                      </Button>,
                    ]}
                  >
                    <Space size={8}>
                      <span className="writing-preset-check">{isActive ? <CheckOutlined /> : null}</span>
                      <span>{item.name}</span>
                    </Space>
                  </List.Item>
                );
              }}
            />
            <Button
              style={{ marginTop: 8 }}
              type="dashed"
              block
              icon={<PlusOutlined />}
              onClick={handleCreate}
            >
              新建预设
            </Button>
            <Space style={{ marginTop: 8, width: "100%" }}>
              <Button icon={<UploadOutlined />} onClick={handleImportClick}>
                导入 md/txt
              </Button>
              <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!selectedPreset}>
                导出当前
              </Button>
            </Space>
          </div>
        </div>

        <Divider style={{ margin: "4px 0" }} />

        <Typography.Text type="secondary">
          当前预设: <Typography.Text>{activeName}</Typography.Text>
        </Typography.Text>

        {selectedPreset ? (
          <PresetForm preset={selectedPreset} onChange={updatePreset} />
        ) : (
          <Typography.Text type="secondary">未选择预设</Typography.Text>
        )}

        <div className="writing-preset-drawer-footer">
          <Space>
            <Button type="primary" onClick={() => void handleSave()} loading={saving} disabled={!dirty}>
              保存
            </Button>
            <Button onClick={handleReset} disabled={!selectedPreset || saving}>
              重置为默认
            </Button>
          </Space>
          {dirty ? (
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              有未保存的修改
            </Typography.Text>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
