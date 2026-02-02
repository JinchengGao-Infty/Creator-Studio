import { describe, expect, test } from 'bun:test'
import { createEngine } from './index'

describe('ai-engine', () => {
  test('createEngine wires providerManager + agent', () => {
    const engine = createEngine()

    engine.providerManager.addProvider({
      id: 'test',
      name: 'Test Provider',
      baseURL: 'http://localhost:3000/v1',
      apiKey: 'test-key',
      models: [],
      providerType: 'openai-compatible',
    })

    expect(engine.providerManager.getProvider('test')?.name).toBe('Test Provider')
    expect(engine.agent).toBeTruthy()
  })
})

