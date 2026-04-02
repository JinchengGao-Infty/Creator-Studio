#!/usr/bin/env node

import { PipelineRegistry } from './core/registry'
import { ChatPipeline } from './pipelines/chat'
import { CompletePipeline } from './pipelines/complete'
import { CompactPipeline } from './pipelines/compact'
import { FetchModelsPipeline } from './pipelines/fetch-models'
import { ExtractPipeline } from './pipelines/extract'
import type { PipelineRuntime } from './core/pipeline'

// --- JSONL I/O ---

let stdinBuffer = ''
let stdinEnded = false
let wakeReader: (() => void) | null = null

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  stdinBuffer += chunk
  if (wakeReader) {
    const resolve = wakeReader
    wakeReader = null
    resolve()
  }
})
process.stdin.on('end', () => {
  stdinEnded = true
  if (wakeReader) {
    const resolve = wakeReader
    wakeReader = null
    resolve()
  }
})

async function readJsonFromStdin(): Promise<unknown> {
  while (true) {
    const newlineIndex = stdinBuffer.indexOf('\n')
    if (newlineIndex !== -1) {
      const line = stdinBuffer.slice(0, newlineIndex).trim()
      stdinBuffer = stdinBuffer.slice(newlineIndex + 1)
      if (!line) continue
      return JSON.parse(line)
    }
    if (stdinEnded) {
      throw new Error('EOF before complete JSON')
    }
    await new Promise<void>((resolve) => {
      wakeReader = resolve
    })
  }
}

function writeJson(output: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(output) + '\n')
}

// --- Pipeline Registry ---

const registry = new PipelineRegistry()
registry.register(new ChatPipeline())
registry.register(new CompletePipeline())
registry.register(new CompactPipeline())
registry.register(new FetchModelsPipeline())
registry.register(new ExtractPipeline())

// --- Main ---

async function main() {
  const input = (await readJsonFromStdin()) as Record<string, unknown>

  const type = input.type as string | undefined
  if (!type) {
    writeJson({ type: 'error', message: 'Missing request type' })
    process.exit(1)
  }

  const pipeline = registry.get(type)
  if (!pipeline) {
    writeJson({ type: 'error', message: `Unknown pipeline: ${type}. Available: ${registry.names().join(', ')}` })
    process.exit(1)
  }

  const runtime: PipelineRuntime = {
    readInput: readJsonFromStdin,
    writeOutput: writeJson,
  }

  try {
    const result = await pipeline.run(input, runtime)
    writeJson(result)
  } catch (error) {
    writeJson({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  }
}

main()
