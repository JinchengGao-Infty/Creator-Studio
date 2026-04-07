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
import { initModel, streamTextRoute } from '../core/stream-helpers.js'
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
    const body = await c.req.json<CompleteRequest>()

    if (!body.provider || !body.parameters || !body.systemPrompt || !body.messages) {
      return c.json({ error: 'Missing required fields: provider, parameters, systemPrompt, messages' }, 400)
    }

    const model = initModel(body.provider, body.parameters.model)

    const allMessages = [
      { role: 'system' as const, content: body.systemPrompt },
      ...body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ]

    return streamTextRoute({
      c,
      routeName: 'complete',
      streamTextOptions: {
        model,
        messages: allMessages as any,
        maxSteps: 1,
        temperature: body.parameters.temperature,
        topP: body.parameters.topP,
        maxTokens: body.parameters.maxTokens,
      },
      startLogExtra: {
        provider: body.provider.id,
        model: body.parameters.model,
      },
    })
  })

  return route
}
