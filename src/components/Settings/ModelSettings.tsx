import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, Form, InputNumber, Select, Slider, message } from "antd";
import { formatError } from "../../utils/error";

interface ModelParameters {
  model: string;
  temperature: number;
  top_p: number;
  top_k: number | null;
  max_tokens: number;
}

interface Provider {
  id: string;
  name: string;
  models: string[];
}

interface GlobalConfig {
  providers: Provider[];
  active_provider_id: string | null;
  default_parameters: ModelParameters;
}

export default function ModelSettings() {
  const [form] = Form.useForm<ModelParameters>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = (await invoke("get_config")) as GlobalConfig;
      setProviders(config.providers || []);
      setActiveProviderId(config.active_provider_id ?? null);

      if (config.active_provider_id) {
        const provider = config.providers.find((p) => p.id === config.active_provider_id);
        if (provider) setModels(provider.models || []);
      } else {
        setModels([]);
      }

      form.setFieldsValue({
        model: config.default_parameters.model,
        temperature: config.default_parameters.temperature,
        top_p: config.default_parameters.top_p,
        top_k: config.default_parameters.top_k,
        max_tokens: config.default_parameters.max_tokens,
      });
    } catch (error) {
      message.error(`加载失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  const handleProviderChange = async (providerId: string) => {
    try {
      await invoke("set_active_provider", { providerId });
      const provider = providers.find((p) => p.id === providerId);
      if (provider) {
        setModels(provider.models || []);
        setActiveProviderId(providerId);
        form.setFieldsValue({ model: undefined });
      }
    } catch (error) {
      message.error(`切换失败: ${formatError(error)}`);
    }
  };

  const handleSave = async (values: ModelParameters) => {
    try {
      if (!values.model) {
        message.error("请选择模型");
        return;
      }
      await invoke("set_default_parameters", { parameters: values });
      message.success("保存成功");
    } catch (error) {
      message.error(`保存失败: ${formatError(error)}`);
    }
  };

  return (
    <Card title="模型参数">
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => void handleSave(v)}
        style={{ maxWidth: 500 }}
      >
        <Form.Item label="当前 Provider">
          <Select
            value={activeProviderId ?? undefined}
            onChange={(v) => void handleProviderChange(v)}
            placeholder="选择 Provider"
          >
            {providers.map((p) => (
              <Select.Option key={p.id} value={p.id}>
                {p.name}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item name="model" label="模型" rules={[{ required: true, message: "请选择模型" }]}>
          <Select placeholder="选择模型" showSearch>
            {models.map((m) => (
              <Select.Option key={m} value={m}>
                {m}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="temperature"
          label="Temperature"
          tooltip="控制输出的随机性，值越高越随机"
        >
          <Slider min={0} max={2} step={0.1} marks={{ 0: "0", 1: "1", 2: "2" }} />
        </Form.Item>

        <Form.Item name="top_p" label="Top P" tooltip="核采样参数，控制输出的多样性">
          <Slider min={0} max={1} step={0.05} marks={{ 0: "0", 0.5: "0.5", 1: "1" }} />
        </Form.Item>

        <Form.Item name="top_k" label="Top K" tooltip="限制每次采样的候选词数量（可选）">
          <InputNumber
            min={1}
            max={100}
            placeholder="留空则不限制"
            style={{ width: "100%" }}
          />
        </Form.Item>

        <Form.Item
          name="max_tokens"
          label="Max Tokens"
          tooltip="最大输出长度"
          rules={[{ required: true, message: "请输入最大 Token 数" }]}
        >
          <InputNumber min={100} max={32000} style={{ width: "100%" }} />
        </Form.Item>

        <Form.Item>
          <Button type="primary" htmlType="submit" loading={loading}>
            保存设置
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}
