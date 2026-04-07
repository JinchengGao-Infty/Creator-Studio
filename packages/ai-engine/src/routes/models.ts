/**
 * GET /api/models — Fetch available models from a provider.
 * Proxies the OpenAI-compatible /models endpoint.
 */
import { Hono } from 'hono'
import { fetchModels } from '../models.js'

interface ModelsQuery {
  baseURL: string
  apiKey: string
  providerType?: string
}

export function modelsRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    const requestId = c.get('requestId') as string
    const body = await c.req.json<ModelsQuery>()

    if (!body.baseURL || !body.apiKey) {
      return c.json({ error: 'Missing required fields: baseURL, apiKey' }, 400)
    }

    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'info',
      request_id: requestId,
      event: 'models.start',
      baseURL: body.baseURL,
    }))

    try {
      const startMs = Date.now()
      const models = await fetchModels(body.baseURL, body.apiKey, body.providerType)
      const durationMs = Date.now() - startMs

      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'info',
        request_id: requestId,
        event: 'models.done',
        duration_ms: durationMs,
        model_count: models.length,
      }))

      return c.json({ type: 'models_result', models, request_id: requestId })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        request_id: requestId,
        event: 'models.error',
        error: message,
      }))
      return c.json({ error: message, request_id: requestId }, 502)
    }
  })

  return route
}
