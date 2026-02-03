import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { ProviderConfig } from './types'

function buildAuthHeaders(providerType: ProviderConfig['providerType'], apiKey: string) {
  const key = apiKey ?? ''
  if (!key) return {}

  switch (providerType) {
    case 'google':
      return { 'x-goog-api-key': key }
    case 'anthropic':
      return { 'x-api-key': key }
    default:
      return {}
  }
}

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

    // We use the OpenAI-compatible protocol for all providers here,
    // but some providers expect different auth headers.
    const authHeaders = buildAuthHeaders(provider.providerType, provider.apiKey)
    const mergedHeaders = { ...authHeaders, ...(provider.headers ?? {}) }

    return createOpenAICompatible({
      baseURL: provider.baseURL,
      name: provider.name,
      // For Google/Anthropic, omit apiKey to avoid sending `Authorization: Bearer ...`
      // (some gateways treat Bearer tokens differently and may require browser verification).
      apiKey: provider.providerType === 'openai-compatible' ? provider.apiKey : undefined,
      headers: mergedHeaders,
    })
  }
}
