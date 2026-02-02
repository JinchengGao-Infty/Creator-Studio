export * from './types'
export * from './provider'
export * from './tools'
export * from './agent'
export * from './models'

import { Agent } from './agent'
import { ProviderManager } from './provider'

// 便捷函数
export function createEngine() {
  const providerManager = new ProviderManager()
  const agent = new Agent(providerManager)

  return {
    providerManager,
    agent,
  }
}
