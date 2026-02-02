import { Form, Input, Radio, Select } from "antd";
import type { WritingPreset } from "../../types/writingPreset";
import RulesList from "./RulesList";

interface PresetFormProps {
  preset: WritingPreset;
  onChange: (preset: WritingPreset) => void;
}

const TONE_OPTIONS = ["自然流畅", "轻松幽默", "严肃深沉", "温馨治愈", "悬疑紧张"];
const DESCRIPTION_OPTIONS = ["适中", "细腻", "简洁", "华丽", "写实"];

function isOneOf(value: string, options: string[]) {
  return options.includes(value);
}

export default function PresetForm({ preset, onChange }: PresetFormProps) {
  const toneSelectValue = isOneOf(preset.style.tone, TONE_OPTIONS) ? preset.style.tone : "__custom__";
  const descSelectValue = isOneOf(preset.style.description, DESCRIPTION_OPTIONS)
    ? preset.style.description
    : "__custom__";

  return (
    <Form layout="vertical">
      <Form.Item label="预设名称">
        <Input value={preset.name} onChange={(e) => onChange({ ...preset, name: e.target.value })} />
      </Form.Item>

      <Form.Item label="文风">
        <Select
          value={toneSelectValue}
          onChange={(value) => {
            if (value === "__custom__") {
              const nextTone = isOneOf(preset.style.tone, TONE_OPTIONS) ? "" : preset.style.tone;
              onChange({ ...preset, style: { ...preset.style, tone: nextTone } });
              return;
            }
            onChange({ ...preset, style: { ...preset.style, tone: String(value) } });
          }}
          options={[
            ...TONE_OPTIONS.map((t) => ({ value: t, label: t })),
            { value: "__custom__", label: "自定义..." },
          ]}
        />
        {toneSelectValue === "__custom__" ? (
          <Input
            style={{ marginTop: 8 }}
            placeholder="输入自定义文风..."
            value={preset.style.tone}
            onChange={(e) => onChange({ ...preset, style: { ...preset.style, tone: e.target.value } })}
          />
        ) : null}
      </Form.Item>

      <Form.Item label="叙事视角">
        <Radio.Group
          value={preset.style.perspective}
          onChange={(e) => onChange({ ...preset, style: { ...preset.style, perspective: e.target.value } })}
          options={[
            { label: "第一人称", value: "第一人称" },
            { label: "第三人称有限", value: "第三人称有限" },
            { label: "第三人称全知", value: "第三人称全知" },
          ]}
        />
      </Form.Item>

      <Form.Item label="时态">
        <Radio.Group
          value={preset.style.tense}
          onChange={(e) => onChange({ ...preset, style: { ...preset.style, tense: e.target.value } })}
          options={[
            { label: "过去式", value: "过去式" },
            { label: "现在式", value: "现在式" },
          ]}
        />
      </Form.Item>

      <Form.Item label="描写风格">
        <Select
          value={descSelectValue}
          onChange={(value) => {
            if (value === "__custom__") {
              const nextDesc = isOneOf(preset.style.description, DESCRIPTION_OPTIONS) ? "" : preset.style.description;
              onChange({ ...preset, style: { ...preset.style, description: nextDesc } });
              return;
            }
            onChange({ ...preset, style: { ...preset.style, description: String(value) } });
          }}
          options={[
            ...DESCRIPTION_OPTIONS.map((t) => ({ value: t, label: t })),
            { value: "__custom__", label: "自定义..." },
          ]}
        />
        {descSelectValue === "__custom__" ? (
          <Input
            style={{ marginTop: 8 }}
            placeholder="输入自定义描写风格..."
            value={preset.style.description}
            onChange={(e) =>
              onChange({ ...preset, style: { ...preset.style, description: e.target.value } })
            }
          />
        ) : null}
      </Form.Item>

      <Form.Item label="写作规则">
        <RulesList rules={preset.rules} onChange={(rules) => onChange({ ...preset, rules })} />
      </Form.Item>

      <Form.Item label="自定义提示词补充">
        <Input.TextArea
          value={preset.customPrompt}
          onChange={(e) => onChange({ ...preset, customPrompt: e.target.value })}
          rows={4}
          placeholder="添加额外的写作要求或风格参考..."
        />
      </Form.Item>
    </Form>
  );
}

