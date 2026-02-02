import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, Input, Spin, Tabs, message } from "antd";
import { SettingsPanel } from "./components/Settings";

interface Provider {
  id: string;
  name: string;
  base_url: string;
  models: string[];
  provider_type: string;
  headers?: Record<string, string> | null;
}

interface ModelParameters {
  model: string;
  temperature: number;
  top_p: number;
  top_k: number | null;
  max_tokens: number;
}

interface GlobalConfig {
  providers: Provider[];
  active_provider_id: string | null;
  default_parameters: ModelParameters;
}

async function getActiveChatConfig(): Promise<
  | {
      provider: {
        id: string;
        name: string;
        baseURL: string;
        apiKey: string;
        models: string[];
        providerType: string;
        headers?: Record<string, string>;
      };
      parameters: {
        model: string;
        temperature?: number;
        topP?: number;
        topK?: number;
        maxTokens?: number;
      };
    }
  | null
> {
  const config = (await invoke("get_config")) as GlobalConfig;
  if (!config.active_provider_id) return null;

  const activeProvider = config.providers.find((p) => p.id === config.active_provider_id);
  if (!activeProvider) return null;

  const apiKey = (await invoke("get_api_key", {
    providerId: activeProvider.id,
  })) as string | null;
  if (!apiKey) return null;

  return {
    provider: {
      id: activeProvider.id,
      name: activeProvider.name,
      baseURL: activeProvider.base_url,
      apiKey,
      models: activeProvider.models || [],
      providerType: activeProvider.provider_type,
      headers: activeProvider.headers ?? undefined,
    },
    parameters: {
      model: config.default_parameters.model,
      temperature: config.default_parameters.temperature,
      topP: config.default_parameters.top_p,
      topK: config.default_parameters.top_k ?? undefined,
      maxTokens: config.default_parameters.max_tokens,
    },
  };
}

function TestPanel() {
  const { TextArea } = Input;

  const TEST_PROVIDER = {
    id: "gemini",
    name: "Gemini",
    baseURL: "http://127.0.0.1:3002/geminicli/v1",
    apiKey: "sk-XnbHbzBOmPYGHgL_4Mg8zRcoBIb2gVpJiuO0eSifyyCUV2Twz2c4SljcNCo",
    models: ["gemini-3-flash-preview"],
    providerType: "openai-compatible",
  } as const;

  const TEST_PARAMETERS = {
    model: "gemini-3-flash-preview",
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
  const [activeProviderLabel, setActiveProviderLabel] = useState<string | null>(null);
  const [activeModelLabel, setActiveModelLabel] = useState<string | null>(null);

  const handleSend = async () => {
    if (!input.trim()) return;

    setLoading(true);
    setOutput("");

    try {
      const active = await getActiveChatConfig();
      const provider = active?.provider ?? TEST_PROVIDER;
      const parameters = active?.parameters ?? TEST_PARAMETERS;

      setActiveProviderLabel(active ? provider.name : null);
      setActiveModelLabel(active ? parameters.model : null);

      const result = await invoke("ai_chat", {
        provider,
        parameters,
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
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <h1>CreatorAI - 集成测试</h1>

      <Card title="当前配置" style={{ marginBottom: 16 }}>
        <div>
          Provider：{activeProviderLabel ?? "未从设置读取（使用内置测试 Provider）"}
        </div>
        <div>Model：{activeModelLabel ?? "未从设置读取（使用内置测试参数）"}</div>
      </Card>

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

export default function App() {
  const [activeTab, setActiveTab] = useState("test");

  return (
    <div style={{ padding: 24 }}>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "test",
            label: "测试",
            children: <TestPanel />,
          },
          {
            key: "settings",
            label: "设置",
            children: <SettingsPanel />,
          },
        ]}
      />
    </div>
  );
}
