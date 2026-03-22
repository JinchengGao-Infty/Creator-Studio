import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Form, Input, Modal, message } from "antd";
import { formatError } from "../../utils/error";

interface CreateProjectModalProps {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string, parentPath: string) => void;
}

export default function CreateProjectModal({ visible, onCancel, onCreate }: CreateProjectModalProps) {
  const [form] = Form.useForm<{ name: string; path: string }>();

  useEffect(() => {
    if (!visible) form.resetFields();
  }, [visible, form]);

  const handleSelectPath = async () => {
    try {
      // 安全地检测是否在 Tauri 环境中
      let isTauriEnv = false;
      try {
        isTauriEnv = isTauri();
      } catch (error) {
        isTauriEnv = false;
      }
      
      if (isTauriEnv) {
        const selected = await open({
          directory: true,
          multiple: false,
          title: "选择保存位置",
        });
        if (typeof selected === "string" && selected.trim()) {
          form.setFieldValue("path", selected);
        }
      } else {
        // 在浏览器环境中，提示用户手动输入路径
        message.info("当前为 Web 环境，请手动输入项目保存路径");
        // 可以考虑使用浏览器的文件夹选择（但浏览器不支持直接选择文件夹）
        // 这里让用户手动输入路径
      }
    } catch (error) {
      message.error(`选择失败: ${formatError(error)}`);
    }
  };

  return (
    <Modal
      title="新建项目"
      open={visible}
      onCancel={onCancel}
      onOk={() => void form.submit()}
      okText="创建"
      cancelText="取消"
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={({ name, path }) => onCreate(name.trim(), path.trim())}
      >
        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, message: "请输入项目名称" }]}
        >
          <Input placeholder="我的小说" autoFocus />
        </Form.Item>
        <Form.Item
          name="path"
          label="保存位置"
          rules={[{ required: true, message: "请选择保存位置" }]}
        >
          <Input.Search
            placeholder="选择文件夹或手动输入路径"
            enterButton="选择"
            onSearch={() => void handleSelectPath()}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
