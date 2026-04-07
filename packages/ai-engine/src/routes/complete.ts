/**
 * POST /api/complete — Inline editor completion (SSE streaming).
 *
 * Uses streamText() without tools — optimized for low TTFT.
 *
 * SSE Event Types:
 *   data: {"type":"text_delta","content":"..."}
 *   data: {"type":"done","content":"..."}
 *   data: {"type":"error","message":"..."}
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { streamText } from 'ai'
import { ProviderManager } from '../provider.js'
import type { ProviderConfig, ModelParameters, Message } from '../types.js'

interface CompleteRequest {
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
}

export function completeRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<CompleteRequest>()

    if (!body.provider || !body.parameters || !body.systemPrompt || !body.messages) {
      return c.json({ error: 'Missing required fields: provider, parameters, systemPrompt, messages' }, 400)
    }

    const providerManager = new ProviderManager()
    providerManager.addProvider(body.provider)
    const sdk = providerManager.createSDK(body.provider.id)
    const model = sdk(body.parameters.model)

    const allMessages = [
      { role: 'system' as const, content: body.systemPrompt },
      ...body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ]

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      event: 'complete.start',
      provider: body.provider.id,
      model: body.parameters.model,
    }))

    const startMs = Date.now()

    return streamSSE(c, async (stream) => {
      try {
        const result = streamText({
          model,
          messages: allMessages as any,
          maxSteps: 1, // No tool calling for completions
          temperature: body.parameters.temperature,
          topP: body.parameters.topP,
          maxTokens: body.parameters.maxTokens,
          abortSignal: c.req.raw.signal,
        })

        let fullText = ''
        for await (const delta of result.textStream) {
          if (delta) {
            fullText += delta
            await stream.writeSSE({
              data: JSON.stringify({ type: 'text_delta', content: delta }),
            })
          }
        }

        const durationMs = Date.now() - startMs
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          request_id: requestId,
          event: 'complete.done',
          duration_ms: durationMs,
          text_length: fullText.length,
        }))

        await stream.writeSSE({
          data: JSON.stringify({ type: 'done', content: fullText }),
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            request_id: requestId,
            event: 'complete.error',
            error: message,
          }))
        }
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message }),
        })
      }
    })
  })

  return route
}
