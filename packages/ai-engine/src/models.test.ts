import { describe, expect, test } from 'bun:test'
import { fetchModels } from './models'

describe('fetchModels', () => {
  test('calls /models and returns model ids', async () => {
    let authorization = ''

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        authorization = req.headers.get('authorization') ?? ''

        const url = new URL(req.url)
        if (url.pathname !== '/v1/models') {
          return new Response('not found', { status: 404 })
        }

        return Response.json({
          object: 'list',
          data: [{ id: 'model-1' }, { id: 'model-2' }],
        })
      },
    })

    try {
      const models = await fetchModels(`http://127.0.0.1:${server.port}/v1/`, 'test-key')
      expect(authorization).toBe('Bearer test-key')
      expect(models).toEqual(['model-1', 'model-2'])
    } finally {
      server.stop()
    }
  })
})

