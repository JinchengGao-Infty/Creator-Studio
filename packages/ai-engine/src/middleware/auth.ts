/**
 * Shared secret bearer token authentication middleware.
 * Protects localhost endpoints from unauthorized same-machine processes.
 */
import { createMiddleware } from 'hono/factory'

export function authMiddleware(sharedSecret: string) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (!authHeader) {
      return c.json({ error: 'Missing Authorization header' }, 401)
    }

    const [scheme, token] = authHeader.split(' ', 2)
    if (scheme !== 'Bearer' || token !== sharedSecret) {
      return c.json({ error: 'Invalid bearer token' }, 401)
    }

    // Origin check: only allow localhost and tauri origins
    const origin = c.req.header('Origin')
    if (origin) {
      const allowed = [
        'http://localhost',
        'http://127.0.0.1',
        'https://localhost',
        'https://127.0.0.1',
        'tauri://localhost',
      ]
      const isAllowed = allowed.some((prefix) => origin.startsWith(prefix))
      if (!isAllowed) {
        return c.json({ error: 'Origin not allowed' }, 403)
      }
    }

    await next()
  })
}
