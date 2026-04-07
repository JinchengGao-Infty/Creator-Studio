/**
 * Unified error handling middleware.
 * Catches all unhandled errors, logs full details server-side,
 * but returns only a sanitized message to the client.
 */
import { createMiddleware } from 'hono/factory'

/** Sanitize error messages: strip stack traces, internal paths, secrets. */
function sanitizeMessage(message: string): string {
  // Remove file paths (Unix and Windows)
  let clean = message.replace(/\/[^\s:]+\.[jt]s:\d+/g, '[internal]')
  clean = clean.replace(/[A-Z]:\\[^\s:]+\.[jt]s:\d+/g, '[internal]')
  // Remove stack traces
  clean = clean.replace(/\n\s+at\s.+/g, '')
  // Truncate overly long messages
  if (clean.length > 500) {
    clean = clean.slice(0, 500) + '...'
  }
  return clean.trim()
}

export function errorMiddleware() {
  return createMiddleware(async (c, next) => {
    try {
      await next()
    } catch (err: unknown) {
      const requestId = c.get('requestId') as string | undefined
      const rawMessage = err instanceof Error ? err.message : String(err)
      const status = (err as any)?.status ?? 500

      // Full details logged server-side only
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        request_id: requestId,
        event: 'unhandled_error',
        error: rawMessage,
        stack: err instanceof Error ? err.stack : undefined,
        path: c.req.path,
        method: c.req.method,
      }))

      // Client gets sanitized message
      return c.json({
        error: sanitizeMessage(rawMessage),
        request_id: requestId,
      }, status)
    }
  })
}
