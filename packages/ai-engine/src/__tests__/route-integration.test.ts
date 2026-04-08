/**
 * Route-level Integration Tests
 *
 * Tests route behavior beyond basic validation — action handling,
 * response structure, SSE format, edge cases for each route.
 * Uses createApp() with no auth for direct route testing.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'

function makeApp() {
  return createApp() // no auth for simplicity
}

const FAKE_PROVIDER = {
  id: 'test',
  name: 'Test',
  baseURL: 'http://localhost:1', // unreachable — we test error handling
  apiKey: 'test',
  models: ['test-model'],
  providerType: 'openai-compatible',
}

const VALID_PARAMS = { model: 'test-model' }

function postJSON(app: ReturnType<typeof makeApp>, path: string, body: unknown) {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ──────────────────────────────────────────────
// Transform route
// ──────────────────────────────────────────────

describe('POST /api/transform', () => {
  it('rejects missing text', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Missing required')
  })

  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      parameters: VALID_PARAMS,
      text: 'hello',
    })
    expect(res.status).toBe(400)
  })

  it('returns SSE content-type for valid request', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'Some text to polish',
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('defaults to polish action when not specified', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'hello',
    })
    // Should return SSE (not 400), even without action field
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('accepts all valid actions', async () => {
    // Use separate app per action to avoid concurrency limiter exhaustion
    for (const action of ['polish', 'expand', 'condense', 'restyle']) {
      const app = makeApp()
      const res = await postJSON(app, '/api/transform', {
        provider: FAKE_PROVIDER,
        parameters: VALID_PARAMS,
        text: 'hello',
        action,
      })
      // Consume response body to release concurrency slot
      await res.text()
      const ct = res.headers.get('content-type')
      expect(ct).toContain('text/event-stream')
    }
  })

  it('falls back to polish for unknown action', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'hello',
      action: 'nonexistent-action',
    })
    // Should not 400 — falls back to polish
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('SSE stream ends with done or error event', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/transform', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'hello',
    })
    const text = await res.text()
    const events = text.split('\n')
      .filter((l: string) => l.startsWith('data:'))
      .map((l: string) => {
        try { return JSON.parse(l.replace(/^data:\s*/, '')) }
        catch { return null }
      })
      .filter(Boolean)

    // Stream must end with either done or error
    const lastEvent = events[events.length - 1]
    expect(['done', 'error']).toContain(lastEvent.type)
    if (lastEvent.type === 'done') {
      expect('content' in lastEvent).toBe(true)
    } else {
      expect(lastEvent.message).toBeTruthy()
    }
  })
})

// ──────────────────────────────────────────────
// Extract route
// ──────────────────────────────────────────────

describe('POST /api/extract', () => {
  it('rejects missing text', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/extract', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Missing required')
  })

  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/extract', {
      parameters: VALID_PARAMS,
      text: 'hello',
    })
    expect(res.status).toBe(400)
  })

  it('returns JSON (not SSE) for valid request', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/extract', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'The hero fought the dragon.',
    })
    // Extract returns JSON, even on error
    const ct = res.headers.get('content-type')
    expect(ct).toContain('application/json')
  })

  it('returns 500 with error and request_id on provider failure', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/extract', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      text: 'test text',
    })
    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.request_id).toBeTruthy()
  })

  it('propagates X-Request-ID in extract response', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: JSON.stringify({
        provider: FAKE_PROVIDER,
        parameters: VALID_PARAMS,
        text: 'test text',
      }),
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'extract-test-42',
      },
    })
    const body = await res.json() as any
    expect(body.request_id).toBe('extract-test-42')
  })
})

// ──────────────────────────────────────────────
// Models route
// ──────────────────────────────────────────────

describe('POST /api/models', () => {
  it('rejects missing baseURL', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/models', {
      apiKey: 'test',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Missing required')
  })

  it('rejects missing apiKey', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/models', {
      baseURL: 'http://localhost:1/v1',
    })
    expect(res.status).toBe(400)
  })

  it('returns 502 on unreachable provider', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/models', {
      baseURL: 'http://localhost:1/v1',
      apiKey: 'test',
    })
    expect(res.status).toBe(502)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.request_id).toBeTruthy()
  })

  it('returns 502 with request_id propagated', async () => {
    const app = makeApp()
    const res = await app.request('/api/models', {
      method: 'POST',
      body: JSON.stringify({ baseURL: 'http://localhost:1/v1', apiKey: 'test' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': 'models-test-99',
      },
    })
    const body = await res.json() as any
    expect(body.request_id).toBe('models-test-99')
  })

  it('successful model fetch from mock server', async () => {
    const mockServer = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === '/v1/models') {
          return Response.json({
            data: [
              { id: 'model-alpha' },
              { id: 'model-beta' },
            ],
            object: 'list',
          })
        }
        return new Response('Not Found', { status: 404 })
      },
    })

    try {
      const app = makeApp()
      const res = await postJSON(app, '/api/models', {
        baseURL: `http://127.0.0.1:${mockServer.port}/v1`,
        apiKey: 'test',
      })
      expect(res.status).toBe(200)
      const body = await res.json() as any
      expect(body.type).toBe('models_result')
      expect(body.models).toContain('model-alpha')
      expect(body.models).toContain('model-beta')
      expect(body.request_id).toBeTruthy()
    } finally {
      mockServer.stop(true)
    }
  })
})

