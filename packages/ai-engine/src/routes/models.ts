/**
 * POST /api/models — Fetch available models from a provider.
 * Proxies the OpenAI-compatible /models endpoint.
 * Uses POST because the request body contains the API key.
 */
import { Hono } from 'hono'
import { fetchModels } from '../models.js'
import { structLog, sanitizeError } from '../core/stream-helpers.js'

const MODELS_FETCH_TIMEOUT_MS = 15_000 // 15 seconds

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

    structLog('info', requestId, 'models.start', { baseURL: body.baseURL })

    try {
      const startMs = Date.now()

      // Apply timeout to prevent slow upstream from hanging forever
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS)

      let models: string[]
      try {
        models = await Promise.race([
          fetchModels(body.baseURL, body.apiKey, body.providerType),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error(`Models fetch timed out after ${MODELS_FETCH_TIMEOUT_MS / 1000}s`))
            })
          }),
        ])
      } finally {
        clearTimeout(timeoutId)
      }

      structLog('info', requestId, 'models.done', {
        duration_ms: Date.now() - startMs,
        model_count: models.length,
      })

      return c.json({ type: 'models_result', models, request_id: requestId })
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : String(err)
      structLog('error', requestId, 'models.error', { error: rawMessage })
      return c.json({ error: sanitizeError(rawMessage), request_id: requestId }, 502)
    }
  })

  return route
}
