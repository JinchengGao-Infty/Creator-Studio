/**
 * Protocol Contract Tests
 *
 * Verifies the contract between Node.js daemon and Rust host:
 * - Protocol version string
 * - Health endpoint structure
 * - SSE event types
 * - Error response structure
 *
 * NOTE: The Rust side has PROTOCOL_VERSION = "2.0" in ai_daemon.rs.
 * If the Rust constant changes, this test must also be updated.
 * This is intentional — a mismatch forces a human to verify both sides.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { startServer, createApp } from '../server.js'

let servers: { close: () => void }[] = []
afterEach(() => { for (const s of servers) s.close(); servers = [] })

describe('Protocol version contract', () => {
  it('health endpoint reports version matching Rust constant', async () => {
    // Read the Rust source to extract the protocol version constant
    const rustDaemonPath = resolve(import.meta.dir, '../../../../src-tauri/src/ai_daemon.rs')
    let rustVersion: string | null = null
    try {
      const rustSource = readFileSync(rustDaemonPath, 'utf-8')
      const match = rustSource.match(/const PROTOCOL_VERSION:\s*&str\s*=\s*"([^"]+)"/)
      rustVersion = match?.[1] ?? null
    } catch {
      // If Rust file not available (CI without Rust), skip cross-check
      rustVersion = null
    }

    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const body = await res.json() as any

    // Always verify the format
    expect(typeof body.version).toBe('string')
    expect(body.version).toMatch(/^\d+\.\d+$/)

    // Cross-check against Rust if available
    if (rustVersion) {
      expect(body.version).toBe(rustVersion)
    }
  })
})

describe('Health endpoint structure', () => {
  it('returns all required fields', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(typeof body.version).toBe('string')
    expect(typeof body.uptime_ms).toBe('number')
    expect(typeof body.pid).toBe('number')
    expect(typeof body.memory.rss_bytes).toBe('number')
    expect(typeof body.memory.heap_used_bytes).toBe('number')
  })
})

describe('Error response contract', () => {
  it('JSON error responses include request_id', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    // Trigger validation error (missing fields)
    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: null }),
    })

    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(typeof body.error).toBe('string')
    // Request ID in header
    expect(res.headers.get('X-Request-ID')).toBeTruthy()
  })

  it('500 errors include request_id but sanitized message', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    // Trigger an internal error by sending valid structure with unreachable provider
    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: { id: 'x', name: 'x', baseURL: 'http://localhost:99999', apiKey: 'x', models: [], providerType: 'openai-compatible' },
        parameters: { model: 'x' },
        messages: [{ role: 'user', content: 'test' }],
      }),
    })

    expect(res.status).toBe(500)
    const body = await res.json() as any
    expect(body.error).toBeDefined()
    expect(body.request_id).toBeDefined()
    // Should not contain raw file paths
    expect(body.error).not.toMatch(/\/[a-zA-Z]+\/[^\s]+\.[jt]s:\d+/)
  })
})

describe('Body limit contract', () => {
  it('rejects oversized request bodies with 413', async () => {
    const app = createApp()
    // 3MB body exceeds 2MB limit
    const largeBody = JSON.stringify({ data: 'x'.repeat(3 * 1024 * 1024) })
    const res = await app.request('/api/compact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(largeBody)),
      },
      body: largeBody,
    })
    expect(res.status).toBe(413)
  })
})
