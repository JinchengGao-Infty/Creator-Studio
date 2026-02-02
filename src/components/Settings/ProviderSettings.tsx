import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ColumnsType } from "antd/es/table";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
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
        await invoke("update_provider", {
          provider: {
            id: editingProvider.id,
            name: values.name,
            base_url: values.base_url,
            models: editingProvider.models,
            models_updated_at: editingProvider.models_updated_at,
            provider_type: values.provider_type,
            headers: editingProvider.headers ?? null,
          },
          apiKey: values.api_key?.trim() ? values.api_key.trim() : null,
        });
        message.success("更新成功");
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
        message.success("添加成功");
      }

      setModalVisible(false);
      form.resetFields();
      setEditingProvider(null);
      void loadProviders();
    } catch (error) {
      message.error(`操作失败: ${formatError(error)}`);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await invoke("delete_provider", { providerId: id });
      message.success("删除成功");
      void loadProviders();
    } catch (error) {
      message.error(`删除失败: ${formatError(error)}`);
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      await invoke("set_active_provider", { providerId: id });
      message.success("已设置为当前 Provider");
      void loadProviders();
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

  const columns: ColumnsType<Provider> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (name: string, record) => (
        <Space>
          {name}
          {record.id === activeProviderId && <Tag color="green">当前</Tag>}
        </Space>
      ),
    },
    {
      title: "Base URL",
      dataIndex: "base_url",
      key: "base_url",
      ellipsis: true,
    },
    {
      title: "模型数",
      dataIndex: "models",
      key: "models",
      render: (models: string[] | undefined) => models?.length || 0,
    },
    {
      title: "操作",
      key: "action",
      render: (_: unknown, record) => (
        <Space>
          {record.id !== activeProviderId && (
            <Button size="small" onClick={() => void handleSetActive(record.id)}>
              设为当前
            </Button>
          )}
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => void handleRefreshModels(record.id)}
          >
            刷新模型
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => void openEditModal(record)}
          />
          <Popconfirm title="确定删除？" onConfirm={() => void handleDelete(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="Provider 管理"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditingProvider(null);
            form.resetFields();
            setModalVisible(true);
          }}
        >
          添加 Provider
        </Button>
      }
    >
      <Table
        dataSource={providers}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
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
          >
            <Input.Password
              placeholder={editingProvider ? "留空则不修改" : "请输入 API Key"}
            />
          </Form.Item>
          <Form.Item name="provider_type" label="Provider 类型" initialValue="openai-compatible">
            <Select>
              <Select.Option value="openai-compatible">OpenAI Compatible</Select.Option>
              <Select.Option value="google">Google</Select.Option>
              <Select.Option value="anthropic">Anthropic</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
