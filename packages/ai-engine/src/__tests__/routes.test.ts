/**
 * Route-specific Tests
 *
 * Tests validation, response format, and error handling for each route.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'

function makeApp() {
  return createApp() // No auth
}

const validProvider = {
  id: 'test',
  name: 'Test',
  baseURL: 'http://localhost:99999',
  apiKey: 'test-key',
  models: [],
  providerType: 'openai-compatible' as const,
}

const validParams = { model: 'test-model', temperature: 0.7, maxTokens: 100 }
const headers = { 'Content-Type': 'application/json' }

// ──────────────────────────────────────────────
// Transform route
// ──────────────────────────────────────────────

describe('POST /api/transform', () => {
  it('rejects missing text', async () => {
    const app = makeApp()
    const res = await app.request('/api/transform', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: validProvider, parameters: validParams }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Missing required fields')
  })

  it('returns SSE for valid request', async () => {
    const app = makeApp()
    const res = await app.request('/api/transform', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: validProvider,
        parameters: validParams,
        text: '天色渐暗，远处的山峦在暮色中模糊了轮廓。',
        action: 'polish',
      }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('accepts all transform actions', async () => {
    const app = makeApp()
    for (const action of ['polish', 'expand', 'condense', 'restyle']) {
      const res = await app.request('/api/transform', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: validProvider,
          parameters: validParams,
          text: '测试文本',
          action,
          style: action === 'restyle' ? '武侠' : undefined,
        }),
      })
      // Should be SSE (not 400 or 500)
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    }
  })

  it('SSE contains done or error event', async () => {
    const app = makeApp()
    const res = await app.request('/api/transform', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: validProvider,
        parameters: validParams,
        text: '短文本',
      }),
    })
    const text = await res.text()
    expect(text.includes('"type":"done"') || text.includes('"type":"error"')).toBe(true)
  })
})

// ──────────────────────────────────────────────
// Extract route
// ──────────────────────────────────────────────

describe('POST /api/extract', () => {
  it('rejects missing text', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: validProvider, parameters: validParams }),
    })
    expect(res.status).toBe(400)
  })

  it('returns JSON (not SSE) for valid request', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: validProvider,
        parameters: validParams,
        text: '张三和李四是好朋友，他们一起在少林寺学武。',
      }),
    })
    // Extract returns JSON, not SSE
    const ct = res.headers.get('content-type') ?? ''
    expect(ct).toContain('application/json')
  })

  it('returns structured result or error', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        provider: validProvider,
        parameters: validParams,
        text: '测试提取',
      }),
    })
    const body = await res.json() as any
    // Should have either extract_result or error
    expect(body.type === 'extract_result' || body.error).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// Models route
// ──────────────────────────────────────────────

describe('POST /api/models', () => {
  it('rejects missing baseURL', async () => {
    const app = makeApp()
    const res = await app.request('/api/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({ apiKey: 'test' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing apiKey', async () => {
    const app = makeApp()
    const res = await app.request('/api/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseURL: 'http://localhost' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 502 when provider is unreachable', async () => {
    const app = makeApp()
    const res = await app.request('/api/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        baseURL: 'http://localhost:99999',
        apiKey: 'test',
        providerType: 'openai-compatible',
      }),
    })
    expect(res.status).toBe(502)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })
})

// ──────────────────────────────────────────────
// Compact route (deeper tests)
// ──────────────────────────────────────────────

describe('POST /api/compact - deep validation', () => {
  it('returns JSON with request_id', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      headers: { ...headers, 'X-Request-ID': 'compact-test-1' },
      body: JSON.stringify({
        provider: validProvider,
        parameters: validParams,
        messages: [
          { role: 'user', content: '第一条消息' },
          { role: 'assistant', content: '收到' },
        ],
      }),
    })
    // Will fail due to unreachable provider, but should return error JSON
    const body = await res.json() as any
    // Either success with content or error with request_id
    expect(body.request_id === 'compact-test-1' || body.error).toBeTruthy()
  })
})
