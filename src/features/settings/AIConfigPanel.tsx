/**
 * 统一 AI 配置面板
 *
 * 将 Provider 配置和模型参数配置整合到一个面板中，
 * 解决配置体验糟糕的问题
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement } from "react";
import {
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  List,
  Modal,
  Select,
  Slider,
  InputNumber,
  Space,
  Tag,
  Tooltip,
  message,
  Alert,
} from "antd";
import {
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useAIConfigStore } from "./store/aiConfigStore";
import type { Provider, ModelParameters } from "../../platform/tauri/client";

function emitConfigChanged(): void {
  window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
}

function formatUnixTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * 统一的 AI 配置面板
 */
export function AIConfigPanel(): ReactElement {
  const {
    providers,
    activeProviderId,
    defaultParameters,
    loading,
    refreshingModels,
    loadConfig,
    addProvider,
    updateProvider,
    deleteProvider,
    setActiveProvider,
    refreshModels,
    setDefaultParameters,
  } = useAIConfigStore();

  const [modalVisible, setModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [form] = Form.useForm<{
    name: string;
    base_url: string;
    api_key?: string;
    provider_type: string;
  }>();
  const [modelForm] = Form.useForm<ModelParameters>();
  const autoRefreshAttemptedRef = useRef<Set<string>>(new Set());

  // 加载配置
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  // 监听配置变更
  useEffect(() => {
    const onConfigChanged = (): void => {
      void loadConfig();
    };
    window.addEventListener("creatorai:globalConfigChanged", onConfigChanged);
    return () => window.removeEventListener("creatorai:globalConfigChanged", onConfigChanged);
  }, [loadConfig]);

  // 获取当前激活的 Provider
  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null;
  const hasValidConfig = !!activeProviderId && !!defaultParameters.model;
  const providerCountLabel = useMemo(() => {
    if (providers.length === 0) return "未配置";
    if (providers.length === 1) return "1 个配置";
    return `${providers.length} 个配置`;
  }, [providers.length]);

  useEffect(() => {
    const providerModels = activeProvider?.models ?? [];
    const currentModel = defaultParameters.model?.trim() ?? "";
    const resolvedModel =
      providerModels.length > 0 && (!currentModel || !providerModels.includes(currentModel))
        ? providerModels[0]
        : currentModel;

    modelForm.setFieldsValue({
      model: resolvedModel || undefined,
      temperature: defaultParameters.temperature,
      top_p: defaultParameters.top_p,
      top_k: defaultParameters.top_k,
      max_tokens: defaultParameters.max_tokens,
    });
  }, [activeProvider, defaultParameters, modelForm]);

  useEffect(() => {
    if (!activeProvider || activeProvider.models.length > 0 || refreshingModels[activeProvider.id]) {
      return;
    }
    if (autoRefreshAttemptedRef.current.has(activeProvider.id)) {
      return;
    }
    autoRefreshAttemptedRef.current.add(activeProvider.id);
    void refreshModels(activeProvider.id).catch(() => undefined);
  }, [activeProvider, refreshingModels, refreshModels]);

  // 处理添加/编辑 Provider
  const handleSubmit = async (values: {
    name: string;
    base_url: string;
    api_key?: string;
    provider_type: string;
  }): Promise<void> => {
    try {
      if (editingProvider) {
        // 编辑模式
        const baseUrlChanged = values.base_url !== editingProvider.base_url;
        const typeChanged = values.provider_type !== editingProvider.provider_type;

        await updateProvider(
          {
            id: editingProvider.id,
            name: values.name,
            base_url: values.base_url,
            models: baseUrlChanged || typeChanged ? [] : editingProvider.models,
            models_updated_at: baseUrlChanged || typeChanged ? null : editingProvider.models_updated_at,
            provider_type: values.provider_type,
            headers: editingProvider.headers ?? null,
          },
          values.api_key?.trim() || null
        );

        if (baseUrlChanged || typeChanged) {
          message.loading({ content: "正在获取模型列表...", key: "models", duration: 0 });
          try {
            await refreshModels(editingProvider.id);
            message.success({ content: "模型列表已更新", key: "models" });
          } catch {
            message.warning({ content: "获取模型列表失败", key: "models" });
          }
        }
      } else {
        // 添加模式
        const apiKey = values.api_key?.trim();
        if (!apiKey) {
          message.error("请输入 API Key");
          return;
        }

        const id = `provider_${Date.now()}`;
        await addProvider(
          {
            id,
            name: values.name,
            base_url: values.base_url,
            provider_type: values.provider_type,
            headers: null,
            models: [],
            models_updated_at: null,
          },
          apiKey
        );

        message.loading({ content: "正在获取模型列表...", key: "models", duration: 0 });
        try {
          await refreshModels(id);
          message.success({ content: "配置成功", key: "models" });
        } catch {
          message.warning({ content: "获取模型列表失败，请稍后手动刷新", key: "models" });
        }
      }

      setModalVisible(false);
      form.resetFields();
      setEditingProvider(null);
      emitConfigChanged();
    } catch (error) {
      message.error(`操作失败: ${error}`);
    }
  };

  // 打开编辑弹窗
  const openEditModal = (provider: Provider): void => {
    setEditingProvider(provider);
    form.setFieldsValue({
      name: provider.name,
      base_url: provider.base_url,
      provider_type: provider.provider_type,
      api_key: "",
    });
    setModalVisible(true);
  };

  // 模型参数表单提交
  const handleModelSave = async (values: ModelParameters): Promise<void> => {
    try {
      await setDefaultParameters(values);
      message.success("保存成功");
      emitConfigChanged();
    } catch (error) {
      message.error(`保存失败: ${error}`);
    }
  };

  return (
    <div style={{ padding: 16, height: "100%", overflow: "auto" }}>
      {/* 配置状态提示 */}
      {!hasValidConfig && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message="AI 配置不完整"
          description="请先添加并配置 Provider，然后选择模型。"
          style={{ marginBottom: 16 }}
        />
      )}

      {hasValidConfig && (
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          message="AI 配置就绪"
          description={`当前使用 ${activeProvider?.name ?? ""} - ${defaultParameters.model}`}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Provider 列表 */}
      <Card
        title={`服务商 · ${providerCountLabel}`}
        extra={
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingProvider(null);
              form.resetFields();
              setModalVisible(true);
            }}
          >
            添加
          </Button>
        }
      >
        <List
          dataSource={providers}
          loading={loading}
          locale={{ emptyText: "暂无 Provider，点击右上角添加" }}
          renderItem={(record) => {
            const isActive = record.id === activeProviderId;
            const updated = formatUnixTime(record.models_updated_at);
            const modelCount = record.models?.length ?? 0;
            const type =
              record.provider_type === "openai-compatible"
                ? "OpenAI"
                : record.provider_type === "google"
                  ? "Google"
                  : record.provider_type === "anthropic"
                    ? "Anthropic"
                    : record.provider_type;

            const menuItems: Array<{
              key: string;
              label: string;
              icon?: ReactNode;
              onClick?: () => void;
              danger?: boolean;
            }> = [
              !isActive
                ? {
                    key: "active",
                    label: "设为当前",
                    icon: <SafetyCertificateOutlined />,
                    onClick: () => void setActiveProvider(record.id),
                  }
                : null,
              {
                key: "refresh",
                label: "刷新模型",
                icon: <ReloadOutlined />,
                onClick: () => void refreshModels(record.id),
              },
              {
                key: "edit",
                label: "编辑",
                icon: <EditOutlined />,
                onClick: () => void openEditModal(record),
              },
              {
                key: "delete",
                label: "删除",
                danger: true,
                onClick: () => {
                  Modal.confirm({
                    title: "删除 Provider",
                    content: `确定要删除「${record.name}」吗？此操作会移除本地配置（API Key 将从 Keychain 删除）。`,
                    okText: "删除",
                    okType: "danger",
                    cancelText: "取消",
                    onOk: () => deleteProvider(record.id),
                  });
                },
              },
            ].filter(Boolean) as typeof menuItems;

            return (
              <List.Item
                style={{ padding: "10px 0" }}
                actions={[
                  <Dropdown
                    key="menu"
                    trigger={["click"]}
                    menu={{
                      items: menuItems.map((i) => ({
                        key: i.key,
                        label: i.label,
                        icon: i.icon,
                        danger: i.danger,
                        onClick: i.onClick,
                      })),
                    }}
                  >
                    <Button size="small" type="text" icon={<EllipsisOutlined />} />
                  </Dropdown>,
                ]}
              >
                <div style={{ minWidth: 0 }}>
                  <Space size={6} wrap>
                    <Tooltip title={record.id}>
                      <span style={{ fontWeight: 600 }}>{record.name}</span>
                    </Tooltip>
                    {isActive ? <Tag color="green">当前</Tag> : null}
                    <Tag icon={<SafetyCertificateOutlined />}>{type}</Tag>
                    {refreshingModels[record.id] && <Tag>刷新中...</Tag>}
                  </Space>

                  <div style={{ marginTop: 6 }}>
                    <Tooltip title={record.base_url}>
                      <span style={{ color: "var(--text-secondary)", fontSize: 12, wordBreak: "break-all" }}>
                        {record.base_url}
                      </span>
                    </Tooltip>
                  </div>

                  <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 12 }}>
                    模型：{modelCount ? `${modelCount} 个` : "未获取"}
                    {updated ? ` · 更新：${updated}` : ""}
                  </div>
                </div>
              </List.Item>
            );
          }}
        />
      </Card>

      {/* 模型参数配置 */}
      <Card title="模型参数" style={{ marginTop: 16 }}>
        <Form
          form={modelForm}
          layout="vertical"
          onFinish={handleModelSave}
        >
          {/* 模型选择 */}
          <Form.Item
            name="model"
            label="模型"
            rules={[{ required: true, message: "请选择或输入模型" }]}
          >
            {activeProvider && activeProvider.models.length > 0 ? (
              <Select
                placeholder="选择模型"
                showSearch
                optionFilterProp="label"
                options={activeProvider.models.map((m: string) => ({ value: m, label: m }))}
              />
            ) : (
              <Input placeholder="手动输入模型名称，如 gpt-5.4" />
            )}
          </Form.Item>

          {activeProvider ? (
            <Alert
              type={activeProvider.models.length > 0 ? "info" : "warning"}
              showIcon
              style={{ marginBottom: 16 }}
              message={
                activeProvider.models.length > 0
                  ? `当前 Provider 已发现 ${activeProvider.models.length} 个模型`
                  : "当前 Provider 还没有拉到模型列表"
              }
              description={
                activeProvider.models.length > 0
                  ? "如果网关不提供 /models，也可以直接手动输入模型名。"
                  : "可以在上面的 Provider 列表里点“刷新模型”。如果网关不支持 /models，直接手动输入模型名即可。"
              }
            />
          ) : null}

          {/* Temperature */}
          <Form.Item
            name="temperature"
            label="Temperature"
            tooltip="控制输出的随机性，值越高越随机"
          >
            <Slider min={0} max={2} step={0.1} marks={{ 0: "0", 1: "1", 2: "2" }} />
          </Form.Item>

          {/* Top P */}
          <Form.Item name="top_p" label="Top P" tooltip="核采样参数，控制输出的多样性">
            <Slider min={0} max={1} step={0.05} marks={{ 0: "0", 0.5: "0.5", 1: "1" }} />
          </Form.Item>

          {/* Top K */}
          <Form.Item name="top_k" label="Top K" tooltip="限制每次采样的候选词数量（可选）">
            <InputNumber
              min={1}
              max={100}
              placeholder="留空则不限制"
              style={{ width: "100%" }}
            />
          </Form.Item>

          {/* Max Tokens */}
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

      {/* 添加/编辑 Provider 弹窗 */}
      <Modal
        title={editingProvider ? "编辑服务商" : "添加服务商"}
        open={modalVisible}
        onCancel={() => {
          setModalVisible(false);
          setEditingProvider(null);
          form.resetFields();
        }}
        onOk={() => void form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(v) => void handleSubmit(v)}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="如：Deepseek、Gemini" />
          </Form.Item>
          <Form.Item
            name="base_url"
            label="Base URL"
            rules={[{ required: true, message: "请输入 Base URL" }]}
          >
            <Input placeholder="如：https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API Key"
            rules={[{ required: !editingProvider, message: "请输入 API Key" }]}
            extra="API Key 会保存在系统钥匙串（Keychain）。编辑时留空表示不修改。"
          >
            <Input.Password
              placeholder={editingProvider ? "留空则不修改" : "请输入 API Key"}
            />
          </Form.Item>
          <Form.Item name="provider_type" label="Provider 类型" initialValue="openai-compatible">
            <Select
              options={[
                { value: "openai-compatible", label: "OpenAI Compatible（Authorization: Bearer）" },
                { value: "google", label: "Google（x-goog-api-key）" },
                { value: "anthropic", label: "Anthropic（x-api-key）" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
