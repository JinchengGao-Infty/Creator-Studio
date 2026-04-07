/**
 * Request ID middleware.
 * Propagates request_id from client or generates a new one.
 * All downstream code can access it via c.get('requestId').
 */
import { createMiddleware } from 'hono/factory'
import { randomUUID } from 'node:crypto'

export function requestIdMiddleware() {
  return createMiddleware(async (c, next) => {
    const requestId = c.req.header('X-Request-ID') ?? `req_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    c.set('requestId', requestId)
    c.header('X-Request-ID', requestId)
    await next()
  })
}
