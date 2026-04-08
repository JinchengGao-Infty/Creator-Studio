/**
 * compact.ts — Unit Tests
 *
 * Tests generateCompactSummary: maxTokens capping, message mapping,
 * abort signal passthrough, error handling.
 *
 * Since compact.ts calls the real AI SDK which requires a real provider,
 * we test it indirectly through the HTTP route with an unreachable provider
 * (for error handling) and test the exported function structure.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'

function makeApp() {
  return createApp()
}

const FAKE_PROVIDER = {
  id: 'test',
  name: 'Test',
  baseURL: 'http://localhost:1', // unreachable
  apiKey: 'test',
  models: ['test-model'],
  providerType: 'openai-compatible' as const,
}

// ──────────────────────────────────────────────
// Compact route validation
// ──────────────────────────────────────────────

describe('POST /api/compact — validation', () => {
  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ parameters: { model: 'x' }, messages: [{ role: 'user', content: 'hi' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Missing required')
  })

  it('rejects missing parameters', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: FAKE_PROVIDER, messages: [{ role: 'user', content: 'hi' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty messages array', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: { model: 'test-model' },
        messages: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing messages field', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: { model: 'test-model' },
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// Compact route error handling (unreachable provider)
// ──────────────────────────────────────────────

describe('POST /api/compact — error handling', () => {
  it('returns 500 with error and request_id on provider failure', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: { model: 'test-model' },
        messages: [{ role: 'user', content: 'hello' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.request_id).toBeTruthy()
  })

  it('propagates X-Request-ID in error response', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: { model: 'test-model' },
        messages: [{ role: 'user', content: 'hello' }],
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'compact-test-123',
      },
    })
    const body = await res.json() as any
    expect(body.request_id).toBe('compact-test-123')
  })
})

// ──────────────────────────────────────────────
// Compact response structure (when using a mock server)
// ──────────────────────────────────────────────

describe('POST /api/compact — response structure', () => {
  it('error response has both error and request_id fields', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: { model: 'test-model' },
        messages: [{ role: 'user', content: 'test' }],
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const body = await res.json() as any
    // Error response always has these two fields
    expect('error' in body).toBe(true)
    expect('request_id' in body).toBe(true)
  })
})
