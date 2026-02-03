import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Button,
  Card,
  Dropdown,
  Form,
  Input,
  List,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  message,
} from "antd";
import {
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { formatError } from "../../utils/error";

interface Provider {
  id: string;
  name: string;
  base_url: string;
  models: string[];
  models_updated_at: number | null;
  provider_type: string;
  headers?: Record<string, string> | null;
}

interface GlobalConfig {
  providers: Provider[];
  active_provider_id: string | null;
}

function emitConfigChanged() {
  window.dispatchEvent(new CustomEvent("creatorai:globalConfigChanged"));
}

function formatUnixTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ProviderSettings() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [form] = Form.useForm<{
    name: string;
    base_url: string;
    api_key?: string;
    provider_type: string;
  }>();

  const loadProviders = async () => {
    setLoading(true);
    try {
      const config = (await invoke("get_config")) as GlobalConfig;
      setProviders(config.providers || []);
      setActiveProviderId(config.active_provider_id ?? null);
    } catch (error) {
      message.error(`加载失败: ${formatError(error)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const handleSubmit = async (values: {
    name: string;
    base_url: string;
    api_key?: string;
    provider_type: string;
  }) => {
    try {
      if (editingProvider) {
        const baseUrlChanged = values.base_url !== editingProvider.base_url;
        const typeChanged = values.provider_type !== editingProvider.provider_type;
        await invoke("update_provider", {
          provider: {
            id: editingProvider.id,
            name: values.name,
            base_url: values.base_url,
            models: baseUrlChanged || typeChanged ? [] : editingProvider.models,
            models_updated_at: baseUrlChanged || typeChanged ? null : editingProvider.models_updated_at,
            provider_type: values.provider_type,
            headers: editingProvider.headers ?? null,
          },
          apiKey: values.api_key?.trim() ? values.api_key.trim() : null,
        });
        message.success("更新成功");

        if (baseUrlChanged || typeChanged) {
          message.loading({ content: "正在自动获取模型列表...", key: "models", duration: 0 });
          try {
            const models = (await invoke("refresh_provider_models", {
              providerId: editingProvider.id,
            })) as string[];
            message.success({ content: `已获取 ${models.length} 个模型`, key: "models" });
          } catch (error) {
            message.warning({ content: `自动获取模型失败: ${formatError(error)}`, key: "models" });
          }
        }
      } else {
        const id = `provider_${Date.now()}`;
        const apiKey = values.api_key?.trim();
        if (!apiKey) {
          message.error("请输入 API Key");
          return;
        }

        await invoke("add_provider", {
          provider: {
            id,
            name: values.name,
            base_url: values.base_url,
            models: [],
            models_updated_at: null,
            provider_type: values.provider_type,
            headers: null,
          },
          apiKey,
        });
        await invoke("set_active_provider", { providerId: id });
        message.success("添加成功");

        message.loading({ content: "正在自动获取模型列表...", key: "models", duration: 0 });
        try {
          const models = (await invoke("refresh_provider_models", {
            providerId: id,
          })) as string[];
          message.success({ content: `已获取 ${models.length} 个模型`, key: "models" });
        } catch (error) {
          message.warning({ content: `自动获取模型失败: ${formatError(error)}`, key: "models" });
        }
      }

      setModalVisible(false);
      form.resetFields();
      setEditingProvider(null);
      void loadProviders();
      emitConfigChanged();
    } catch (error) {
      message.error(`操作失败: ${formatError(error)}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_provider", { providerId: id });
      message.success("删除成功");
      void loadProviders();
      emitConfigChanged();
    } catch (error) {
      message.error(`删除失败: ${formatError(error)}`);
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      await invoke("set_active_provider", { providerId: id });
      message.success("已设置为当前 Provider");
      void loadProviders();
      emitConfigChanged();
    } catch (error) {
      message.error(`设置失败: ${formatError(error)}`);
    }
  };

  const handleRefreshModels = async (id: string) => {
    try {
      message.loading({ content: "正在获取模型列表...", key: "refresh" });
      const models = (await invoke("refresh_provider_models", {
        providerId: id,
      })) as string[];
      message.success({
        content: `获取到 ${models.length} 个模型`,
        key: "refresh",
      });
      void loadProviders();
      emitConfigChanged();
    } catch (error) {
      message.error({ content: `获取失败: ${formatError(error)}`, key: "refresh" });
    }
  };

  const openEditModal = async (provider: Provider) => {
    setEditingProvider(provider);
    try {
      const apiKey = (await invoke("get_api_key", {
        providerId: provider.id,
      })) as string | null;
      form.setFieldsValue({
        name: provider.name,
        base_url: provider.base_url,
        provider_type: provider.provider_type,
        api_key: apiKey || "",
      });
    } catch {
      form.setFieldsValue({
        name: provider.name,
        base_url: provider.base_url,
        provider_type: provider.provider_type,
        api_key: "",
      });
    }
    setModalVisible(true);
  };

  return (
    <Card
      title="Provider"
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

          const menuItems = [
            !isActive
              ? {
                  key: "active",
                  label: "设为当前",
                  icon: <SafetyCertificateOutlined />,
                  onClick: () => void handleSetActive(record.id),
                }
              : null,
            {
              key: "refresh",
              label: "刷新模型",
              icon: <ReloadOutlined />,
              onClick: () => void handleRefreshModels(record.id),
            },
            {
              key: "edit",
              label: "编辑",
              icon: <EditOutlined />,
              onClick: () => void openEditModal(record),
            },
            {
              key: "delete",
              danger: true,
              label: "删除",
              onClick: () => {
                Modal.confirm({
                  title: "删除 Provider",
                  content: `确定要删除「${record.name}」吗？此操作会移除本地配置（API Key 将从 Keychain 删除）。`,
                  okText: "删除",
                  okType: "danger",
                  cancelText: "取消",
                  onOk: () => handleDelete(record.id),
                });
              },
            },
          ].filter(Boolean) as Array<{
            key: string;
            label: string;
            icon?: ReactNode;
            danger?: boolean;
            onClick?: () => void;
          }>;

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

      <Modal
        title={editingProvider ? "编辑 Provider" : "添加 Provider"}
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
            extra="API Key 会保存在系统钥匙串（Keychain）。首次发送消息/刷新模型时，macOS 可能会弹窗请求授权访问。"
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
          <div style={{ marginTop: -10, marginBottom: 10, color: "var(--text-muted)", fontSize: 12 }}>
            提示：有些 OpenAI 兼容网关并不接受 Bearer 方式（例如需要{" "}
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
              x-goog-api-key
            </span>
            ），这时请选择对应类型。
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