// ──────────────────────────────────────────────
// Chat route
// ──────────────────────────────────────────────

describe('POST /api/chat', () => {
  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing systemPrompt', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing messages', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
    })
    expect(res.status).toBe(400)
  })

  it('rejects non-array messages (prevents .map() crash)', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: 'not-an-array', // truthy but not Array
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('array')
  })

  it('rejects object messages (prevents .map() crash)', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: { role: 'user', content: 'hi' }, // truthy object but not array
    })
    expect(res.status).toBe(400)
  })

  it('returns SSE for valid chat request', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('rejects non-localhost toolCallbackUrl (SSRF)', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      toolCallbackUrl: 'http://evil.com/callback',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('localhost')
  })

  it('rejects toolCallbackUrl with internal IP', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      toolCallbackUrl: 'http://10.0.0.1/callback',
    })
    expect(res.status).toBe(400)
  })

  it('rejects invalid toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      toolCallbackUrl: 'not-a-url',
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('Invalid toolCallbackUrl')
  })

  it('accepts localhost toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      toolCallbackUrl: 'http://localhost:3456/tools',
    })
    // Should pass validation → gets SSE (not 400)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('accepts 127.0.0.1 toolCallbackUrl', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      toolCallbackUrl: 'http://127.0.0.1:3456/tools',
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('invalid toolCallbackUrl does not leak concurrency slot', async () => {
    // Regression test: invalid toolCallbackUrl should be validated BEFORE
    // acquiring a concurrency slot. Otherwise, repeated invalid URLs can
    // exhaust the concurrency limiter (3 slots) permanently.
    const app = makeApp()
    // Send 5 requests with invalid toolCallbackUrl — if slots leak,
    // the 4th request would get 429 instead of 400.
    for (let i = 0; i < 5; i++) {
      const res = await postJSON(app, '/api/chat', {
        provider: FAKE_PROVIDER,
        parameters: VALID_PARAMS,
        systemPrompt: 'test',
        messages: [{ role: 'user', content: 'hi' }],
        toolCallbackUrl: 'http://evil.com/callback',
      })
      expect(res.status).toBe(400) // Should always be 400, never 429
      await res.text() // consume body
    }
  })

  it('SSE error event has sanitized message (no file paths)', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/chat', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const text = await res.text()
    const events = text.split('\n')
      .filter((l: string) => l.startsWith('data:'))
      .map((l: string) => {
        try { return JSON.parse(l.replace(/^data:\s*/, '')) }
        catch { return null }
      })
      .filter(Boolean)

    const errorEvent = events.find((e: any) => e.type === 'error')
    if (errorEvent) {
      // Error message should not contain file paths
      expect(errorEvent.message).not.toMatch(/\/[^\s]+\.[jt]s:\d+/)
    }
  })
})

// ──────────────────────────────────────────────
// Complete route
// ──────────────────────────────────────────────

describe('POST /api/complete', () => {
  it('rejects missing systemPrompt', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/complete', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing messages', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/complete', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
    })
    expect(res.status).toBe(400)
  })

  it('returns SSE for valid request', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/complete', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'Continue writing.',
      messages: [{ role: 'user', content: 'The sun was setting' }],
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('SSE stream ends with done or error event', async () => {
    const app = makeApp()
    const res = await postJSON(app, '/api/complete', {
      provider: FAKE_PROVIDER,
      parameters: VALID_PARAMS,
      systemPrompt: 'test',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const text = await res.text()
    const events = text.split('\n')
      .filter((l: string) => l.startsWith('data:'))
      .map((l: string) => {
        try { return JSON.parse(l.replace(/^data:\s*/, '')) }
        catch { return null }
      })
      .filter(Boolean)

    // Stream must always end with either done or error
    const lastEvent = events[events.length - 1]
    expect(['done', 'error']).toContain(lastEvent?.type)
  })
})

// ──────────────────────────────────────────────
// Health route — complete field coverage
// ──────────────────────────────────────────────

describe('GET /health — full fields', () => {
  it('includes all expected memory fields', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    const body = await res.json() as any
    expect(typeof body.memory.rss_bytes).toBe('number')
    expect(typeof body.memory.heap_used_bytes).toBe('number')
    expect(typeof body.memory.heap_total_bytes).toBe('number')
  })

  it('uptime_ms is non-negative', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    const body = await res.json() as any
    expect(body.uptime_ms).toBeGreaterThanOrEqual(0)
  })

  it('pid is a positive integer', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    const body = await res.json() as any
    expect(body.pid).toBeGreaterThan(0)
    expect(Number.isInteger(body.pid)).toBe(true)
  })
})

// ──────────────────────────────────────────────
// 404 for unregistered routes
// ──────────────────────────────────────────────

describe('Unknown routes', () => {
  it('GET /api/chat returns 404 (only POST registered)', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat')
    expect(res.status).toBe(404)
  })

  it('GET /api/extract returns 404', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract')
    expect(res.status).toBe(404)
  })

  it('DELETE /api/compact returns 404', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})
