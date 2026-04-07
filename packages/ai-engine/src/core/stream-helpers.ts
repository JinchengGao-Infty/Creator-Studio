/**
 * Shared SSE streaming helpers.
 *
 * Eliminates boilerplate across chat/complete/transform routes:
 * - Provider initialization with error handling
 * - streamText → SSE text_delta/done/error event flow
 * - Structured logging with request_id and duration
 * - Abort-safe error reporting
 */
import { streamSSE } from 'hono/streaming'
import { streamText, type StreamTextResult } from 'ai'
import { ProviderManager } from '../provider.js'
import type { Context } from 'hono'
import type { ProviderConfig } from '../types.js'

/** Initialize a provider SDK model, returning a structured error on failure. */
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

export interface StreamRouteOptions {
  /** Hono context */
  c: Context
  /** Route name for logging (e.g. 'chat', 'complete', 'transform') */
  routeName: string
  /** streamText options (model, messages, etc.) — passed directly to Vercel AI SDK */
  streamTextOptions: Parameters<typeof streamText>[0]
  /** Extra fields to include in the done event (e.g. tool_calls) */
  buildDoneExtra?: (result: Awaited<ReturnType<typeof streamText>>) => Record<string, unknown>
  /** Extra log fields for the start event */
  startLogExtra?: Record<string, unknown>
  /** Called on each step finish (for tool call events in chat) */
  onStepFinish?: Parameters<typeof streamText>[0]['onStepFinish']
}

/**
 * Run a streamText route with standard SSE event contract.
 *
 * Handles:
 * 1. Provider init errors → SSE error event (not bare JSON)
 * 2. text_delta events for each token
 * 3. done event with full content
 * 4. error event for failures (skips AbortError logging)
 * 5. Structured logging for start/done/error
 */
export function streamTextRoute(opts: StreamRouteOptions) {
  const { c, routeName, streamTextOptions, buildDoneExtra, startLogExtra, onStepFinish } = opts
  const requestId = (c.get('requestId') as string) ?? ''
  const startMs = Date.now()

  structLog('info', requestId, `${routeName}.start`, startLogExtra ?? {})

  return streamSSE(c, async (stream) => {
    try {
      const result = streamText({
        ...streamTextOptions,
        abortSignal: c.req.raw.signal,
        onStepFinish,
      })

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
      const message = err instanceof Error ? err.message : String(err)
      const isAbort = err instanceof Error && err.name === 'AbortError'

      if (!isAbort) {
        structLog('error', requestId, `${routeName}.error`, {
          error: message,
          duration_ms: Date.now() - startMs,
        })
      }

      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message }),
      })
    }
  })
}
