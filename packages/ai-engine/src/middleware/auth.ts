/**
 * Shared secret bearer token authentication middleware.
 * Protects localhost endpoints from unauthorized same-machine processes.
 */
import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'))
  } catch {
    return false
  }
}

/** Strict origin check: compare protocol + hostname. */
function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    const hostname = url.hostname
    const protocol = url.protocol
    // Only allow http/https from localhost/127.0.0.1
    const isLocalhostHost = hostname === 'localhost' || hostname === '127.0.0.1'
    const isAllowedProtocol = protocol === 'http:' || protocol === 'https:'
    return isLocalhostHost && isAllowedProtocol
  } catch {
    return false
  }
}

export function authMiddleware(sharedSecret: string) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      return c.json({ error: 'Missing Authorization header' }, 401)
    }

    const [scheme, token] = authHeader.split(' ', 2)
    if (scheme !== 'Bearer' || !token || !safeCompare(token, sharedSecret)) {
      return c.json({ error: 'Invalid bearer token' }, 401)
    }

    // Origin check: only allow localhost and tauri origins
    const origin = c.req.header('Origin')
    if (origin) {
      // Special case: tauri:// is not a valid URL for new URL()
      const isTauri = origin === 'tauri://localhost'
      if (!isTauri && !isAllowedOrigin(origin)) {
        return c.json({ error: 'Origin not allowed' }, 403)
      }
    }

    await next()
  })
}
