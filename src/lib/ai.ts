import { invoke } from "@tauri-apps/api/core";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  base_url: string;
  models: string[];
  provider_type: string;
  headers?: Record<string, string> | null;
}

interface ModelParametersConfig {
  model: string;
  temperature: number;
  top_p: number;
  top_k: number | null;
  max_tokens: number;
}

interface GlobalConfig {
  providers: ProviderConfig[];
  active_provider_id: string | null;
  default_parameters: ModelParametersConfig;
}

export const DEFAULT_SYSTEM_PROMPT = `你是一个小说写作助手，同时你也可以在需要时使用工具操作项目文件。你可以使用以下工具：
- read: 读取文件内容
- write: 写入文件内容
- append: 追加内容到文件
- list: 列出目录下的文件
- search: 搜索文件内容

当用户要求你操作文件时，请使用相应的工具。`;

export async function getActiveChatConfig(): Promise<{
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
} | null> {
  try {
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
  } catch {
    return null;
  }
}

export async function aiChat(params: {
  projectDir: string;
  messages: ChatMessage[];
  systemPrompt?: string;
}): Promise<string> {
  const active = await getActiveChatConfig();
  if (!active) {
    throw new Error("请先在设置中添加 Provider，并设为当前，然后配置默认模型参数。");
  }

  const result = await invoke("ai_chat", {
    provider: active.provider,
    parameters: active.parameters,
    systemPrompt: params.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    messages: params.messages,
    projectDir: params.projectDir,
  });

  return String(result);
}

