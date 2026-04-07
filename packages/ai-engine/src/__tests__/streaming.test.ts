/**
 * SSE Streaming Tests
 *
 * Tests the streaming routes' validation, SSE format, and error handling.
 * Does NOT test actual LLM responses (requires real API keys).
 * Focuses on contract compliance: input validation, SSE format, error events.
 */
import { describe, it, expect } from 'bun:test'
import { createApp } from '../server.js'

function makeApp() {
  return createApp() // No auth for test simplicity
}

const headers = { 'Content-Type': 'application/json' }

const validProvider = {
  id: 'test-provider',
  name: 'Test',
  baseURL: 'http://localhost:99999',
  apiKey: 'test-key',
  models: [],
  providerType: 'openai-compatible' as const,
}

const validParams = { model: 'test-model', temperature: 0.7, maxTokens: 100 }

/** Parse SSE data lines from response text. */
function parseSSEDataLines(text: string): Array<{ type: string; [k: string]: unknown }> {
  return text
    .split('\n')
    .filter(l => l.startsWith('data:'))
    .map(l => JSON.parse(l.replace(/^data:\s*/, '')))
}

// ──────────────────────────────────────────────
// Chat validation
// ──────────────────────────────────────────────

describe('POST /api/chat - validation', () => {
  it('rejects missing provider', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({ parameters: validParams, systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects missing systemPrompt', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({ provider: validProvider, parameters: validParams, messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(400)
  })
})

// ──────────────────────────────────────────────
// SSE contract: format compliance
// ──────────────────────────────────────────────

describe('SSE contract', () => {
  it('chat returns text/event-stream content type', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
  })

  it('SSE data lines are valid JSON with type field', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const events = parseSSEDataLines(await res.text())
    expect(events.length).toBeGreaterThan(0)

    const validTypes = ['text_delta', 'tool_call_start', 'tool_call_end', 'done', 'error']
    for (const event of events) {
      expect(validTypes).toContain(event.type)
    }
  })

  it('SSE stream always ends with done or error', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const events = parseSSEDataLines(await res.text())
    const lastEvent = events[events.length - 1]
    expect(['done', 'error']).toContain(lastEvent.type)
  })

  it('complete returns SSE with done or error', async () => {
    const app = makeApp()
    const res = await app.request('/api/complete', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'Continue', messages: [{ role: 'user', content: 'hello' }],
      }),
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const events = parseSSEDataLines(await res.text())
    const lastEvent = events[events.length - 1]
    expect(['done', 'error']).toContain(lastEvent.type)
  })

  it('last event is always done or error with required fields', async () => {
    const app = makeApp()
    const res = await app.request('/api/complete', {
      method: 'POST', headers,
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    const events = parseSSEDataLines(await res.text())
    expect(events.length).toBeGreaterThan(0)
    const lastEvent = events[events.length - 1]

    if (lastEvent.type === 'done') {
      // done events MUST have content field
      expect(lastEvent).toHaveProperty('content')
      expect(typeof lastEvent.content).toBe('string')
    } else {
      // error events MUST have message field
      expect(lastEvent.type).toBe('error')
      expect(lastEvent).toHaveProperty('message')
      expect(typeof lastEvent.message).toBe('string')
    }
  })
})

// ──────────────────────────────────────────────
// Request ID in SSE responses
// ──────────────────────────────────────────────

describe('Request ID in SSE', () => {
  it('propagates request ID in response headers', async () => {
    const app = makeApp()
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { ...headers, 'X-Request-ID': 'trace-123' },
      body: JSON.stringify({
        provider: validProvider, parameters: validParams,
        systemPrompt: 'test', messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    expect(res.headers.get('X-Request-ID')).toBe('trace-123')
  })
})
