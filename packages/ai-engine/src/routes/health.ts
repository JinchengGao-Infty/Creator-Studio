/**
 * Health check endpoint.
 * Returns daemon status, version, and basic metrics.
 */
import { Hono } from 'hono'

const startTime = Date.now()

export function healthRoute(protocolVersion: string) {
  const route = new Hono()

  route.get('/', (c) => {
    const uptimeMs = Date.now() - startTime
    const memUsage = process.memoryUsage()

    return c.json({
      status: 'ok',
      version: protocolVersion,
      uptime_ms: uptimeMs,
      memory: {
        rss_bytes: memUsage.rss,
        heap_used_bytes: memUsage.heapUsed,
        heap_total_bytes: memUsage.heapTotal,
      },
      pid: process.pid,
    })
  })

  return route
}
