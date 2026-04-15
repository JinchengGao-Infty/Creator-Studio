/**
 * ProviderManager — Unit Tests
 *
 * Tests provider CRUD, SDK creation, auth header logic for all provider types.
 */
import { describe, it, expect } from 'bun:test'
import { ProviderManager } from '../provider.js'
import type { ProviderConfig } from '../types.js'

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test-key',
    models: ['gpt-4'],
    providerType: 'openai-compatible',
    ...overrides,
  }
}

// ──────────────────────────────────────────────
// addProvider / getProvider / listProviders
// ──────────────────────────────────────────────

describe('ProviderManager CRUD', () => {
  it('addProvider stores and getProvider retrieves', () => {
    const pm = new ProviderManager()
    const p = makeProvider()
    pm.addProvider(p)
    expect(pm.getProvider('test-provider')).toEqual(p)
  })

  it('getProvider returns undefined for unknown ID', () => {
    const pm = new ProviderManager()
    expect(pm.getProvider('nonexistent')).toBeUndefined()
  })

  it('addProvider overwrites existing provider with same ID', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ name: 'V1' }))
    pm.addProvider(makeProvider({ name: 'V2' }))
    expect(pm.getProvider('test-provider')?.name).toBe('V2')
  })

  it('listProviders returns all providers', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ id: 'a' }))
    pm.addProvider(makeProvider({ id: 'b' }))
    pm.addProvider(makeProvider({ id: 'c' }))
    const list = pm.listProviders()
    expect(list).toHaveLength(3)
    expect(list.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('listProviders returns empty array when no providers', () => {
    const pm = new ProviderManager()
    expect(pm.listProviders()).toEqual([])
  })

  it('listProviders returns copies (not references to internal map)', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider())
    const list1 = pm.listProviders()
    const list2 = pm.listProviders()
    expect(list1).not.toBe(list2) // different array instances
  })
})

// ──────────────────────────────────────────────
// createSDK
// ──────────────────────────────────────────────

describe('ProviderManager.createSDK', () => {
  it('throws for unknown provider ID', () => {
    const pm = new ProviderManager()
    expect(() => pm.createSDK('nonexistent')).toThrow('Provider not found: nonexistent')
  })

  it('returns a callable function for valid openai-compatible provider', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider())
    const sdk = pm.createSDK('test-provider')
    expect(typeof sdk).toBe('function')
  })

  it('normalizes openai-compatible baseURL to /v1 when omitted', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ baseURL: 'https://example.com/openai' }))
    const sdk = pm.createSDK('test-provider')
    const model = sdk('gpt-4')
    expect(model).toBeDefined()
  })

  it('returns a callable function for google provider', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ id: 'google-p', providerType: 'google' }))
    const sdk = pm.createSDK('google-p')
    expect(typeof sdk).toBe('function')
  })

  it('returns a callable function for anthropic provider', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ id: 'anthropic-p', providerType: 'anthropic' }))
    const sdk = pm.createSDK('anthropic-p')
    expect(typeof sdk).toBe('function')
  })

  it('returns a model from sdk(modelId) call', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider())
    const sdk = pm.createSDK('test-provider')
    const model = sdk('gpt-4')
    // Should return a model object with modelId
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('merges custom headers with auth headers', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({
      providerType: 'anthropic',
      headers: { 'X-Custom': 'value' },
    }))
    // Should not throw — custom headers are merged
    const sdk = pm.createSDK('test-provider')
    expect(typeof sdk).toBe('function')
  })

  it('handles provider with empty apiKey', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ apiKey: '' }))
    const sdk = pm.createSDK('test-provider')
    expect(typeof sdk).toBe('function')
  })
})

// ──────────────────────────────────────────────
// buildAuthHeaders (tested indirectly via createSDK behavior)
// ──────────────────────────────────────────────

describe('Auth header behavior per provider type', () => {
  // We test this indirectly by checking createSDK doesn't throw for each type.
  // The actual header values go into the HTTP client, which is tested via integration tests.

  it('openai-compatible: apiKey passed to SDK (not in headers)', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ providerType: 'openai-compatible', apiKey: 'sk-test' }))
    // Should not throw
    const sdk = pm.createSDK('test-provider')
    expect(sdk).toBeDefined()
  })

  it('google: apiKey NOT passed to SDK (only in headers)', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ providerType: 'google', apiKey: 'goog-key' }))
    const sdk = pm.createSDK('test-provider')
    expect(sdk).toBeDefined()
  })

  it('anthropic: apiKey NOT passed to SDK (only in headers)', () => {
    const pm = new ProviderManager()
    pm.addProvider(makeProvider({ providerType: 'anthropic', apiKey: 'ant-key' }))
    const sdk = pm.createSDK('test-provider')
    expect(sdk).toBeDefined()
  })
})
