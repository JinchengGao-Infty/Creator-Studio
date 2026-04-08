/**
 * tools.ts — Unit Tests
 *
 * Tests tool definitions, SDK conversion, execution callback, error handling.
 */
import { describe, it, expect } from 'bun:test'
import { tools, getToolsForSDK } from '../tools.js'
import type { ToolCallRequest, ToolCallResult } from '../types.js'

// ──────────────────────────────────────────────
// Tool definitions
// ──────────────────────────────────────────────

describe('Tool definitions', () => {
  it('has all expected tools', () => {
    const names = tools.map((t) => t.name)
    expect(names).toContain('read')
    expect(names).toContain('write')
    expect(names).toContain('append')
    expect(names).toContain('list')
    expect(names).toContain('search')
    expect(names).toContain('get_chapter_info')
    expect(names).toContain('save_summary')
    expect(names).toContain('rag_search')
  })

  it('every tool has name, description, and parameters', () => {
    for (const t of tools) {
      expect(t.name).toBeTruthy()
      expect(t.description).toBeTruthy()
      expect(t.parameters).toBeDefined()
      expect(t.parameters.type).toBe('object')
    }
  })

  it('read tool requires path parameter', () => {
    const readTool = tools.find((t) => t.name === 'read')!
    expect(readTool.parameters.required).toContain('path')
  })

  it('write tool requires path and content', () => {
    const writeTool = tools.find((t) => t.name === 'write')!
    expect(writeTool.parameters.required).toContain('path')
    expect(writeTool.parameters.required).toContain('content')
  })

  it('search tool requires query', () => {
    const searchTool = tools.find((t) => t.name === 'search')!
    expect(searchTool.parameters.required).toContain('query')
  })

  it('save_summary requires chapterId and summary', () => {
    const saveTool = tools.find((t) => t.name === 'save_summary')!
    expect(saveTool.parameters.required).toContain('chapterId')
    expect(saveTool.parameters.required).toContain('summary')
  })

  it('rag_search requires query', () => {
    const ragTool = tools.find((t) => t.name === 'rag_search')!
    expect(ragTool.parameters.required).toContain('query')
  })

  it('list tool has no required params', () => {
    const listTool = tools.find((t) => t.name === 'list')!
    expect(listTool.parameters.required).toEqual([])
  })

  it('get_chapter_info has no required params', () => {
    const infoTool = tools.find((t) => t.name === 'get_chapter_info')!
    expect(infoTool.parameters.required).toEqual([])
  })
})

// ──────────────────────────────────────────────
// getToolsForSDK without executeTools
// ──────────────────────────────────────────────

describe('getToolsForSDK (no executor)', () => {
  it('returns all tool definitions as SDK format', () => {
    const sdkTools = getToolsForSDK()
    expect(Object.keys(sdkTools)).toHaveLength(8)
    expect(sdkTools.read).toBeDefined()
    expect(sdkTools.write).toBeDefined()
    expect(sdkTools.append).toBeDefined()
    expect(sdkTools.list).toBeDefined()
    expect(sdkTools.search).toBeDefined()
    expect(sdkTools.get_chapter_info).toBeDefined()
    expect(sdkTools.save_summary).toBeDefined()
    expect(sdkTools.rag_search).toBeDefined()
  })

  it('each tool has description and parameters', () => {
    const sdkTools = getToolsForSDK()
    for (const [name, t] of Object.entries(sdkTools)) {
      expect((t as any).description).toBeTruthy()
      expect((t as any).parameters).toBeDefined()
    }
  })
})

// ──────────────────────────────────────────────
// getToolsForSDK with executeTools callback
// ──────────────────────────────────────────────

describe('getToolsForSDK (with executor)', () => {
  it('calls executeTools with correct arguments', async () => {
    const calls: ToolCallRequest[][] = []
    const mockExecutor = async (reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      calls.push(reqs)
      return reqs.map((r) => ({ id: r.id, result: `result-for-${r.name}` }))
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    // Execute the read tool
    const result = await (sdkTools.read as any).execute(
      { path: '/test.txt' },
      { toolCallId: 'tc-1' },
    )
    expect(calls).toHaveLength(1)
    expect(calls[0][0].name).toBe('read')
    expect(calls[0][0].args).toEqual({ path: '/test.txt' })
    expect(calls[0][0].id).toBe('tc-1')
    expect(result).toBe('result-for-read')
  })

  it('generates fallback ID when toolCallId not provided', async () => {
    const calls: ToolCallRequest[][] = []
    const mockExecutor = async (reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      calls.push(reqs)
      return reqs.map((r) => ({ id: r.id, result: 'ok' }))
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    await (sdkTools.search as any).execute({ query: 'test' })
    expect(calls).toHaveLength(1)
    // Fallback ID should contain the tool name
    expect(calls[0][0].id).toContain('search-')
  })

  it('returns error JSON string instead of throwing on tool error', async () => {
    const mockExecutor = async (reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      return [{ id: reqs[0].id, result: '', error: 'File not found' }]
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    const result = await (sdkTools.read as any).execute(
      { path: '/nonexistent.txt' },
      { toolCallId: 'tc-err' },
    )
    // Should NOT throw — error returned as JSON string
    const parsed = JSON.parse(result)
    expect(parsed.error).toBe('File not found')
  })

  it('throws when no result returned for tool call', async () => {
    const mockExecutor = async (_reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      return [] // Empty results
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    expect(
      (sdkTools.read as any).execute({ path: '/test.txt' }, { toolCallId: 'tc-x' }),
    ).rejects.toThrow('No result returned')
  })

  it('handles executor that returns result for different ID (uses first result)', async () => {
    const mockExecutor = async (reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      return [{ id: 'different-id', result: 'found-it' }]
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    const result = await (sdkTools.read as any).execute(
      { path: '/test.txt' },
      { toolCallId: 'tc-original' },
    )
    // Falls back to results[0]
    expect(result).toBe('found-it')
  })

  it('returns empty string when result is undefined', async () => {
    const mockExecutor = async (reqs: ToolCallRequest[]): Promise<ToolCallResult[]> => {
      return [{ id: reqs[0].id, result: undefined as any }]
    }

    const sdkTools = getToolsForSDK(mockExecutor)
    const result = await (sdkTools.read as any).execute(
      { path: '/test.txt' },
      { toolCallId: 'tc-undef' },
    )
    expect(result).toBe('')
  })
})
