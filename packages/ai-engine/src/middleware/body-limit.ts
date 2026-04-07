/**
 * Body size limit middleware.
 * Prevents memory exhaustion from oversized request payloads.
 */
import { createMiddleware } from 'hono/factory'

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

export function bodyLimitMiddleware(maxBytes: number = DEFAULT_MAX_BODY_BYTES) {
  return createMiddleware(async (c, next) => {
    const contentLength = c.req.header('Content-Length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (!isNaN(size) && size > maxBytes) {
        return c.json(
          { error: `Request body too large (${size} bytes, max ${maxBytes} bytes)` },
          413,
        )
      }
    }
    await next()
  })
}
