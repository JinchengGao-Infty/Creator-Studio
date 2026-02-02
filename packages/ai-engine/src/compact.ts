import { generateText } from 'ai'
import type { Message, ModelParameters, ProviderConfig } from './types'
import { ProviderManager } from './provider'

const COMPACT_SYSTEM_PROMPT = `你是一个“会话上下文压缩”助手。你的目标是把一段较长的历史对话压缩成一段可继续对话的摘要。

要求：
- 只总结对话中已经明确出现的信息，不要编造。
- 保留关键人物、设定、约束、用户偏好、已达成的结论、未解决的问题。
- 保持尽量精炼，方便继续对话。
- 输出使用中文（除非原对话主要是英文）。

请严格按以下格式输出（不要添加多余标题）：

[会话摘要]

讨论要点：
- ...

决定事项：
- ...

上下文：
- ...`

export async function generateCompactSummary(params: {
  provider: ProviderConfig
  parameters: ModelParameters
  messages: Message[]
}): Promise<string> {
  const providerManager = new ProviderManager()
  providerManager.addProvider(params.provider)

  const sdk = providerManager.createSDK(params.provider.id)
  const model = sdk(params.parameters.model)

  const summaryMaxTokens =
    typeof params.parameters.maxTokens === 'number' ? Math.min(params.parameters.maxTokens, 800) : 800

  const result = await generateText({
    model,
    messages: [
      { role: 'system', content: COMPACT_SYSTEM_PROMPT },
      ...params.messages.map((m) => ({ role: m.role, content: m.content, toolCallId: m.toolCallId })),
    ] as any,
    maxSteps: 1,
    temperature: 0.2,
    topP: 1,
    maxTokens: summaryMaxTokens,
  } as any)

  return ((result as any).text ?? '').trim()
}

