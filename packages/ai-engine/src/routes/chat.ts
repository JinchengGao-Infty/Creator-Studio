/**
 * POST /api/chat — Chat with tool calling (SSE streaming).
 * Phase 2 implementation — currently returns 501.
 */
import { Hono } from 'hono'

export function chatRoute() {
  const route = new Hono()

  route.post('/', async (c) => {
    // TODO: Phase 2 — implement streamText + SSE + tool-bridge
    return c.json({ error: 'Not implemented yet — use legacy JSONL endpoint' }, 501)
  })

  return route
}
