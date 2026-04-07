/**
 * Unified error handling middleware.
 * Catches all unhandled errors, logs them, and returns structured JSON.
 */
import { createMiddleware } from 'hono/factory'

export function errorMiddleware() {
  return createMiddleware(async (c, next) => {
    try {
      await next()
    } catch (err: unknown) {
      const requestId = c.get('requestId') as string | undefined
      const message = err instanceof Error ? err.message : String(err)
      const status = (err as any)?.status ?? 500

      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        request_id: requestId,
        event: 'unhandled_error',
        error: message,
        path: c.req.path,
        method: c.req.method,
      }))

      return c.json({ error: message, request_id: requestId }, status)
    }
  })
}
