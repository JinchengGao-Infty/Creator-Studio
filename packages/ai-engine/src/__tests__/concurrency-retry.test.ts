/**
 * Concurrency Control + Retry Tests
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'
import { withRetry } from '../middleware/retry.js'

const headers = { 'Content-Type': 'application/json' }

const validChatBody = JSON.stringify({
  provider: { id: 'test', name: 'Test', baseURL: 'http://localhost:99999', apiKey: 'k', models: [], providerType: 'openai-compatible' },
  parameters: { model: 'test', temperature: 0.7 },
  systemPrompt: 'test',
  messages: [{ role: 'user', content: 'hi' }],
})

// ──────────────────────────────────────────────
// Concurrency middleware
// ──────────────────────────────────────────────

describe('Concurrency middleware', () => {
  it('allows requests under the limit', async () => {
    const app = createApp()
    const res = await app.request('/api/chat', { method: 'POST', headers, body: validChatBody })
    // Should get SSE response, not 429
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('non-streaming routes are not limited', async () => {
    const app = createApp()
    // extract and compact are not streaming, should not be concurrency-limited
    const res = await app.request('/api/extract', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: { id: 'test', name: 'Test', baseURL: 'http://localhost:99999', apiKey: 'k', models: [], providerType: 'openai-compatible' },
        parameters: { model: 'test' },
        text: 'test',
      }),
    })
    // Should get JSON response, not 429
    expect(res.status).not.toBe(429)
  })
})

// ──────────────────────────────────────────────
// Retry utility
// ──────────────────────────────────────────────

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => 42)
    expect(result).toBe(42)
  })

  it('retries on retryable error and succeeds', async () => {
    let attempts = 0
    const result = await withRetry(
      () => {
        attempts++
        if (attempts < 3) throw new Error('fetch failed: ECONNREFUSED')
        return 'ok'
      },
      { maxRetries: 3, initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('throws after max retries exceeded', async () => {
    let attempts = 0
    try {
      await withRetry(
        () => {
          attempts++
          throw new Error('fetch failed: ECONNREFUSED')
        },
        { maxRetries: 2, initialDelayMs: 10 },
      )
      expect(false).toBe(true) // Should not reach
    } catch (err: any) {
      expect(err.message).toContain('ECONNREFUSED')
      expect(attempts).toBe(3) // 1 initial + 2 retries
    }
  })

  it('does not retry non-retryable errors', async () => {
    let attempts = 0
    try {
      await withRetry(
        () => {
          attempts++
          throw new Error('Invalid API key')
        },
        { maxRetries: 3, initialDelayMs: 10 },
      )
    } catch {
      // expected
    }
    expect(attempts).toBe(1) // No retry
  })

  it('does not retry AbortError', async () => {
    let attempts = 0
    try {
      await withRetry(
        () => {
          attempts++
          throw new DOMException('Aborted', 'AbortError')
        },
        { maxRetries: 3, initialDelayMs: 10 },
      )
    } catch {
      // expected
    }
    expect(attempts).toBe(1)
  })

  it('respects abort signal during retry delay', async () => {
    const controller = new AbortController()
    let attempts = 0

    const promise = withRetry(
      () => {
        attempts++
        throw new Error('fetch failed: ECONNRESET')
      },
      { maxRetries: 5, initialDelayMs: 5000, abortSignal: controller.signal },
    )

    // Abort after a short delay
    setTimeout(() => controller.abort(), 50)

    try {
      await promise
    } catch (err: any) {
      expect(err.name).toBe('AbortError')
    }
    // Should have made 1 attempt then been aborted during delay
    expect(attempts).toBe(1)
  })

  it('retries on 429 status code', async () => {
    let attempts = 0
    const result = await withRetry(
      () => {
        attempts++
        if (attempts === 1) throw new Error('API error: 429 Too Many Requests')
        return 'success'
      },
      { maxRetries: 2, initialDelayMs: 10 },
    )
    expect(result).toBe('success')
    expect(attempts).toBe(2)
  })

  it('retries on 502/503 status codes', async () => {
    let attempts = 0
    const result = await withRetry(
      () => {
        attempts++
        if (attempts === 1) throw new Error('502 Bad Gateway')
        return 'ok'
      },
      { maxRetries: 2, initialDelayMs: 10 },
    )
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
  })
})
