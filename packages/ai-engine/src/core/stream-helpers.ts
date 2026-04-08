/**
 * Shared SSE streaming helpers.
 *
 * Eliminates boilerplate across chat/complete/transform routes:
 * - Provider initialization inside SSE (consistent error format)
 * - streamText → SSE text_delta/done/error event flow
 * - Structured logging with request_id and duration
 * - Abort-safe error reporting
 * - Error message sanitization for client responses
 */
import { streamSSE } from 'hono/streaming'
import { streamText } from 'ai'
import { ProviderManager } from '../provider.js'
import type { ConcurrencyLimiter } from '../middleware/concurrency.js'
import type { Context } from 'hono'
import type { ProviderConfig } from '../types.js'

/** Initialize a provider SDK model. Throws on failure. */
export function initModel(provider: ProviderConfig, modelId: string) {
  const providerManager = new ProviderManager()
  providerManager.addProvider(provider)
  const sdk = providerManager.createSDK(provider.id)
  return sdk(modelId)
}

/** Structured log helper. */
export function structLog(
  level: 'info' | 'error',
  requestId: string,
  event: string,
  extra: Record<string, unknown> = {},
) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    request_id: requestId,
    event,
    ...extra,
  }))
}

/** Sanitize error messages: strip file paths, stack traces, truncate. */
export function sanitizeError(message: string): string {
  // Match path:line and path:line:column formats (Unix and Windows)
  let clean = message.replace(/\/[^\s:]+\.[jt]s:\d+(:\d+)?/g, '[internal]')
  clean = clean.replace(/[A-Z]:\\[^\s:]+\.[jt]s:\d+(:\d+)?/g, '[internal]')
  clean = clean.replace(/\n\s+at\s.+/g, '')
  if (clean.length > 500) {
    clean = clean.slice(0, 500) + '...'
  }
  return clean.trim()
}

export interface StreamRouteOptions {
  /** Hono context */
  c: Context
  /** Route name for logging (e.g. 'chat', 'complete', 'transform') */
  routeName: string
  /** Provider config — model init happens inside SSE for consistent error format */
  provider: ProviderConfig
  /** Model ID to use */
  modelId: string
  /** streamText options (messages, temperature, etc.) — model is injected automatically */
  streamTextOptions: Omit<Parameters<typeof streamText>[0], 'model' | 'abortSignal'>
  /** Extra fields to include in the done event (e.g. tool_calls) */
  buildDoneExtra?: (result: Awaited<ReturnType<typeof streamText>>) => Record<string, unknown>
  /** Extra log fields for the start event */
  startLogExtra?: Record<string, unknown>
  /** Called on each step finish (for tool call events in chat) */
  onStepFinish?: Parameters<typeof streamText>[0]['onStepFinish']
  /** Optional concurrency limiter — release is called when stream ends */
  concurrencyLimiter?: ConcurrencyLimiter
}

/**
 * Run a streamText route with standard SSE event contract.
 *
 * All errors (including provider init) are returned as SSE error events.
 * Error messages sent to clients are sanitized.
 */
export function streamTextRoute(opts: StreamRouteOptions) {
  const { c, routeName, provider, modelId, streamTextOptions, buildDoneExtra, startLogExtra, onStepFinish, concurrencyLimiter } = opts
  const requestId = (c.get('requestId') as string) ?? ''
  const startMs = Date.now()

  // Check concurrency limit before starting stream
  if (concurrencyLimiter && !concurrencyLimiter.tryAcquire()) {
    return c.json({
      error: `Too many concurrent requests. Please wait for current requests to complete.`,
      retry_after_seconds: 2,
    }, 429)
  }

  structLog('info', requestId, `${routeName}.start`, startLogExtra ?? {})

  return streamSSE(c, async (stream) => {
    try {
      // Provider init inside SSE so errors are SSE events, not bare JSON
      const model = initModel(provider, modelId)

      const result = streamText({
        ...streamTextOptions,
        model,
        abortSignal: c.req.raw.signal,
        onStepFinish,
      } as any)

      // Stream text deltas
      let fullText = ''
      for await (const delta of result.textStream) {
        if (delta) {
          fullText += delta
          await stream.writeSSE({
            data: JSON.stringify({ type: 'text_delta', content: delta }),
          })
        }
      }

      // Wait for full result
      const finalResult = await result
      const durationMs = Date.now() - startMs

      structLog('info', requestId, `${routeName}.done`, {
        duration_ms: durationMs,
        text_length: fullText.length,
        steps: (finalResult as any).steps?.length,
      })

      // Build done event
      const doneExtra = buildDoneExtra ? buildDoneExtra(finalResult) : {}
      await stream.writeSSE({
        data: JSON.stringify({
          type: 'done',
          content: fullText,
          ...doneExtra,
        }),
      })
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      const isAbort = err instanceof Error && err.name === 'AbortError'

      // Full error logged server-side
      if (!isAbort) {
        structLog('error', requestId, `${routeName}.error`, {
          error: rawMessage,
          duration_ms: Date.now() - startMs,
        })
      }

      // Sanitized error sent to client
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: sanitizeError(rawMessage) }),
      })
    } finally {
      concurrencyLimiter?.release()
    }
  })
}
