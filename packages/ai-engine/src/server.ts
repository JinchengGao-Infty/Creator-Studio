/**
 * AI Engine HTTP Daemon — Hono server entry point
 *
 * Replaces the old one-shot JSONL CLI with a long-running HTTP server.
 * Communication with Rust layer via HTTP/SSE on localhost.
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { logger } from 'hono/logger'
import { authMiddleware } from './middleware/auth.js'
import { bodyLimitMiddleware } from './middleware/body-limit.js'
import { concurrencyMiddleware } from './middleware/concurrency.js'
import { errorMiddleware } from './middleware/error.js'
import { requestIdMiddleware } from './middleware/request-id.js'
import { healthRoute } from './routes/health.js'
import { compactRoute } from './routes/compact.js'
import { chatRoute } from './routes/chat.js'
import { completeRoute } from './routes/complete.js'
import { extractRoute } from './routes/extract.js'
import { transformRoute } from './routes/transform.js'
import { modelsRoute } from './routes/models.js'

const PROTOCOL_VERSION = '2.0'

export function createApp(sharedSecret?: string) {
  const app = new Hono()

  // Global middleware — order matters:
  // 1. Request ID first (needed by all subsequent middleware/routes)
  // 2. Error handler wraps everything
  // 3. Auth BEFORE body limit (reject unauthenticated before reading body)
  // 4. Body limit after auth (prevents DoS from authenticated-only routes)
  app.use('*', requestIdMiddleware())
  app.use('*', errorMiddleware())
  if (sharedSecret) {
    app.use('/api/*', authMiddleware(sharedSecret))
  }
  app.use('/api/*', bodyLimitMiddleware())

  // Concurrency limit for streaming routes (3 concurrent max)
  const streamingRoutes = ['/api/chat', '/api/complete', '/api/transform']
  for (const path of streamingRoutes) {
    app.use(`${path}/*`, concurrencyMiddleware())
  }

  // Routes
  app.route('/health', healthRoute(PROTOCOL_VERSION))
  app.route('/api/chat', chatRoute())
  app.route('/api/complete', completeRoute())
  app.route('/api/extract', extractRoute())
  app.route('/api/transform', transformRoute())
  app.route('/api/compact', compactRoute())
  app.route('/api/models', modelsRoute())

  return app
}

export function startServer(options: { port?: number; sharedSecret?: string } = {}) {
  const port = options.port ?? 0
  const app = createApp(options.sharedSecret)

  return new Promise<{ port: number; close: () => void }>((resolve) => {
    const server = serve(
      { fetch: app.fetch, port, hostname: '127.0.0.1' },
      (info) => {
        const actualPort = info.port
        // Signal the port to the parent process (Rust) via stdout first line
        process.stdout.write(JSON.stringify({ port: actualPort, version: PROTOCOL_VERSION }) + '\n')
        resolve({ port: actualPort, close: () => server.close() })
      },
    )
  })
}

// Direct execution: start the server
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const sharedSecret = process.env.CREATORAI_SHARED_SECRET
  const port = parseInt(process.env.CREATORAI_PORT ?? '0', 10)

  startServer({ port, sharedSecret }).then(({ port: actualPort }) => {
    console.error(`[ai-engine] HTTP daemon listening on 127.0.0.1:${actualPort}`)
  })
}
