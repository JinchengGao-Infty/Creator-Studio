/**
 * POST /api/transform — Text polish/expand/condense/restyle (SSE streaming).
 * Phase 3 implementation — currently returns 501.
 */
import { Hono } from 'hono'

export function transformRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    return c.json({ error: 'Not implemented yet — use legacy JSONL endpoint' }, 501)
  })

  return route
}
