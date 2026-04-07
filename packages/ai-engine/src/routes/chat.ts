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
import { initModel, structLog, sanitizeError } from '../core/stream-helpers.js'
import { streamText } from 'ai'
import { getToolsForSDK } from '../tools.js'
import type { ConcurrencyLimiter } from '../middleware/concurrency.js'
import type { ProviderConfig, ModelParameters, Message, ToolCallRequest, ToolCallResult } from '../types.js'

interface ChatRequest {
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
  toolCallbackUrl?: string
  toolCallbackSecret?: string
  mode?: 'discussion' | 'continue'
  allowWrite?: boolean
}

export function chatRoute(limiter?: ConcurrencyLimiter) {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<ChatRequest>()

    if (!body.provider || !body.parameters || !body.systemPrompt || !body.messages) {
      return c.json({ error: 'Missing required fields: provider, parameters, systemPrompt, messages' }, 400)
    }

    // Concurrency check before starting stream
    if (limiter && !limiter.tryAcquire()) {
      return c.json({
        error: 'Too many concurrent requests. Please wait for current requests to complete.',
        retry_after_seconds: 2,
      }, 429)
    }

    // Validate toolCallbackUrl is localhost only (prevent SSRF)
    if (body.toolCallbackUrl) {
      try {
        const cbUrl = new URL(body.toolCallbackUrl)
        if (cbUrl.hostname !== 'localhost' && cbUrl.hostname !== '127.0.0.1') {
          return c.json({ error: 'toolCallbackUrl must be localhost or 127.0.0.1' }, 400)
        }
      } catch {
        return c.json({ error: 'Invalid toolCallbackUrl' }, 400)
      }
    }

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

    structLog('info', requestId, 'chat.start', {
      provider: body.provider.id,
      model: body.parameters.model,
      message_count: body.messages.length,
      mode: body.mode ?? 'discussion',
    })

    const startMs = Date.now()

    return streamSSE(c, async (stream) => {
      try {
        // Provider init inside SSE for consistent error format
        const model = initModel(body.provider, body.parameters.model)

        const result = streamText({
          model,
          messages: allMessages as any,
          tools: executeTools ? getToolsForSDK(executeTools) as any : undefined,
          maxSteps: 10,
          temperature: body.parameters.temperature,
          topP: body.parameters.topP,
          maxTokens: body.parameters.maxTokens,
          abortSignal: c.req.raw.signal,
          // Note: onStepFinish fires after each step completes (including tool execution).
          // tool_call_start and tool_call_end events are batched per step, not real-time.
          // This is a Vercel AI SDK limitation — real-time events require intercepting
          // the tool execute callback directly (which we do via createToolCallback).
          onStepFinish: async (step) => {
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

        let fullText = ''
        for await (const delta of result.textStream) {
          if (delta) {
            fullText += delta
            await stream.writeSSE({
              data: JSON.stringify({ type: 'text_delta', content: delta }),
            })
          }
        }

        const finalResult = await result
        const durationMs = Date.now() - startMs

        structLog('info', requestId, 'chat.done', {
          duration_ms: durationMs,
          text_length: fullText.length,
          steps: finalResult.steps?.length ?? 0,
        })

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
        const rawMessage = err instanceof Error ? err.message : String(err)
        const isAbort = err instanceof Error && err.name === 'AbortError'

        if (!isAbort) {
          structLog('error', requestId, 'chat.error', {
            error: rawMessage,
            duration_ms: Date.now() - startMs,
          })
        }

        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', message: sanitizeError(rawMessage) }),
        })
      } finally {
        limiter?.release()
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
    for (const call of calls) {
      try {
        const startMs = Date.now()
        const timeoutController = new AbortController()
        const timeoutId = setTimeout(() => timeoutController.abort(), 30_000)

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

        structLog('info', requestId, 'tool_callback.done', {
          tool_name: call.name,
          tool_call_id: call.id,
          duration_ms: durationMs,
          has_error: !!data.error,
        })

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
