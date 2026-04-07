/**
 * POST /api/extract — Worldbuilding extraction (JSON response).
 * Phase 3 implementation — currently returns 501.
 */
import { Hono } from 'hono'

export function extractRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    return c.json({ error: 'Not implemented yet — use legacy JSONL endpoint' }, 501)
  })

  return route
}
