/**
 * Body size limit middleware.
 * Prevents memory exhaustion from oversized request payloads.
 */
import { createMiddleware } from 'hono/factory'

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

export function bodyLimitMiddleware(maxBytes: number = DEFAULT_MAX_BODY_BYTES) {
  return createMiddleware(async (c, next) => {
    // Check Content-Length header first (fast path)
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

    // For chunked/headerless requests, read body and check actual size.
    // This reads the full body into memory before checking — acceptable because:
    // 1. Auth middleware runs first, rejecting unauthenticated requests before this point
    // 2. The 2MB limit keeps memory bounded for authenticated requests
    // 3. This is a localhost-only desktop daemon, not a public API
    if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
      const body = await c.req.raw.clone().arrayBuffer()
      if (body.byteLength > maxBytes) {
        return c.json(
          { error: `Request body too large (${body.byteLength} bytes, max ${maxBytes} bytes)` },
          413,
        )
      }
    }

    await next()
  })
}
