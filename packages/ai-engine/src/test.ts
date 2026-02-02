import { createEngine } from './index'

const engine = createEngine()

// 添加测试 Provider
engine.providerManager.addProvider({
  id: 'test',
  name: 'Test Provider',
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'test-key',
  models: ['test-model'],
  providerType: 'openai-compatible',
})

console.log('Providers:', engine.providerManager.listProviders())
console.log('ai-engine 包创建成功！')

