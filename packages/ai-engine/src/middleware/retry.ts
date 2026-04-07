/**
 * Retry utility for transient LLM API errors.
 *
 * Implements exponential backoff with jitter for:
 * - 429 (rate limit)
 * - 500, 502, 503 (server errors)
 * - Network connection errors
 *
 * NOT a middleware — used as a wrapper around LLM calls.
 */

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  retryableStatusCodes?: number[]
  abortSignal?: AbortSignal
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'abortSignal'>> = {
  maxRetries: 2,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503],
}

/** Check if an error is retryable. */
function isRetryable(err: unknown, retryableStatusCodes: number[]): boolean {
  if (err instanceof Error) {
    // Network errors
    if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED') ||
        err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
      return true
    }
    // Abort errors are never retryable
    if (err.name === 'AbortError') return false
    // Check for status code in error message (Vercel AI SDK pattern)
    for (const code of retryableStatusCodes) {
      if (err.message.includes(`${code}`)) return true
    }
  }
  return false
}

/** Sleep with abort support. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

/** Calculate delay with exponential backoff + jitter. */
function calculateDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const exponential = initialDelayMs * Math.pow(2, attempt)
  const jitter = Math.random() * initialDelayMs
  return Math.min(exponential + jitter, maxDelayMs)
}

/**
 * Execute a function with retry logic.
 *
 * Usage:
 *   const result = await withRetry(() => streamText({...}), { maxRetries: 2 })
 */
export async function withRetry<T>(
  fn: () => T | Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  let lastError: unknown

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err

      if (attempt >= opts.maxRetries || !isRetryable(err, opts.retryableStatusCodes)) {
        throw err
      }

      const delay = calculateDelay(attempt, opts.initialDelayMs, opts.maxDelayMs)
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'warn',
        event: 'retry',
        attempt: attempt + 1,
        max_retries: opts.maxRetries,
        delay_ms: Math.round(delay),
        error: err instanceof Error ? err.message : String(err),
      }))

      await sleep(delay, opts.abortSignal)
    }
  }

  throw lastError
}
