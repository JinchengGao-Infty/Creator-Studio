/**
 * Shared secret bearer token authentication middleware.
 * Protects localhost endpoints from unauthorized same-machine processes.
 */
import { createMiddleware } from 'hono/factory'
import { timingSafeEqual } from 'node:crypto'

/** Constant-time string comparison to prevent timing attacks. */
function safeCompare(a: string, b: string): boolean {
  // Use UTF-8 byte lengths (not JS char lengths) to handle multi-byte characters.
  // Pad both to the same byte length to prevent leaking secret length via timing.
  const byteLenA = Buffer.byteLength(a, 'utf-8')
  const byteLenB = Buffer.byteLength(b, 'utf-8')
  const maxLen = Math.max(byteLenA, byteLenB, 1) // at least 1 byte
  const bufA = Buffer.alloc(maxLen)
  const bufB = Buffer.alloc(maxLen)
  Buffer.from(a, 'utf-8').copy(bufA)
  Buffer.from(b, 'utf-8').copy(bufB)
  try {
    // Always run timingSafeEqual first to prevent timing oracle on secret length.
    // Combine results without short-circuiting (both operations always execute).
    const contentsMatch = timingSafeEqual(bufA, bufB)
    const lengthsMatch = byteLenA === byteLenB
    // Use bitwise AND to prevent JS engine short-circuit optimization
    return contentsMatch && lengthsMatch
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
    // Only allow http/https from localhost/127.0.0.1/[::1]
    // Note: Bun's URL parser keeps brackets for IPv6 (hostname === '[::1]'),
    // while Node.js strips them (hostname === '::1'). Handle both.
    const isLocalhostHost = hostname === 'localhost' || hostname === '127.0.0.1'
      || hostname === '::1' || hostname === '[::1]'
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
