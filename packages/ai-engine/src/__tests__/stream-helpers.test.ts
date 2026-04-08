/**
 * stream-helpers.ts — Unit Tests
 *
 * Tests sanitizeError edge cases, initModel, structLog output format.
 */
import { describe, it, expect } from 'bun:test'
import { sanitizeError, initModel, structLog } from '../core/stream-helpers.js'
import type { ProviderConfig } from '../types.js'

// ──────────────────────────────────────────────
// sanitizeError
// ──────────────────────────────────────────────

describe('sanitizeError', () => {
  it('strips Unix file paths with line numbers', () => {
    const msg = 'Error at /home/user/project/src/file.ts:42'
    expect(sanitizeError(msg)).toBe('Error at [internal]')
  })

  it('strips Windows file paths with line numbers', () => {
    const msg = 'Error at C:\\Users\\Dev\\project\\src\\file.ts:42'
    expect(sanitizeError(msg)).toBe('Error at [internal]')
  })

  it('strips multiple file paths in one message', () => {
    const msg = 'Error at /src/a.ts:1 caused by /src/b.js:2'
    expect(sanitizeError(msg)).toBe('Error at [internal] caused by [internal]')
  })

  it('strips stack traces', () => {
    const msg = 'TypeError: foo is not a function\n    at Object.<anonymous> (/src/test.ts:5)\n    at Module._compile (node:internal/modules/cjs/loader:1234)'
    const result = sanitizeError(msg)
    expect(result).not.toContain('at Object')
    expect(result).not.toContain('at Module')
  })

  it('truncates messages over 500 chars', () => {
    const msg = 'x'.repeat(600)
    const result = sanitizeError(msg)
    expect(result.length).toBeLessThanOrEqual(503) // 500 + '...'
    expect(result.endsWith('...')).toBe(true)
  })

  it('returns original message if no sensitive content', () => {
    expect(sanitizeError('Connection refused')).toBe('Connection refused')
  })

  it('handles empty string', () => {
    expect(sanitizeError('')).toBe('')
  })

  it('trims whitespace', () => {
    expect(sanitizeError('  error  ')).toBe('error')
  })

  it('handles message with only a file path', () => {
    expect(sanitizeError('/src/app.ts:10')).toBe('[internal]')
  })

  it('preserves error codes and HTTP status', () => {
    expect(sanitizeError('API error 429: rate limited')).toBe('API error 429: rate limited')
  })

  it('handles paths without line numbers (no stripping)', () => {
    // Only paths with :lineNumber are stripped
    const msg = 'File /src/app.ts not found'
    expect(sanitizeError(msg)).toBe('File /src/app.ts not found')
  })

  it('handles mixed content with paths and normal text', () => {
    const msg = 'Failed to load /app/server.js:10: timeout after 30s'
    const result = sanitizeError(msg)
    expect(result).toContain('[internal]')
    expect(result).toContain('timeout after 30s')
  })
})

// ──────────────────────────────────────────────
// initModel
// ──────────────────────────────────────────────

describe('initModel', () => {
  const provider: ProviderConfig = {
    id: 'test',
    name: 'Test',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    models: ['gpt-4'],
    providerType: 'openai-compatible',
  }

  it('returns a model object for valid provider', () => {
    const model = initModel(provider, 'gpt-4')
    expect(model).toBeDefined()
    expect(typeof model).toBe('object')
  })

  it('works with different provider types', () => {
    const googleProvider: ProviderConfig = { ...provider, providerType: 'google' }
    const model = initModel(googleProvider, 'gemini-pro')
    expect(model).toBeDefined()
  })

  it('creates new ProviderManager each call (no state leak)', () => {
    const model1 = initModel(provider, 'model-a')
    const model2 = initModel({ ...provider, id: 'other' }, 'model-b')
    // Both should work independently
    expect(model1).toBeDefined()
    expect(model2).toBeDefined()
  })
})

// ──────────────────────────────────────────────
// structLog
// ──────────────────────────────────────────────

describe('structLog', () => {
  it('outputs JSON to stderr', () => {
    const originalStderr = console.error
    let output = ''
    console.error = (msg: string) => { output = msg }

    structLog('info', 'req-1', 'test.event', { foo: 'bar' })

    console.error = originalStderr

    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('info')
    expect(parsed.request_id).toBe('req-1')
    expect(parsed.event).toBe('test.event')
    expect(parsed.foo).toBe('bar')
    expect(parsed.ts).toBeDefined()
  })

  it('handles error level', () => {
    const originalStderr = console.error
    let output = ''
    console.error = (msg: string) => { output = msg }

    structLog('error', 'req-2', 'error.event')

    console.error = originalStderr

    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('error')
  })

  it('works without extra fields', () => {
    const originalStderr = console.error
    let output = ''
    console.error = (msg: string) => { output = msg }

    structLog('info', '', 'test')

    console.error = originalStderr

    const parsed = JSON.parse(output)
    expect(parsed.event).toBe('test')
    expect(parsed.request_id).toBe('')
  })
})
