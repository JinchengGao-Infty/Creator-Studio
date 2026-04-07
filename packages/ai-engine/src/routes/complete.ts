/**
 * POST /api/complete — Inline completion (SSE streaming).
 * Phase 2/3 implementation — currently returns 501.
 */
import { Hono } from 'hono'

export function completeRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    return c.json({ error: 'Not implemented yet — use legacy JSONL endpoint' }, 501)
  })

  return route
}
