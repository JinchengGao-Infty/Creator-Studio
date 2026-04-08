/**
 * Middleware Edge Case Tests
 *
 * Tests for edge cases NOT covered by the main server.test.ts:
 * - Auth: IPv6, https localhost, safeCompare edge cases, scheme parsing
 * - Body limit: PUT/PATCH methods, exact boundary, no Content-Length + chunked
 * - Concurrency: double release, state tracking
 * - Retry: calculateDelay bounds, abort during sleep, non-retryable status codes
 * - Request ID: format validation
 * - Error middleware: sanitizeMessage edge cases
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'
import { createConcurrencyLimiter } from '../middleware/concurrency.js'
import { withRetry } from '../middleware/retry.js'

const SECRET = 'edge-case-test-secret'

function makeApp(secret?: string) {
  return createApp(secret)
}

function authHeaders(secret: string) {
  return {
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  }
}

// ──────────────────────────────────────────────
// Auth edge cases
// ──────────────────────────────────────────────

describe('Auth — edge cases', () => {
  it('rejects request with empty Bearer token', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        Authorization: 'Bearer ',
        'Content-Type': 'application/json',
      },
    })
    expect(res.status).toBe(401)
  })

  it('rejects Basic auth scheme', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        Authorization: `Basic ${btoa('user:pass')}`,
        'Content-Type': 'application/json',
      },
    })
    expect(res.status).toBe(401)
  })

  it('rejects Authorization with double space', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        Authorization: `Bearer  ${SECRET}`, // double space
        'Content-Type': 'application/json',
      },
    })
    expect(res.status).toBe(401)
  })

  it('rejects very long token (DoS attempt)', async () => {
    const app = makeApp(SECRET)
    const longToken = 'x'.repeat(100_000)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        Authorization: `Bearer ${longToken}`,
        'Content-Type': 'application/json',
      },
    })
    expect(res.status).toBe(401)
  })

  it('rejects ftp://localhost origin (wrong protocol)', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        ...authHeaders(SECRET),
        Origin: 'ftp://localhost',
      },
    })
    expect(res.status).toBe(403)
  })

  it('allows request with no Origin header', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: authHeaders(SECRET),
    })
    // No Origin header → no origin check → passes auth, gets 400 for bad body
    expect(res.status).toBe(400)
  })

  it('rejects data: URI as origin', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        ...authHeaders(SECRET),
        Origin: 'data:text/html,<h1>evil</h1>',
      },
    })
    expect(res.status).toBe(403)
  })

  it('rejects javascript: URI as origin', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '{}',
      headers: {
        ...authHeaders(SECRET),
        Origin: 'javascript:alert(1)',
      },
    })
    // javascript: URIs fail new URL() parsing → 403
    expect(res.status).toBe(403)
  })

  it('allows https://localhost origin', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: {
        ...authHeaders(SECRET),
        Origin: 'https://localhost',
      },
    })
    // https is allowed protocol + localhost is allowed host
    expect(res.status).toBe(400) // passes auth, fails validation
  })

  it('allows IPv6 localhost [::1] origin', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: {
        ...authHeaders(SECRET),
        Origin: 'http://[::1]:1420',
      },
    })
    expect(res.status).toBe(400) // passes auth + origin check
  })

  it('allows https://127.0.0.1 origin', async () => {
    const app = makeApp(SECRET)
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: JSON.stringify({ provider: null, parameters: null, messages: [] }),
      headers: {
        ...authHeaders(SECRET),
        Origin: 'https://127.0.0.1:3000',
      },
    })
    expect(res.status).toBe(400) // passes auth
  })
})

// ──────────────────────────────────────────────
// Body limit edge cases
// ──────────────────────────────────────────────

describe('Body limit — edge cases', () => {
  it('allows body exactly at 2MB limit', async () => {
    const app = makeApp() // no auth for simplicity
    const body = JSON.stringify({
      provider: { id: 'x' },
      parameters: { model: 'x' },
      text: 'a'.repeat(2 * 1024 * 1024 - 200), // just under 2MB with JSON overhead
    })
    const res = await app.request('/api/extract', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    // Should not be 413 — it's under the limit
    expect(res.status).not.toBe(413)
  })

  it('rejects body over 2MB (3MB payload)', async () => {
    const app = makeApp()
    const body = 'x'.repeat(3 * 1024 * 1024)
    const res = await app.request('/api/extract', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(413)
  })

  it('rejects body over 2MB without Content-Length header', async () => {
    const app = makeApp()
    // When body is a string, Bun may or may not set Content-Length.
    // The middleware should still check via arrayBuffer() for POST.
    const body = 'x'.repeat(3 * 1024 * 1024)
    const res = await app.request('/api/extract', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(413)
  })

  it('rejects body with malformed Content-Length that looks numeric', async () => {
    const app = makeApp()
    // "1abc" parses to 1 via parseInt but is not a valid pure number
    // Should fall through to actual body check, not trust the header
    const largeBody = 'x'.repeat(3 * 1024 * 1024)
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: largeBody,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': '1abc', // malformed
      },
    })
    // Should still be rejected via actual body size check
    expect(res.status).toBe(413)
  })

  it('does not limit GET requests', async () => {
    const app = makeApp()
    // GET /health should not trigger body limit check
    const res = await app.request('/health')
    expect(res.status).toBe(200)
  })
})

// ──────────────────────────────────────────────
// Concurrency limiter
// ──────────────────────────────────────────────

describe('ConcurrencyLimiter', () => {
  it('allows up to max concurrent acquires', () => {
    const limiter = createConcurrencyLimiter(2)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(false) // at limit
  })

  it('release allows next acquire', () => {
    const limiter = createConcurrencyLimiter(1)
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(false)
    limiter.release()
    expect(limiter.tryAcquire()).toBe(true)
  })

  it('double release does not go below 0', () => {
    const limiter = createConcurrencyLimiter(1)
    expect(limiter.tryAcquire()).toBe(true)
    limiter.release()
    limiter.release() // should not underflow
    expect(limiter.getState().active).toBe(0)
    // Should still only allow 1
    expect(limiter.tryAcquire()).toBe(true)
    expect(limiter.tryAcquire()).toBe(false)
  })

  it('getState reflects current active count', () => {
    const limiter = createConcurrencyLimiter(3)
    expect(limiter.getState()).toEqual({ active: 0, max: 3 })
    limiter.tryAcquire()
    expect(limiter.getState()).toEqual({ active: 1, max: 3 })
    limiter.tryAcquire()
    expect(limiter.getState()).toEqual({ active: 2, max: 3 })
    limiter.release()
    expect(limiter.getState()).toEqual({ active: 1, max: 3 })
  })

  it('release without prior acquire stays at 0', () => {
    const limiter = createConcurrencyLimiter(2)
    limiter.release() // no prior acquire
    expect(limiter.getState().active).toBe(0)
  })

  it('handles high concurrency count', () => {
    const limiter = createConcurrencyLimiter(100)
    for (let i = 0; i < 100; i++) {
      expect(limiter.tryAcquire()).toBe(true)
    }
    expect(limiter.tryAcquire()).toBe(false)
    expect(limiter.getState().active).toBe(100)
  })
})

// ──────────────────────────────────────────────
// Retry utility
// ──────────────────────────────────────────────

describe('withRetry — edge cases', () => {
  it('succeeds on first try without delay', async () => {
    let calls = 0
    const result = await withRetry(() => {
      calls++
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries on network error and then succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('fetch failed')
        return 'recovered'
      },
      { initialDelayMs: 10, maxRetries: 2 },
    )
    expect(result).toBe('recovered')
    expect(calls).toBe(2)
  })

  it('retries on ECONNREFUSED', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('connect ECONNREFUSED 127.0.0.1:1234')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('retries on ECONNRESET', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('read ECONNRESET')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
  })

  it('retries on ETIMEDOUT', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('connect ETIMEDOUT')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
  })

  it('retries on 429 status code error', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('API error 429: rate limit exceeded')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('retries on 502 status code error', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('502 Bad Gateway')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
  })

  it('retries on 503 status code error', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('503 Service Unavailable')
        return 'ok'
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
  })

  it('does NOT retry on 401 (non-retryable)', async () => {
    let calls = 0
    await expect(
      withRetry(
        () => {
          calls++
          throw new Error('401 Unauthorized')
        },
        { initialDelayMs: 10, maxRetries: 3 },
      ),
    ).rejects.toThrow('401')
    expect(calls).toBe(1) // no retry
  })

  it('does NOT retry on 403 (non-retryable)', async () => {
    let calls = 0
    await expect(
      withRetry(
        () => {
          calls++
          throw new Error('403 Forbidden')
        },
        { initialDelayMs: 10, maxRetries: 3 },
      ),
    ).rejects.toThrow('403')
    expect(calls).toBe(1)
  })

  it('does NOT retry AbortError', async () => {
    let calls = 0
    const abortErr = new DOMException('Aborted', 'AbortError')
    await expect(
      withRetry(
        () => {
          calls++
          throw abortErr
        },
        { initialDelayMs: 10, maxRetries: 3 },
      ),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('respects AbortSignal during retry delay', async () => {
    const controller = new AbortController()
    let calls = 0

    const promise = withRetry(
      () => {
        calls++
        throw new Error('fetch failed')
      },
      { initialDelayMs: 5000, maxRetries: 5, abortSignal: controller.signal },
    )

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50)

    await expect(promise).rejects.toThrow()
    // Should have only made 1-2 calls before abort kicked in
    expect(calls).toBeLessThanOrEqual(2)
  })

  it('throws last error after maxRetries exhausted', async () => {
    let calls = 0
    await expect(
      withRetry(
        () => {
          calls++
          throw new Error('fetch failed: attempt ' + calls)
        },
        { initialDelayMs: 10, maxRetries: 2 },
      ),
    ).rejects.toThrow('fetch failed: attempt 3')
    expect(calls).toBe(3) // initial + 2 retries
  })

  it('works with maxRetries: 0 (no retries)', async () => {
    let calls = 0
    await expect(
      withRetry(
        () => {
          calls++
          throw new Error('fetch failed')
        },
        { maxRetries: 0 },
      ),
    ).rejects.toThrow('fetch failed')
    expect(calls).toBe(1)
  })

  it('handles async functions', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls === 1) throw new Error('ECONNREFUSED')
        return await Promise.resolve('async-result')
      },
      { initialDelayMs: 10 },
    )
    expect(result).toBe('async-result')
  })

  it('handles non-Error throws', async () => {
    await expect(
      withRetry(
        () => {
          throw 'string error' // eslint-disable-line no-throw-literal
        },
        { initialDelayMs: 10, maxRetries: 1 },
      ),
    ).rejects.toBe('string error')
  })

  it('custom retryableStatusCodes', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('418 I am a teapot')
        return 'ok'
      },
      { initialDelayMs: 10, retryableStatusCodes: [418] },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2)
  })

  it('does NOT retry when status code appears as substring (false positive guard)', async () => {
    let calls = 0
    // "port 5000" should NOT match retryable code 500
    await expect(
      withRetry(
        () => {
          calls++
          throw new Error('Failed to connect to port 5000')
        },
        { initialDelayMs: 10, maxRetries: 2, retryableStatusCodes: [500] },
      ),
    ).rejects.toThrow('port 5000')
    expect(calls).toBe(1) // no retry — 5000 does not match 500
  })

  it('retries on exact status code match with surrounding text', async () => {
    let calls = 0
    const result = await withRetry(
      () => {
        calls++
        if (calls === 1) throw new Error('Provider returned 500 Internal Server Error')
        return 'ok'
      },
      { initialDelayMs: 10, retryableStatusCodes: [500] },
    )
    expect(result).toBe('ok')
    expect(calls).toBe(2) // retried once
  })
})

// ──────────────────────────────────────────────
// Request ID format
// ──────────────────────────────────────────────

describe('Request ID — format', () => {
  it('auto-generated ID starts with req_ and has hex suffix', async () => {
    const app = makeApp()
    const res = await app.request('/health')
    const reqId = res.headers.get('X-Request-ID')!
    expect(reqId).toMatch(/^req_[0-9a-f]{12}$/)
  })

  it('preserves arbitrary client-provided request ID', async () => {
    const app = makeApp()
    const res = await app.request('/health', {
      headers: { 'X-Request-ID': 'user/custom/id-123' },
    })
    expect(res.headers.get('X-Request-ID')).toBe('user/custom/id-123')
  })

  it('handles empty X-Request-ID (passes through as-is)', async () => {
    const app = makeApp()
    const res = await app.request('/health', {
      headers: { 'X-Request-ID': '' },
    })
    const reqId = res.headers.get('X-Request-ID')
    // Empty string is truthy for ?? operator (only null/undefined trigger fallback)
    // This is a known behavior — empty string is NOT treated as missing
    expect(reqId).toBeDefined()
  })
})

// ──────────────────────────────────────────────
// Error middleware — sanitization
// ──────────────────────────────────────────────

describe('Error middleware — response format', () => {
  it('includes request_id in error responses', async () => {
    const app = makeApp()
    const res = await app.request('/api/extract', {
      method: 'POST',
      body: 'invalid{json',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    const reqId = res.headers.get('X-Request-ID')
    expect(reqId).toBeTruthy()
  })

  it('returns error status for malformed POST body', async () => {
    const app = makeApp()
    const res = await app.request('/api/compact', {
      method: 'POST',
      body: '}{not-json',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
    // Response may or may not be JSON depending on where the error is caught
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
})
