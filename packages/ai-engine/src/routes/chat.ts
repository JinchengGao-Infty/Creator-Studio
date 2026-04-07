/**
 * POST /api/chat — Chat with tool calling (SSE streaming).
 *
 * Uses Vercel AI SDK streamText() for real token-by-token streaming.
 * Tool execution is delegated to the Rust layer via HTTP callback.
 *
 * SSE Event Types:
 *   data: {"type":"text_delta","content":"..."}
 *   data: {"type":"tool_call_start","id":"...","name":"...","args":{...}}
 *   data: {"type":"tool_call_end","id":"...","result":"..."}
 *   data: {"type":"done","content":"...","tool_calls":[...]}
 *   data: {"type":"error","message":"..."}
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { streamText } from 'ai'
import { ProviderManager } from '../provider.js'
import { getToolsForSDK } from '../tools.js'
import type { ProviderConfig, ModelParameters, Message, ToolCallRequest, ToolCallResult } from '../types.js'

interface ChatRequest {
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
  // Tool execution callback URL (Rust tool server)
  toolCallbackUrl?: string
  toolCallbackSecret?: string
  // Mode controls
  mode?: 'discussion' | 'continue'
  allowWrite?: boolean
}

export function chatRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<ChatRequest>()

    if (!body.provider || !body.parameters || !body.systemPrompt || !body.messages) {
      return c.json({ error: 'Missing required fields: provider, parameters, systemPrompt, messages' }, 400)
    }

    const providerManager = new ProviderManager()
    providerManager.addProvider(body.provider)
    const sdk = providerManager.createSDK(body.provider.id)
    const model = sdk(body.parameters.model)

    // Build tool execution callback (pass request abort signal for cleanup on disconnect)
    const executeTools = body.toolCallbackUrl
      ? createToolCallback(body.toolCallbackUrl, body.toolCallbackSecret, requestId, c.req.raw.signal)
      : undefined

    const allMessages = [
      { role: 'system' as const, content: body.systemPrompt },
      ...body.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system' | 'tool',
        content: m.content,
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      })),
    ]

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      event: 'chat.start',
      provider: body.provider.id,
      model: body.parameters.model,
      message_count: body.messages.length,
      mode: body.mode ?? 'discussion',
    }))

    const startMs = Date.now()

    return streamSSE(c, async (stream) => {
      try {
        const result = streamText({
          model,
          messages: allMessages as any,
          tools: executeTools ? getToolsForSDK(executeTools) as any : undefined,
          maxSteps: 10,
          temperature: body.parameters.temperature,
          topP: body.parameters.topP,
          maxTokens: body.parameters.maxTokens,
          abortSignal: c.req.raw.signal,
          onStepFinish: async (step) => {
            // Report tool calls as they happen
            if (step.toolCalls?.length) {
              for (const tc of step.toolCalls) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: 'tool_call_start',
                    id: (tc as any).toolCallId ?? '',
                    name: (tc as any).toolName ?? '',
                    args: (tc as any).args ?? {},
                  }),
                })
              }
            }
            if (step.toolResults?.length) {
              for (const tr of step.toolResults) {
                await stream.writeSSE({
                  data: JSON.stringify({
                    type: 'tool_call_end',
                    id: (tr as any).toolCallId ?? '',
                    result: typeof (tr as any).result === 'string'
                      ? (tr as any).result
                      : JSON.stringify((tr as any).result),
                  }),
                })
              }
            }
          },
        })

        // Stream text deltas
        const textStream = result.textStream
        let fullText = ''
        for await (const delta of textStream) {
          if (delta) {
            fullText += delta
            await stream.writeSSE({
              data: JSON.stringify({ type: 'text_delta', content: delta }),
            })
          }
        }

        // Wait for full result to get final tool calls
        const finalResult = await result

        const durationMs = Date.now() - startMs
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          request_id: requestId,
          event: 'chat.done',
          duration_ms: durationMs,
          text_length: fullText.length,
          steps: finalResult.steps?.length ?? 0,
        }))

        // Send done event
        const toolCalls = Array.isArray(finalResult.toolCalls)
          ? finalResult.toolCalls.map((tc: any) => ({
              id: tc.toolCallId ?? '',
              name: tc.toolName ?? '',
              args: tc.args ?? {},
            }))
          : []

        await stream.writeSSE({
          data: JSON.stringify({
            type: 'done',
            content: fullText,
            tool_calls: toolCalls,
          }),
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)

        // Don't log abort errors (user cancelled)
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.error(JSON.stringify({
            ts: new Date().toISOString(),
            level: 'error',
            request_id: requestId,
            event: 'chat.error',
            error: message,
            duration_ms: Date.now() - startMs,
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

/**
 * Create a tool execution callback that calls the Rust tool server via HTTP.
 */
function createToolCallback(
  callbackUrl: string,
  secret: string | undefined,
  requestId: string,
  parentSignal?: AbortSignal,
): (calls: ToolCallRequest[]) => Promise<ToolCallResult[]> {
  return async (calls) => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    }
    if (secret) {
      headers['Authorization'] = `Bearer ${secret}`
    }

    const results: ToolCallResult[] = []
    // Execute tools sequentially (maintain order, avoid overwhelming Rust)
    for (const call of calls) {
      try {
        const startMs = Date.now()
        const timeoutController = new AbortController()
        const timeoutId = setTimeout(() => timeoutController.abort(), 30_000) // 30s per tool

        // Combine parent abort signal (client disconnect) with per-tool timeout
        const combinedSignal = parentSignal
          ? AbortSignal.any([parentSignal, timeoutController.signal])
          : timeoutController.signal

        let res: Response
        try {
          res = await fetch(callbackUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ id: call.id, name: call.name, args: call.args }),
            signal: combinedSignal,
          })
        } finally {
          clearTimeout(timeoutId)
        }

        if (!res!.ok) {
          const errText = await res!.text()
          results.push({ id: call.id, result: '', error: `Tool server error ${res!.status}: ${errText}` })
          continue
        }

        const data = await res!.json() as { result?: string; error?: string }
        const durationMs = Date.now() - startMs

        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          request_id: requestId,
          event: 'tool_callback.done',
          tool_name: call.name,
          tool_call_id: call.id,
          duration_ms: durationMs,
          has_error: !!data.error,
        }))

        results.push({
          id: call.id,
          result: data.result ?? '',
          error: data.error,
        })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ id: call.id, result: '', error: `Tool callback failed: ${msg}` })
      }
    }

    return results
  }
}
