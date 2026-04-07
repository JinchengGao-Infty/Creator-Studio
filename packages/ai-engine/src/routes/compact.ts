/**
 * POST /api/compact — Context compaction (non-streaming).
 * Takes conversation messages and returns a compressed summary.
 */
import { Hono } from 'hono'
import { generateCompactSummary } from '../compact.js'
import type { ProviderConfig, ModelParameters, Message } from '../types.js'

interface CompactRequest {
  provider: ProviderConfig
  parameters: ModelParameters
  messages: Message[]
}

export function compactRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<CompactRequest>()

    if (!body.provider || !body.parameters || !body.messages?.length) {
      return c.json({ error: 'Missing required fields: provider, parameters, messages' }, 400)
    }

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      event: 'compact.start',
      provider: body.provider.id,
      model: body.parameters.model,
      message_count: body.messages.length,
    }))

    const startMs = Date.now()

    try {
      const summary = await generateCompactSummary({
        provider: body.provider,
        parameters: body.parameters,
        messages: body.messages,
      })

      const durationMs = Date.now() - startMs
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        request_id: requestId,
        event: 'compact.done',
        duration_ms: durationMs,
        summary_length: summary.length,
      }))

      return c.json({ type: 'done', content: summary, request_id: requestId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        request_id: requestId,
        event: 'compact.error',
        error: message,
        duration_ms: Date.now() - startMs,
      }))
      return c.json({ error: message, request_id: requestId }, 500)
    }
  })

  return route
}
