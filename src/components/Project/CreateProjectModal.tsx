import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Form, Input, Modal, message } from "antd";

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
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择保存位置",
      });
      if (typeof selected === "string" && selected.trim()) {
        form.setFieldValue("path", selected);
      }
    } catch (error) {
      message.error(`选择失败: ${String(error)}`);
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
            placeholder="选择文件夹"
            enterButton="选择"
            onSearch={() => void handleSelectPath()}
            readOnly
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

