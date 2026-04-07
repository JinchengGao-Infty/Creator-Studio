/**
 * Concurrency control middleware.
 *
 * Limits the number of active SSE streams to prevent resource exhaustion.
 * Desktop single-user scenario: 3 concurrent streams is sufficient
 * (1 chat + 1 complete + 1 transform).
 *
 * Returns 429 with Retry-After when limit is exceeded.
 */
import { createMiddleware } from 'hono/factory'

const DEFAULT_MAX_CONCURRENT = 3

interface ConcurrencyState {
  active: number
  max: number
}

export function concurrencyMiddleware(maxConcurrent: number = DEFAULT_MAX_CONCURRENT) {
  const state: ConcurrencyState = { active: 0, max: maxConcurrent }

  const middleware = createMiddleware(async (c, next) => {
    if (state.active >= state.max) {
      return c.json(
        {
          error: `Too many concurrent requests (${state.active}/${state.max}). Please wait for current requests to complete.`,
          retry_after_seconds: 2,
        },
        429,
      )
    }

    state.active++
    try {
      await next()
    } finally {
      state.active--
    }
  })

  // Expose state for testing and health reporting
  return Object.assign(middleware, {
    getState: () => ({ ...state }),
  })
}
