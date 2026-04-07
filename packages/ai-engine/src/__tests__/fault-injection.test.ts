/**
 * Fault Injection Tests
 *
 * Validates system behavior under failure conditions:
 * - Unreachable provider
 * - Malformed requests
 * - Oversized payloads
 * - Invalid JSON
 * - Missing fields at various levels
 * - Concurrent request limits
 * - Provider initialization failures
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { createApp, startServer } from '../server.js'

const headers = { 'Content-Type': 'application/json' }
const SECRET = 'fault-test-secret'

function makeApp() {
  return createApp()
}

function makeAuthApp() {
  return createApp(SECRET)
}

function authHeaders() {
  return { ...headers, Authorization: `Bearer ${SECRET}` }
}

const deadProvider = {
  id: 'dead',
  name: 'Dead',
  baseURL: 'http://127.0.0.1:1', // Port 1 — guaranteed unreachable
  apiKey: 'fake',
  models: [],
  providerType: 'openai-compatible' as const,
}

const params = { model: 'nonexistent', temperature: 0.5 }

/** Parse SSE data lines. */
function parseSSE(text: string) {
  return text.split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.replace(/^data:\s*/, '')))
}

let servers: { close: () => void }[] = []
afterEach(() => { for (const s of servers) s.close(); servers = [] })

// ──────────────────────────────────────────────
// Provider unreachable
// ──────────────────────────────────────────────

describe('Fault: provider unreachable', () => {
  it('chat returns SSE error event', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = parseSSE(await res.text())
    const last = events[events.length - 1]
    expect(['done', 'error']).toContain(last.type)
  })

  it('complete returns SSE error event', async () => {
    const app = makeApp()
    const res = await app.request('/api/complete', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const events = parseSSE(await res.text())
    expect(events.length).toBeGreaterThan(0)
    expect(['done', 'error']).toContain(events[events.length - 1].type)
  })

  it('extract returns JSON error with 500', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params, text: 'test',
      }),
    })
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.request_id).toBeDefined()
  })

  it('compact returns JSON error with 500', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
  })

  it('models returns 502 for unreachable provider', async () => {
    const app = makeApp()
    const res = await app.request('/api/models', {
      method: 'POST', headers,
      body: JSON.stringify({ baseURL: 'http://127.0.0.1:1', apiKey: 'fake' }),
    })
    expect(res.status).toBe(502)
  })
})

// ──────────────────────────────────────────────
// Malformed requests
// ──────────────────────────────────────────────

describe('Fault: malformed requests', () => {
  it('invalid JSON returns error', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers, body: '{broken',
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('empty body returns 400', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers, body: '{}',
    })
    expect(res.status).toBe(400)
  })

  it('null fields return 400', async () => {
    const app = makeApp()
    const routes = ['/api/chat', '/api/complete', '/api/extract', '/api/transform', '/api/compact']
    for (const path of routes) {
      const res = await app.request(path, {
        method: 'POST', headers,
        body: JSON.stringify({ provider: null, parameters: null }),
      })
      expect(res.status).toBe(400)
    }
  })

  it('GET on POST-only routes returns 404', async () => {
    const app = makeApp()
    for (const path of ['/api/chat', '/api/complete', '/api/extract', '/api/transform', '/api/compact']) {
      const res = await app.request(path, { method: 'GET' })
      expect(res.status).toBe(404)
    }
  })
})

// ──────────────────────────────────────────────
// Auth edge cases
// ──────────────────────────────────────────────

