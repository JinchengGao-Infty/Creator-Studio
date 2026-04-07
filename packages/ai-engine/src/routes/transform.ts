/**
 * POST /api/transform — Text polish/expand/condense/restyle (SSE streaming).
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
import type { ProviderConfig, ModelParameters } from '../types.js'

type TransformAction = 'polish' | 'expand' | 'condense' | 'restyle'

const SYSTEM_PROMPTS: Record<TransformAction, string> = {
  polish: `你是一位专业的小说编辑。对用户提供的文本进行润色，改善文笔和表达，保持原意不变。
要求：
- 只输出润色后的文本，不要输出解释或说明
- 保持原文的人称、时态、语气
- 修正病句、提升文采、改善节奏感
- 不要大幅改变情节或增删内容`,
  expand: `你是一位专业的小说作家。对用户提供的文本进行扩写，丰富细节和描写。
要求：
- 只输出扩写后的文本，不要输出解释或说明
- 保持原文的人称、时态、语气和情节走向
- 增加环境描写、心理活动、对话细节
- 扩写幅度约为原文的 1.5-2 倍`,
  condense: `你是一位专业的小说编辑。对用户提供的文本进行缩写，精炼表达。
要求：
- 只输出缩写后的文本，不要输出解释或说明
- 保留关键情节和信息
- 删减冗余描写、重复内容
- 缩写幅度约为原文的 50-70%`,
  restyle: `你是一位专业的小说作家。将用户提供的文本改写为指定风格。
要求：
- 只输出改写后的文本，不要输出解释或说明
- 保持原文的情节和人物不变
- 按照用户指定的风格进行改写`,
}

interface TransformRequest {
  provider: ProviderConfig
  parameters: ModelParameters
  text: string
  action?: TransformAction
  style?: string
}

export function transformRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<TransformRequest>()

    if (!body.provider || !body.parameters || !body.text) {
      return c.json({ error: 'Missing required fields: provider, parameters, text' }, 400)
    }

    const action = body.action ?? 'polish'
    const providerManager = new ProviderManager()
    providerManager.addProvider(body.provider)
    const sdk = providerManager.createSDK(body.provider.id)
    const model = sdk(body.parameters.model)

    let systemPrompt = SYSTEM_PROMPTS[action] ?? SYSTEM_PROMPTS.polish
    if (action === 'restyle' && body.style) {
      systemPrompt += `\n\n目标风格：${body.style}`
    }

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      event: 'transform.start',
      action,
      text_length: body.text.length,
    }))

    const startMs = Date.now()

    return streamSSE(c, async (stream) => {
      try {
        const result = streamText({
          model,
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: body.text },
          ] as any,
          maxSteps: 1,
          temperature: action === 'polish' ? 0.3 : 0.7,
          maxTokens: body.parameters.maxTokens ?? 4000,
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

        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          request_id: requestId,
          event: 'transform.done',
          duration_ms: Date.now() - startMs,
          output_length: fullText.length,
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
            event: 'transform.error',
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
