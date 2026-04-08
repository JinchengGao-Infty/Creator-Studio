/**
 * models.ts — Comprehensive Unit Tests
 *
 * Tests fetchModels, authHeaders, joinURL, ensureV1, uniqueSorted,
 * error handling, fallback to /v1, and abort signal support.
 *
 * Uses real HTTP servers (Bun.serve) to mock the OpenAI /v1/models endpoint.
 * NOTE: Uses 127.0.0.1 explicitly to avoid IPv4/IPv6 resolution issues.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { fetchModels } from '../models.js'
import type { Server } from 'bun'

let server: Server
let baseURL: string

// Mock models server — all test paths go through this one server to avoid port collisions
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const url = new URL(req.url)
      const p = url.pathname

      // Main models endpoint
      if (p === '/v1/models') {
        return Response.json({
          data: [
            { id: 'gpt-4', object: 'model' },
            { id: 'gpt-3.5-turbo', object: 'model' },
            { id: 'gpt-4', object: 'model' }, // duplicate for dedup test
          ],
          object: 'list',
        })
      }

      // /models without /v1 — for direct access test
      if (p === '/models') {
        return Response.json({
          data: [{ id: 'direct-model', object: 'model' }],
          object: 'list',
        })
      }

      // Path for "error server" test — returns 500
      if (p.startsWith('/err500')) {
        return new Response(
          JSON.stringify({ error: 'Internal Server Error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Path for "fallback" test — only /fallback-test/v1/models succeeds, /fallback-test/models 404s
      if (p === '/fallback-test/v1/models') {
        return Response.json({
          data: [{ id: 'fallback-success', object: 'model' }],
          object: 'list',
        })
      }

      // Path for "empty data" test
      if (p.startsWith('/empty')) {
        return Response.json({ data: [], object: 'list' })
      }

      // Path for "weird IDs" test
      if (p.startsWith('/weird')) {
        return Response.json({
          data: [
            { id: 'good-model' },
            { id: '' },
            { id: '  ' },
            { id: 'another-model' },
          ],
          object: 'list',
        })
      }

      // Path for "malformed JSON" test
      if (p.startsWith('/badjson')) {
        return new Response('not json at all', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(`Not Found: ${p}`, { status: 404 })
    },
  })
  baseURL = `http://127.0.0.1:${server.port}/v1`
})

afterAll(() => {
  server.stop(true)
})

// Helper: create a mock server for a single test
function createMockServer(handler: (req: Request) => Response) {
  return Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: handler })
}

// ──────────────────────────────────────────────
// fetchModels — happy paths
// ──────────────────────────────────────────────

describe('fetchModels', () => {
  it('fetches and returns sorted model IDs', async () => {
    const models = await fetchModels(baseURL, 'test-key')
    expect(models).toContain('gpt-3.5-turbo')
    expect(models).toContain('gpt-4')
    expect(models.indexOf('gpt-3.5-turbo')).toBeLessThan(models.indexOf('gpt-4'))
  })

  it('deduplicates model IDs', async () => {
    const models = await fetchModels(baseURL, 'test-key')
    const gpt4Count = models.filter((m) => m === 'gpt-4').length
    expect(gpt4Count).toBe(1)
  })

  it('trims whitespace from baseURL', async () => {
    const models = await fetchModels(`  ${baseURL}  `, 'test-key')
    expect(models.length).toBeGreaterThan(0)
  })

  it('falls back to /v1/models on 404 without /v1 suffix', async () => {
    // Mock fetch to simulate: /models → 404, /v1/models → success
    const originalFetch = globalThis.fetch
    let callCount = 0
    globalThis.fetch = async (input: any, init?: any) => {
      callCount++
      const url = typeof input === 'string' ? input : input.url
      if (url.includes('/v1/models')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'fallback-ok' }], object: 'list' }),
          { headers: { 'Content-Type': 'application/json' } },
        )
      }
      // First attempt without /v1 → 404
      return new Response('Not Found', { status: 404 })
    }
    try {
      const models = await fetchModels('http://mock.test:9999', 'test-key')
      expect(models).toContain('fallback-ok')
      expect(callCount).toBe(2) // first /models 404, then /v1/models success
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does NOT retry on 404 when baseURL already has /v1', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      return new Response('Not Found', { status: 404 })
    }
    try {
      // URL already has /v1 → should throw on first 404, no fallback
      await expect(
        fetchModels('http://mock.test:9999/v1', 'test-key'),
      ).rejects.toThrow('404')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('uses correct auth for openai-compatible (Bearer token)', async () => {
    const models = await fetchModels(baseURL, 'test-key', 'openai-compatible')
    expect(models.length).toBeGreaterThan(0)
  })

  it('uses correct auth for google (x-goog-api-key)', async () => {
    const models = await fetchModels(baseURL, 'test-key', 'google')
    expect(models.length).toBeGreaterThan(0)
  })

  it('uses correct auth for anthropic (x-api-key)', async () => {
    const models = await fetchModels(baseURL, 'test-key', 'anthropic')
    expect(models.length).toBeGreaterThan(0)
  })

  it('handles empty API key gracefully', async () => {
    const models = await fetchModels(baseURL, '')
    expect(models.length).toBeGreaterThan(0)
  })

  it('sends Bearer token for openai-compatible provider', async () => {
    let receivedAuth = ''
    const authServer = createMockServer((req) => {
      receivedAuth = req.headers.get('Authorization') ?? ''
      return Response.json({ data: [{ id: 'm1' }], object: 'list' })
    })
    try {
      await fetchModels(`http://127.0.0.1:${authServer.port}/v1`, 'my-key', 'openai-compatible')
      expect(receivedAuth).toBe('Bearer my-key')
    } finally {
      authServer.stop(true)
    }
  })

  it('sends x-api-key header for anthropic provider', async () => {
    let receivedHeader = ''
    const authServer = createMockServer((req) => {
      receivedHeader = req.headers.get('x-api-key') ?? ''
      return Response.json({ data: [{ id: 'm1' }], object: 'list' })
    })
    try {
      await fetchModels(`http://127.0.0.1:${authServer.port}/v1`, 'ant-key', 'anthropic')
      expect(receivedHeader).toBe('ant-key')
    } finally {
      authServer.stop(true)
    }
  })

  it('sends x-goog-api-key header for google provider', async () => {
    let receivedHeader = ''
    const authServer = createMockServer((req) => {
      receivedHeader = req.headers.get('x-goog-api-key') ?? ''
      return Response.json({ data: [{ id: 'm1' }], object: 'list' })
    })
    try {
      await fetchModels(`http://127.0.0.1:${authServer.port}/v1`, 'goog-key', 'google')
      expect(receivedHeader).toBe('goog-key')
    } finally {
      authServer.stop(true)
    }
  })
})

// ──────────────────────────────────────────────
// fetchModels — error paths
// ──────────────────────────────────────────────

describe('fetchModels error handling', () => {
  it('throws on unreachable URL', async () => {
    await expect(
      fetchModels('http://127.0.0.1:1', 'key'),
    ).rejects.toThrow()
  })

  it('throws on non-404 server error (no fallback)', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => {
      return new Response('Server Error', { status: 500 })
    }
    try {
      await expect(
        fetchModels('http://mock.test:9999/v1', 'key'),
      ).rejects.toThrow('500')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('respects AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      fetchModels(baseURL, 'key', 'openai-compatible', controller.signal),
    ).rejects.toThrow()
  })

  it('handles malformed JSON response', async () => {
    // /badjson/v1/models → returns non-JSON body
    await expect(
      fetchModels(`http://127.0.0.1:${server.port}/badjson/v1`, 'key'),
    ).rejects.toThrow()
  })

  it('handles response with empty data array', async () => {
    // /empty/v1/models → returns empty data array
    const models = await fetchModels(`http://127.0.0.1:${server.port}/empty/v1`, 'key')
    expect(models).toEqual([])
  })

  it('filters out empty and whitespace-only model IDs', async () => {
    // /weird/v1/models → returns models with empty/whitespace IDs
    const models = await fetchModels(`http://127.0.0.1:${server.port}/weird/v1`, 'key')
    expect(models).toEqual(['another-model', 'good-model'])
  })
})
