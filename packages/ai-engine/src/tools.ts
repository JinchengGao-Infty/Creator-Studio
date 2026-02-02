import { jsonSchema, tool } from 'ai'
import type { ToolCallRequest, ToolCallResult, ToolDefinition } from './types'

// Tool 定义（只描述，不执行）
// 执行由 Tauri 后端完成（通过 executeTools 回调）

export const tools: ToolDefinition[] = [
  {
    name: 'read',
    description: '读取文件内容。用于读取章节、摘要、设定等文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于项目目录的文件路径' },
        offset: { type: 'number', description: '起始行号（0-based）' },
        limit: { type: 'number', description: '读取行数（默认2000）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write',
    description: '写入文件内容（会自动备份旧内容）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于项目目录的文件路径' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'append',
    description: '追加内容到文件末尾（适合续写）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于项目目录的文件路径' },
        content: { type: 'string', description: '要追加的内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list',
    description: '列出目录下的文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对于项目目录的目录路径' },
      },
      required: [],
    },
  },
  {
    name: 'search',
    description: '在项目内搜索关键词。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        path: { type: 'string', description: '搜索范围（目录路径）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_chapter_info',
    description: '获取当前章节信息（路径、字数等）。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'save_summary',
    description: '保存本次续写的摘要（用于 summaries.json）。',
    parameters: {
      type: 'object',
      properties: {
        chapterId: { type: 'string', description: '章节 ID（例如 chapter_003 或 003）' },
        summary: { type: 'string', description: '摘要内容（50-100 字左右）' },
      },
      required: ['chapterId', 'summary'],
    },
  },
]

type ExecuteTools = (calls: ToolCallRequest[]) => Promise<ToolCallResult[]>

function createFallbackId(toolName: string) {
  return `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getToolDef(name: ToolCallRequest['name']) {
  const def = tools.find((t) => t.name === name)
  if (!def) {
    throw new Error(`Unknown tool: ${name}`)
  }
  return def
}

// 转换为 Vercel AI SDK 格式
export function getToolsForSDK(executeTools?: ExecuteTools) {
  const makeExecute =
    (toolName: ToolCallRequest['name']) =>
    async (args: Record<string, any>, options?: { toolCallId?: string }) => {
      if (!executeTools) {
        throw new Error(`Tool execution not available for: ${toolName}`)
      }

      const id = options?.toolCallId ?? createFallbackId(toolName)
      const results = await executeTools([{ id, name: toolName, args }])
      const result = results.find((r) => r.id === id) ?? results[0]

      if (!result) {
        throw new Error(`No result returned for tool: ${toolName}`)
      }
      if (result.error) {
        throw new Error(result.error)
      }
      return result.result
    }

  return {
    read: tool({
      description: getToolDef('read').description,
      parameters: jsonSchema(getToolDef('read').parameters as any),
      execute: executeTools ? makeExecute('read') : undefined,
    }),
    write: tool({
      description: getToolDef('write').description,
      parameters: jsonSchema(getToolDef('write').parameters as any),
      execute: executeTools ? makeExecute('write') : undefined,
    }),
    append: tool({
      description: getToolDef('append').description,
      parameters: jsonSchema(getToolDef('append').parameters as any),
      execute: executeTools ? makeExecute('append') : undefined,
    }),
    list: tool({
      description: getToolDef('list').description,
      parameters: jsonSchema(getToolDef('list').parameters as any),
      execute: executeTools ? makeExecute('list') : undefined,
    }),
    search: tool({
      description: getToolDef('search').description,
      parameters: jsonSchema(getToolDef('search').parameters as any),
      execute: executeTools ? makeExecute('search') : undefined,
    }),
    get_chapter_info: tool({
      description: getToolDef('get_chapter_info').description,
      parameters: jsonSchema(getToolDef('get_chapter_info').parameters as any),
      execute: executeTools ? makeExecute('get_chapter_info') : undefined,
    }),
    save_summary: tool({
      description: getToolDef('save_summary').description,
      parameters: jsonSchema(getToolDef('save_summary').parameters as any),
      execute: executeTools ? makeExecute('save_summary') : undefined,
    }),
  }
}
