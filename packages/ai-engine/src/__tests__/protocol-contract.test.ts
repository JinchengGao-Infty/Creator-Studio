/**
 * Protocol Contract Tests
 *
 * Ensures that the protocol version reported by the Node.js daemon
 * matches the expected version, serving as the bridge contract
 * between the TS and Rust sides.
 *
 * The Rust side has its own PROTOCOL_VERSION constant that must match.
 * If this test fails, check both:
 *   - packages/ai-engine/src/server.ts: PROTOCOL_VERSION
 *   - src-tauri/src/ai_daemon.rs: PROTOCOL_VERSION
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { startServer } from '../server.js'

const EXPECTED_PROTOCOL_VERSION = '2.0'

let servers: { close: () => void }[] = []

afterEach(() => {
  for (const s of servers) s.close()
  servers = []
})

describe('Protocol version contract', () => {
  it('startup message reports correct version', async () => {
    // startServer writes {"port":N,"version":"X"} to stdout
    // We verify via the health endpoint instead (same source constant)
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const body = await res.json() as any

    expect(body.version).toBe(EXPECTED_PROTOCOL_VERSION)
  })

  it('health endpoint version is a semver-ish string', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const body = await res.json() as any

    // Must be non-empty string matching X.Y pattern
    expect(typeof body.version).toBe('string')
    expect(body.version).toMatch(/^\d+\.\d+$/)
  })
})

describe('Error middleware contract', () => {
  it('unhandled errors include request_id in response', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    // Send malformed JSON to trigger error
    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    // Response should have X-Request-ID header regardless
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })
})

describe('SSE event contract', () => {
  it('chat route returns SSE content-type', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: {
          id: 'test', name: 'Test', baseURL: 'http://localhost:99999',
          apiKey: 'test', models: [], providerType: 'openai-compatible',
        },
        parameters: { model: 'test', temperature: 0.7 },
        systemPrompt: 'test',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    expect(res.headers.get('content-type')).toContain('text/event-stream')

    // Parse SSE events
    const text = await res.text()
    const dataLines = text.split('\n').filter(l => l.startsWith('data:'))

    // Each line must be valid JSON with a type field
    for (const line of dataLines) {
      const json = JSON.parse(line.replace(/^data:\s*/, ''))
      expect(json.type).toBeDefined()
      expect(['text_delta', 'tool_call_start', 'tool_call_end', 'done', 'error']).toContain(json.type)
    }

    // Must end with either done or error
    const lastData = dataLines[dataLines.length - 1]
    const lastJson = JSON.parse(lastData.replace(/^data:\s*/, ''))
    expect(['done', 'error']).toContain(lastJson.type)
  })
})
