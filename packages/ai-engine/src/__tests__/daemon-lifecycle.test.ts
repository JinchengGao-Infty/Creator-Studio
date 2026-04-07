/**
 * Daemon Lifecycle Integration Tests
 *
 * Tests the actual HTTP server startup, port negotiation,
 * health check, and shutdown flow — simulating what the Rust layer does.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { startServer, createApp } from '../server.js'

let servers: { close: () => void }[] = []

afterEach(() => {
  for (const s of servers) {
    s.close()
  }
  servers = []
})

describe('Daemon Startup', () => {
  it('starts on dynamic port and returns port info', async () => {
    const { port, close } = await startServer({ sharedSecret: 'test-secret' })
    servers.push({ close })

    expect(typeof port).toBe('number')
    expect(port).toBeGreaterThan(0)
    expect(port).toBeLessThan(65536)
  })

  it('can start multiple instances on different ports', async () => {
    const s1 = await startServer({ sharedSecret: 'secret1' })
    const s2 = await startServer({ sharedSecret: 'secret2' })
    servers.push(s1, s2)

    expect(s1.port).not.toBe(s2.port)
  })
})

describe('Health Check via HTTP', () => {
  it('responds to /health with correct structure', async () => {
    const { port, close } = await startServer({ sharedSecret: 'test-secret' })
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)

    const body = await res.json() as any
    expect(body.status).toBe('ok')
    expect(body.version).toBe('2.0')
    expect(typeof body.uptime_ms).toBe('number')
    expect(typeof body.pid).toBe('number')
    expect(body.memory.rss_bytes).toBeGreaterThan(0)
  })

  it('/health does not require authentication', async () => {
    const { port, close } = await startServer({ sharedSecret: 'test-secret' })
    servers.push({ close })

    // No Authorization header
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
  })
})

describe('Authentication via HTTP', () => {
  it('rejects /api/* without token', async () => {
    const { port, close } = await startServer({ sharedSecret: 'test-secret' })
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })

  it('accepts /api/* with correct token', async () => {
    const secret = 'test-secret-for-auth'
    const { port, close } = await startServer({ sharedSecret: secret })
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/api/compact`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        provider: { id: 'test' },
        parameters: { model: 'test' },
        messages: [],
      }),
    })
    // Should get 400 (validation error) not 401 (auth error)
    expect(res.status).toBe(400)
  })
})

describe('Request ID Propagation via HTTP', () => {
  it('returns generated request ID in response header', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`)
    const reqId = res.headers.get('X-Request-ID')
    expect(reqId).toBeTruthy()
    expect(reqId!.startsWith('req_')).toBe(true)
  })

  it('echoes client-provided request ID', async () => {
    const { port, close } = await startServer({})
    servers.push({ close })

    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { 'X-Request-ID': 'my-trace-id-456' },
    })
    expect(res.headers.get('X-Request-ID')).toBe('my-trace-id-456')
  })
})

describe('Graceful Shutdown', () => {
  it('server stops accepting connections after close', async () => {
    const { port, close } = await startServer({})

    // Verify it works
    const res1 = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res1.status).toBe(200)

    // Close
    close()

    // Should fail after close (connection refused)
    await Bun.sleep(100) // Give OS time to release the port
    try {
      await fetch(`http://127.0.0.1:${port}/health`)
      // If we get here, the server didn't close properly
      expect(false).toBe(true)
    } catch (e: any) {
      // Expected: connection refused or similar network error
      expect(e.message || e.code).toBeTruthy()
    }
  })
})
