/**
 * AI Engine HTTP Server — Integration Tests
 *
 * Tests the Hono server skeleton: health check, auth, error handling,
 * request ID propagation, and route registration.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'

const SECRET = 'test-secret-token-12345'

function makeApp(secret?: string) {
  return createApp(secret)
}

function authHeader(secret: string) {
  return { Authorization: `Bearer ${secret}` }
}

// ──────────────────────────────────────────────
// Health endpoint (no auth required)
// ──────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok and version', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/health')
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.version).toBe('2.0')
    expect(typeof body.uptime_ms).toBe('number')
    expect(typeof body.pid).toBe('number')
    expect(body.memory).toBeDefined()
    expect(typeof body.memory.rss_bytes).toBe('number')
  })

  it('does not require auth', async () => {
    const app = makeApp(SECRET)
    // No Authorization header
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })
})

// ──────────────────────────────────────────────
// Auth middleware
// ──────────────────────────────────────────────

describe('Auth middleware', () => {
  it('rejects /api/* requests without Authorization header', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toContain('Missing Authorization')
  })

  it('rejects /api/* requests with wrong token', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer wrong-token', 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(401)
    const body = await res.json() as any
    expect(body.error).toContain('Invalid bearer token')
  })

  it('allows /api/* requests with correct token', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: { ...authHeader(SECRET), 'Content-Type': 'application/json' },
    })
    // Should get 400 (missing fields) not 401 (auth error)
    expect(res.status).toBe(400)
  })

  it('works without secret (no auth enforcement)', async () => {
    const app = makeApp() // No secret
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Should get 400 not 401
    expect(res.status).toBe(400)
  })

  it('rejects requests from disallowed origins', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        ...authHeader(SECRET),
        'Content-Type': 'application/json',
        Origin: 'https://evil.com',
      },
    })
    expect(res.status).toBe(403)
    const body = await res.json() as any
    expect(body.error).toContain('Origin not allowed')
  })

  it('rejects localhost.evil.com origin bypass attempt', async () => {
    const app = makeApp(SECRET)
    const evilOrigins = [
      'http://localhost.evil.com',
      'http://localhost.evil.com:1420',
      'http://127.0.0.1.evil.com',
    ]
    for (const origin of evilOrigins) {
      const res = await app.request('/api/compact', {
        method: 'POST',
        body: '{}',
        headers: {
          ...authHeader(SECRET),
          'Content-Type': 'application/json',
          Origin: origin,
        },
      })
      expect(res.status).toBe(403)
    }
  })

  it('allows requests from localhost origins', async () => {
    const app = makeApp(SECRET)
    const origins = [
      'http://localhost:1420',
      'http://127.0.0.1:1420',
      'tauri://localhost',
    ]
    for (const origin of origins) {
      const res = await app.request('/api/compact', {
        method: 'POST',
        body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
        headers: {
          ...authHeader(SECRET),
          'Content-Type': 'application/json',
          Origin: origin,
        },
      })
      // Should pass auth (get 400, not 401/403)
      expect(res.status).toBe(400)
    }
  })
})

// ──────────────────────────────────────────────
// Request ID middleware
// ──────────────────────────────────────────────

describe('Request ID middleware', () => {
  it('generates a request ID if none provided', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    const reqId = res.headers.get('X-Request-ID')
    expect(reqId).toBeTruthy()
    expect(reqId!.startsWith('req_')).toBe(true)
  })

  it('propagates client-provided request ID', async () => {
    const app = makeApp()
    const res = await app.request('/health', {
      headers: { 'X-Request-ID': 'my-custom-id-123' },
    })
    expect(res.headers.get('X-Request-ID')).toBe('my-custom-id-123')
  })
})

// ──────────────────────────────────────────────
// Error middleware
// ──────────────────────────────────────────────

describe('Error middleware', () => {
  it('returns error for malformed JSON requests', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    // Should return an error response
    expect(res.status).toBeGreaterThanOrEqual(400)
    // Should have request ID header regardless of error type
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
})

// ──────────────────────────────────────────────
// Route registration
// ──────────────────────────────────────────────

describe('Route registration', () => {
  it('all implemented routes validate input (400 for missing fields)', async () => {
    const app = makeApp()

    const routes = [
      { method: 'POST', path: '/api/chat' },
      { method: 'POST', path: '/api/complete' },
      { method: 'POST', path: '/api/extract' },
      { method: 'POST', path: '/api/transform' },
    ]
    for (const { method, path } of routes) {
      const res = await app.request(path, {
        method,
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
      })
      expect(res.status).toBe(400)
    }
  })

  it('compact route validates required fields', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: { id: 'test' }, parameters: { model: 'gpt-4' } }),
      headers: { 'Content-Type': 'application/json' },
    })
    // Missing messages → 400
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown routes', async () => {
    const app = makeApp()
    const res = await app.request('/api/nonexistent')
    expect(res.status).toBe(404)
  })
})

// ──────────────────────────────────────────────
// Compact route validation
// ──────────────────────────────────────────────

describe('POST /api/compact', () => {
  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ parameters: { model: 'x' }, messages: [{ role: 'user', content: 'hi' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing parameters', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: { id: 'x' }, messages: [{ role: 'user', content: 'hi' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })

  it('rejects empty messages', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: { id: 'x' }, parameters: { model: 'x' }, messages: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})
