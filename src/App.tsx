import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, Input, Spin, message } from "antd";

export default function App() {
  const { TextArea } = Input;

  // 测试配置
  const TEST_PROVIDER = {
    id: "gemini",
    name: "Gemini",
    baseURL: "http://127.0.0.1:3002/v1",
    apiKey: "sk-XnbHbzBOmPYGHgL_4Mg8zRcoBIb2gVpJiuO0eSifyyCUV2Twz2c4SljcNCo",
    models: ["gemini-3-flash"],
    providerType: "openai-compatible",
  } as const;

  const TEST_PARAMETERS = {
    model: "gemini-3-flash",
    temperature: 0.7,
    maxTokens: 2000,
  } as const;

  const SYSTEM_PROMPT = `你是一个文件助手。你可以使用以下工具：
- read: 读取文件内容
- write: 写入文件内容
- append: 追加内容到文件
- list: 列出目录下的文件
- search: 搜索文件内容

当用户要求你操作文件时，请使用相应的工具。`;

  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [projectDir, setProjectDir] = useState("/Users/link/Desktop/creatorai-v2");

  const handleSend = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setOutput("");

    try {
      const result = await invoke("ai_chat", {
        provider: TEST_PROVIDER,
        parameters: TEST_PARAMETERS,
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: "user", content: input }],
        projectDir,
      });

      setOutput(String(result));
      message.success("AI 响应成功");
    } catch (error) {
      setOutput(`错误: ${String(error)}`);
      message.error(`调用失败: ${String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>CreatorAI - T1.6 集成测试</h1>

      <Card title="项目目录" style={{ marginBottom: 16 }}>
        <Input
          value={projectDir}
          onChange={(e) => setProjectDir(e.target.value)}
          placeholder="项目目录路径"
        />
      </Card>

      <Card title="测试用例" style={{ marginBottom: 16 }}>
        <p>试试这些命令：</p>
        <ul>
          <li>
            <code>列出当前目录的文件</code>
          </li>
          <li>
            <code>读取 README.md 文件</code>
          </li>
          <li>
            <code>创建一个 test.txt 文件，内容是 "Hello CreatorAI"</code>
          </li>
          <li>
            <code>在 test.txt 末尾追加一行 "这是追加的内容"</code>
          </li>
          <li>
            <code>搜索包含 "tauri" 的文件</code>
          </li>
          <li>
            <code>读取 /etc/passwd 文件</code>
          </li>
        </ul>
      </Card>

      <Card title="输入" style={{ marginBottom: 16 }}>
        <TextArea
          rows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入你的指令..."
          onPressEnter={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          type="primary"
          onClick={() => void handleSend()}
          loading={loading}
          style={{ marginTop: 8 }}
        >
          发送 (Ctrl+Enter)
        </Button>
      </Card>

      <Card title="输出">
        {loading ? (
          <Spin tip="AI 正在思考..." />
        ) : (
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {output || "等待输入..."}
          </pre>
        )}
      </Card>
    </div>
  );
}
