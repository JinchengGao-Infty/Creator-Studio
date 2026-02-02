import { invoke } from "@tauri-apps/api/core";
import type { SessionMode } from "./sessions";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AIChatToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "calling" | "success" | "error";
  result?: string;
  error?: string;
  duration?: number;
}

export interface AIChatResult {
  content: string;
  tool_calls: AIChatToolCall[];
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

const DISCUSSION_SYSTEM_PROMPT_TEMPLATE = `你是一位专业的小说写作顾问 AI Agent。你的目标是帮助作者改进故事结构、人物弧光、节奏与文笔。你可以在需要时主动调用工具读取项目内容，但在讨论模式下不要修改任何文件。

## 可用工具
- list: 列出目录内容（例如 chapters/）
- read: 读取文件内容（例如 chapters/chapter_003.txt、chapters/index.json、.creatorai/config.json）
- search: 在文件或目录中搜索关键词（例如 summaries.json 或 chapters/）

## 项目结构（项目根目录：{projectPath}）
- chapters/ — 章节文件（chapter_001.txt, chapter_002.txt...）
- chapters/index.json — 章节索引（标题、顺序、字数）
- .creatorai/config.json — 项目配置
- summaries.json — 摘要记录（若存在）

## 工作方式
1. 当用户询问章节内容/风格/角色设定时，主动使用 read 读取相关章节；必要时先 read chapters/index.json 确认章节编号/标题
2. 当用户询问“之前有没有写过类似情节/关键词”时，使用 search 在 summaries.json 或 chapters/ 中搜索
3. 当用户没有指定章节时，先用 list 查看 chapters/ 或读取 chapters/index.json，再追问澄清
4. 给出建议时要具体，引用你读取到的内容（可以引用行号前缀）

## 注意
- 讨论模式下不要使用 write/append 修改文件；如用户要求改写，请给出建议与可直接复制的文本片段，但不要写回文件。`;

function systemPromptForMode(mode: SessionMode, projectDir: string): string {
  if (mode === "Discussion") {
    return DISCUSSION_SYSTEM_PROMPT_TEMPLATE.replace(/\{projectPath\}/g, projectDir);
  }
  return DEFAULT_SYSTEM_PROMPT;
}

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
  mode: SessionMode;
  systemPrompt?: string;
  chapterId?: string | null;
  allowWrite?: boolean;
}): Promise<{ content: string; toolCalls: AIChatToolCall[] }> {
  const active = await getActiveChatConfig();
  if (!active) {
    throw new Error("请先在设置中添加 Provider，并设为当前，然后配置默认模型参数。");
  }

  const result = (await invoke("ai_chat", {
    provider: active.provider,
    parameters: active.parameters,
    systemPrompt: params.systemPrompt ?? systemPromptForMode(params.mode, params.projectDir),
    messages: params.messages,
    projectDir: params.projectDir,
    mode: params.mode,
    chapterId: params.chapterId ?? null,
    allowWrite: params.allowWrite ?? false,
  })) as AIChatResult;

  return {
    content: result.content ?? "",
    toolCalls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
  };
}
