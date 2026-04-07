/**
 * GET /api/models — Fetch available models from provider.
 * Phase 3 implementation — currently returns 501.
 */
import { Hono } from 'hono'

export function modelsRoute() {
  const route = new Hono()

  route.get('/', async (c) => {
    return c.json({ error: 'Not implemented yet — use legacy JSONL endpoint' }, 501)
  })

  return route
}