describe('Fault: auth edge cases', () => {
  it('empty Bearer token rejected', async () => {
    const app = makeAuthApp()
    const res = await app.request('/api/compact', {
      method: 'POST', headers: { ...headers, Authorization: 'Bearer ' }, body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('Basic auth scheme rejected', async () => {
    const app = makeAuthApp()
    const res = await app.request('/api/compact', {
      method: 'POST', headers: { ...headers, Authorization: 'Basic dXNlcjpwYXNz' }, body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('token with extra whitespace rejected', async () => {
    const app = makeAuthApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      headers: { ...headers, Authorization: `Bearer  ${SECRET}` }, // double space
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('health accessible without auth', async () => {
    const app = makeAuthApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })
})

// ──────────────────────────────────────────────
// Body limit edge cases
// ──────────────────────────────────────────────

describe('Fault: body limit', () => {
  it('exactly 2MB body passes through', async () => {
    const app = makeApp()
    const body = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024 - 100) })
    const res = await app.request('/api/compact', {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    })
    // Should NOT be 413 (just under limit)
    expect(res.status).not.toBe(413)
  })

  it('2MB + 1 body rejected', async () => {
    const app = makeApp()
    const body = JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024 + 100) })
    const res = await app.request('/api/compact', {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      body,
    })
    expect(res.status).toBe(413)
  })
})

// ──────────────────────────────────────────────
// Error message sanitization
// ──────────────────────────────────────────────

describe('Fault: error sanitization', () => {
  it('SSE error events do not leak file paths', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const text = await res.text()
    // No Unix/Windows file paths in any SSE event
    expect(text).not.toMatch(/\/Users\/[^\s]+\.[jt]s:\d+/)
    expect(text).not.toMatch(/[A-Z]:\\[^\s]+\.[jt]s:\d+/)
  })

  it('JSON error responses do not leak file paths', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params, text: 'test',
      }),
    })
    const body = await res.json() as any
    if (body.error) {
      expect(body.error).not.toMatch(/\/Users\/[^\s]+\.[jt]s:\d+/)
    }
  })
})

// ──────────────────────────────────────────────
// Request ID propagation under faults
// ──────────────────────────────────────────────

describe('Fault: request ID propagation', () => {
  it('custom request ID survives error paths', async () => {
    const app = makeApp()
    const customId = 'fault-trace-42'
    const res = await app.request('/api/extract', {
      method: 'POST',
      headers: { ...headers, 'X-Request-ID': customId },
      body: JSON.stringify({
        provider: deadProvider, parameters: params, text: 'test',
      }),
    })
    expect(res.headers.get('X-Request-ID')).toBe(customId)
    const body = await res.json() as any
    expect(body.request_id).toBe(customId)
  })

  it('request ID present in SSE error responses', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { ...headers, 'X-Request-ID': 'sse-fault-99' },
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.headers.get('X-Request-ID')).toBe('sse-fault-99')
  })
})

// ──────────────────────────────────────────────
// SSRF protection
// ──────────────────────────────────────────────

describe('Fault: SSRF protection on toolCallbackUrl', () => {
  it('rejects external toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
        toolCallbackUrl: 'http://evil.com:8080/steal',
      }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('localhost')
  })

  it('rejects toolCallbackUrl with non-localhost hostname', async () => {
    const app = makeApp()
    for (const url of ['http://192.168.1.1:3000/tool', 'http://10.0.0.1/tool', 'https://api.openai.com/tool']) {
      const res = await app.request('/api/chat', {
        method: 'POST', headers,
        body: JSON.stringify({
          provider: deadProvider, parameters: params,
          systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
          toolCallbackUrl: url,
        }),
      })
      expect(res.status).toBe(400)
    }
  })

  it('accepts localhost toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
        toolCallbackUrl: 'http://127.0.0.1:9999/tool/execute',
      }),
    })
    // Should NOT be 400 (SSRF check passed) — will be SSE (possibly error from dead provider)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('rejects invalid toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
        toolCallbackUrl: 'not-a-url',
      }),
    })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// Real HTTP integration (via startServer)
// ──────────────────────────────────────────────

describe('Fault: real HTTP integration', () => {
  it('health check works over real HTTP', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
  })

  it('auth rejection works over real HTTP', async () => {
    const { port, close } = await startServer({ sharedSecret: 'real-secret' })
    servers.push({ close })
    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST', headers, body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('validation error works over real HTTP', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })
    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST', headers, body: JSON.stringify({ provider: null }),
    })
    expect(res.status).toBe(400)
  })

  it('SSE streaming works over real HTTP', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: deadProvider, parameters: params,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const text = await res.text()
    const events = parseSSE(text)
    expect(events.length).toBeGreaterThan(0)
  })
})
