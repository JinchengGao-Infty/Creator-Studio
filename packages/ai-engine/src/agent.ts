import { generateText } from 'ai'
import type { AgentResult, Message, ModelParameters, ToolCallRequest, ToolCallResult } from './types'
import { ProviderManager } from './provider'
import { getToolsForSDK } from './tools'

export interface AgentContext {
  providerId: string
  parameters: ModelParameters
  systemPrompt: string
  // Tool 执行回调（由外部提供，实际执行在 Tauri）
  executeTools: (calls: ToolCallRequest[]) => Promise<ToolCallResult[]>
  // 中断信号
  abortSignal?: AbortSignal
}

export class Agent {
  private providerManager: ProviderManager

  constructor(providerManager: ProviderManager) {
    this.providerManager = providerManager
  }

  // 运行 Agent
  async run(messages: Message[], context: AgentContext): Promise<AgentResult> {
    const provider = this.providerManager.getProvider(context.providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${context.providerId}`)
    }

    if (provider.models.length > 0 && !provider.models.includes(context.parameters.model)) {
      throw new Error(
        `Model not allowed by provider (${context.providerId}): ${context.parameters.model}`,
      )
    }

    const sdk = this.providerManager.createSDK(context.providerId)
    const model = sdk(context.parameters.model)

    const allMessages = [
      { role: 'system' as const, content: context.systemPrompt },
      ...messages.map((m) => ({
        role: m.role as any,
        content: m.content,
        toolCallId: m.toolCallId,
      })),
    ]

    // 使用 Vercel AI SDK 的 generateText
    // 设置 maxSteps 让 SDK 自动处理多轮 tool calling
    const result = await generateText({
      model,
      messages: allMessages as any,
      tools: getToolsForSDK(context.executeTools) as any,
      maxSteps: 10,
      abortSignal: context.abortSignal,
      temperature: context.parameters.temperature,
      topP: context.parameters.topP,
      maxTokens: context.parameters.maxTokens,
    } as any)

    const toolCalls = (result as any).toolCalls as any[] | undefined

    return {
      content: (result as any).text ?? '',
      toolCalls: toolCalls?.map(
        (call): ToolCallRequest => ({
          id: call.toolCallId ?? call.id,
          name: call.toolName ?? call.name,
          args: call.args ?? call.arguments ?? {},
        }),
      ),
    }
  }
}
