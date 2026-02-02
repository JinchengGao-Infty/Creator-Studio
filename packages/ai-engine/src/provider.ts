import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ProviderConfig } from './types'

export class ProviderManager {
  private providers: Map<string, ProviderConfig> = new Map()

  // 添加 Provider
  addProvider(config: ProviderConfig): void {
    this.providers.set(config.id, config)
  }

  // 获取 Provider
  getProvider(id: string): ProviderConfig | undefined {
    return this.providers.get(id)
  }

  // 列出所有 Provider
  listProviders(): ProviderConfig[] {
    return [...this.providers.values()]
  }

  // 创建 AI SDK 实例
  createSDK(providerId: string): ReturnType<typeof createOpenAICompatible> {
    const provider = this.providers.get(providerId)
    if (!provider) {
      throw new Error(`Provider not found: ${providerId}`)
    }

    if (provider.providerType !== 'openai-compatible') {
      throw new Error(`Provider type not supported: ${provider.providerType}`)
    }

    return createOpenAICompatible({
      baseURL: provider.baseURL,
      apiKey: provider.apiKey,
      headers: provider.headers,
    })
  }
}
