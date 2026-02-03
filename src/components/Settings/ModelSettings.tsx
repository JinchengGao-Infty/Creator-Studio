import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, Form, Input, InputNumber, Select, Slider, Space, Tooltip, message } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
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
  const [refreshingModels, setRefreshingModels] = useState(false);

  const loadProviders = useCallback(async (): Promise<GlobalConfig | null> => {
    try {
      const config = (await invoke("get_config")) as GlobalConfig;
      setProviders(config.providers || []);
      const nextActiveId = config.active_provider_id ?? null;
      setActiveProviderId(nextActiveId);

      if (nextActiveId) {
        const provider = (config.providers || []).find((p) => p.id === nextActiveId);
        setModels(provider?.models || []);
      } else {
        setModels([]);
      }
      return config;
    } catch {
      setProviders([]);
      setActiveProviderId(null);
      setModels([]);
      return null;
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const config = await loadProviders();
      if (!config) throw new Error("读取配置失败");

      const activeId = config.active_provider_id ?? null;
      const activeProvider = activeId ? (config.providers || []).find((p) => p.id === activeId) : null;
      const providerModels = (activeProvider?.models || []).filter(Boolean);
      const desiredModel = (config.default_parameters.model ?? "").trim();
      const resolvedModel =
        providerModels.length && (!desiredModel || !providerModels.includes(desiredModel))
          ? providerModels[0]
          : desiredModel;

      form.setFieldsValue({
        model: resolvedModel || undefined,
        temperature: config.default_parameters.temperature,
        top_p: config.default_parameters.top_p,
        top_k: config.default_parameters.top_k,
        max_tokens: config.default_parameters.max_tokens,
      });

      if (activeId && !(activeProvider?.models || []).length) {
        setRefreshingModels(true);
        message.loading({ content: "正在自动获取模型列表...", key: "models-auto", duration: 0 });
        try {
          const list = (await invoke("refresh_provider_models", { providerId: activeId })) as string[];
          setModels(list || []);
          if (!form.getFieldValue("model") && (list || []).length) {
            form.setFieldsValue({ model: list[0] });
          }
          message.success({ content: `已获取 ${(list || []).length} 个模型`, key: "models-auto" });
          window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
        } catch (error) {
          message.warning({ content: `自动获取模型失败: ${formatError(error)}`, key: "models-auto" });
        } finally {
          setRefreshingModels(false);
        }
      }
    } catch (error) {
      message.error(`加载失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  }, [form, loadProviders]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const onConfigChanged = () => {
      void loadAll();
    };
    window.addEventListener("creatorai:globalConfigChanged", onConfigChanged);
    return () => window.removeEventListener("creatorai:globalConfigChanged", onConfigChanged);
  }, [loadAll]);

  const handleProviderChange = async (providerId: string) => {
    try {
      await invoke("set_active_provider", { providerId });
      const config = await loadProviders();
      const provider = config?.providers?.find((p) => p.id === providerId);
      const desiredModel = (config?.default_parameters?.model ?? "").trim();
      const providerModels = (provider?.models || []).filter(Boolean);
      const resolvedModel =
        providerModels.length && (!desiredModel || !providerModels.includes(desiredModel))
          ? providerModels[0]
          : desiredModel;
      form.setFieldsValue({ model: resolvedModel || undefined });

      if (!provider?.models?.length) {
        setRefreshingModels(true);
        message.loading({ content: "正在自动获取模型列表...", key: "models-auto", duration: 0 });
        try {
          const list = (await invoke("refresh_provider_models", { providerId })) as string[];
          setModels(list || []);
          if ((list || []).length) {
            form.setFieldsValue({ model: list[0] });
          }
          message.success({ content: `已获取 ${(list || []).length} 个模型`, key: "models-auto" });
          window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
        } catch (error) {
          message.warning({ content: `自动获取模型失败: ${formatError(error)}`, key: "models-auto" });
        } finally {
          setRefreshingModels(false);
        }
      }
    } catch (error) {
      message.error(`切换失败: ${formatError(error)}`);
    }
  };

  const handleRefreshModels = async () => {
    if (!activeProviderId) {
      message.error("请先选择 Provider");
      return;
    }
    setRefreshingModels(true);
    message.loading({ content: "正在获取模型列表...", key: "models", duration: 0 });
    try {
      const list = (await invoke("refresh_provider_models", {
        providerId: activeProviderId,
      })) as string[];
      setModels(list || []);
      message.success({ content: `获取到 ${(list || []).length} 个模型`, key: "models" });
      window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
    } catch (error) {
      message.error({ content: `获取失败: ${formatError(error)}`, key: "models" });
    } finally {
      setRefreshingModels(false);
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
      >
        <Form.Item label="当前 Provider">
          <Space.Compact style={{ width: "100%" }}>
            <Select
              value={activeProviderId ?? undefined}
              onChange={(v) => void handleProviderChange(v)}
              placeholder="选择 Provider"
              style={{ flex: 1, minWidth: 0 }}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
            />
            <Tooltip title="刷新模型列表">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void handleRefreshModels()}
                loading={refreshingModels}
                disabled={!activeProviderId}
              />
            </Tooltip>
          </Space.Compact>
        </Form.Item>

        {models.length ? (
          <Form.Item name="model" label="模型" rules={[{ required: true, message: "请选择模型" }]}>
            <Select
              placeholder="选择模型"
              showSearch
              optionFilterProp="label"
              options={models.map((m) => ({ value: m, label: m }))}
            />
          </Form.Item>
        ) : (
          <Form.Item
            name="model"
            label="模型"
            rules={[{ required: true, message: "请输入模型名称" }]}
            extra="模型列表为空时可手动输入；也可以先点击“刷新模型”。"
          >
            <Input placeholder="如：gpt-4o-mini / deepseek-chat" />
          </Form.Item>
        )}

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
