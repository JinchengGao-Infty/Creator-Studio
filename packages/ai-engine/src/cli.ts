#!/usr/bin/env bun

import { createEngine } from './index'
import { fetchModels } from './models'
import type { Message, ModelParameters, ProviderConfig, ToolCallRequest, ToolCallResult } from './types'

type ChatInput = {
  type: 'chat'
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
}

type FetchModelsInput = {
  type: 'fetch_models'
  baseURL: string
  apiKey: string
}

type ToolResultInput = {
  type: 'tool_result'
  results: ToolCallResult[]
}

type EngineOutput =
  | { type: 'tool_call'; calls: ToolCallRequest[] }
  | { type: 'done'; content: string }
  | { type: 'models'; models: string[] }
  | { type: 'error'; message: string }

const stdinReader = Bun.stdin.stream().getReader()
const decoder = new TextDecoder()
let stdinBuffer = ''

async function readJsonFromStdin(): Promise<unknown> {
  while (true) {
    const newlineIndex = stdinBuffer.indexOf('\n')
    if (newlineIndex !== -1) {
      const line = stdinBuffer.slice(0, newlineIndex).trim()
      stdinBuffer = stdinBuffer.slice(newlineIndex + 1)
      if (!line) continue
      return JSON.parse(line)
    }

    const { done, value } = await stdinReader.read()
    if (done) {
      throw new Error('EOF before complete JSON')
    }
    stdinBuffer += decoder.decode(value, { stream: true })
  }
}

function writeJson(output: EngineOutput) {
  process.stdout.write(JSON.stringify(output) + '\n')
}

async function main() {
  const engine = createEngine()

  const input = (await readJsonFromStdin()) as ChatInput | FetchModelsInput

  if (input.type === 'fetch_models') {
    try {
      const models = await fetchModels(input.baseURL, input.apiKey)
      writeJson({ type: 'models', models })
    } catch (error) {
      writeJson({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    }
    process.exit(0)
  }

  if (input.type !== 'chat') {
    writeJson({ type: 'error', message: 'Unknown request type' })
    process.exit(1)
  }

  engine.providerManager.addProvider(input.provider)

  try {
    const result = await engine.agent.run(input.messages, {
      providerId: input.provider.id,
      parameters: input.parameters,
      systemPrompt: input.systemPrompt,
      executeTools: async (calls: ToolCallRequest[]) => {
        writeJson({ type: 'tool_call', calls })

        const resultInput = (await readJsonFromStdin()) as ToolResultInput
        if (resultInput.type !== 'tool_result') {
          throw new Error('Expected tool_result')
        }
        return resultInput.results
      },
    })

    writeJson({ type: 'done', content: result.content })
  } catch (error) {
    writeJson({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  }
}

main()
