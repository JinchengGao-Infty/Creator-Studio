# Phase 2: AI Engine Pipeline 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI Engine 从硬编码的 4 个请求类型重构为可扩展的 Pipeline 注册机制，并新增 extract（世界观提取）和 transform（润色）两个 Pipeline。

**Architecture:** 定义 Pipeline 接口，将现有 chat/complete/compact/fetch_models 迁移为独立 Pipeline 模块，cli.ts 精简为协议层 + 路由。新增 extract 和 transform Pipeline，Rust 端新增对应的 Tauri command 转发。行内补全增加去抖和缓存优化。

**Tech Stack:** TypeScript (Vercel AI SDK), Rust (Tauri 2), Zustand (前端 state)

---

## File Structure

### New files
- `packages/ai-engine/src/core/pipeline.ts` — Pipeline 接口和 PipelineContext 类型
- `packages/ai-engine/src/core/registry.ts` — PipelineRegistry 类
- `packages/ai-engine/src/pipelines/chat.ts` — Chat Pipeline（从 cli.ts 迁移）
- `packages/ai-engine/src/pipelines/complete.ts` — Complete Pipeline（从 cli.ts 迁移）
- `packages/ai-engine/src/pipelines/compact.ts` — Compact Pipeline（包装现有 compact.ts）
- `packages/ai-engine/src/pipelines/fetch-models.ts` — FetchModels Pipeline（从 cli.ts 迁移）
- `packages/ai-engine/src/pipelines/extract.ts` — Extract Pipeline（新功能）
- `packages/ai-engine/src/pipelines/transform.ts` — Transform Pipeline（新功能）

### Modified files
- `packages/ai-engine/src/cli.ts` — 精简为协议层 + registry dispatch
- `packages/ai-engine/src/types.ts` — 新增 Pipeline 相关类型
- `packages/ai-engine/src/index.ts` — 导出 registry
- `src-tauri/src/ai_bridge.rs` — 新增 extract/transform 请求转发
- `src-tauri/src/lib.rs` — 注册新 Tauri commands
- `src/lib/ai.ts` — 新增 aiExtract/aiTransform 前端 API

### Unchanged files
- `packages/ai-engine/src/agent.ts` — Agent 类不变
- `packages/ai-engine/src/provider.ts` — ProviderManager 不变
- `packages/ai-engine/src/tools.ts` — 工具定义不变
- `packages/ai-engine/src/compact.ts` — 核心逻辑不变（被 Pipeline 包装）
- `packages/ai-engine/src/models.ts` — 核心逻辑不变（被 Pipeline 包装）

---

### Task 1: Pipeline 接口和 Registry

**Files:**
- Create: `packages/ai-engine/src/core/pipeline.ts`
- Create: `packages/ai-engine/src/core/registry.ts`
- Modify: `packages/ai-engine/src/types.ts`

- [ ] **Step 1: 在 types.ts 中新增 Pipeline 相关类型**

在 `packages/ai-engine/src/types.ts` 末尾追加：

```typescript
// Pipeline 上下文
export interface PipelineContext {
  provider: ProviderConfig;
  parameters: ModelParameters;
  systemPrompt?: string;
  messages?: Message[];
  input?: string;
  options?: Record<string, unknown>;
}

// Pipeline 输出
export interface PipelineResult {
  type: string;
  content?: string;
  structured?: unknown;
  models?: string[];
  toolCalls?: ToolCallRequest[];
}

// Pipeline JSONL 输入基础类型
export interface PipelineInput {
  type: string;
  [key: string]: unknown;
}
```

- [ ] **Step 2: 创建 pipeline.ts 接口**

创建 `packages/ai-engine/src/core/pipeline.ts`：

```typescript
import type { PipelineInput, PipelineResult, ToolCallRequest, ToolCallResult } from '../types'

/**
 * Tool 执行回调 — 发送 tool_call 到 Rust 端，等待 tool_result 返回
 */
export type ToolExecutor = (calls: ToolCallRequest[]) => Promise<ToolCallResult[]>

/**
 * Pipeline 运行时上下文 — 由 CLI 注入
 */
export interface PipelineRuntime {
  /** 读取下一行 JSONL 输入 */
  readInput: () => Promise<unknown>
  /** 写入一行 JSONL 输出 */
  writeOutput: (output: Record<string, unknown>) => void
}

/**
 * Pipeline 接口 — 每种请求类型实现一个
 */
export interface Pipeline {
  /** 请求类型名，与 JSONL input.type 匹配 */
  readonly name: string
  /** 处理请求，返回结果或通过 runtime 流式输出 */
  run(input: PipelineInput, runtime: PipelineRuntime): Promise<PipelineResult>
}
```

- [ ] **Step 3: 创建 registry.ts**

创建 `packages/ai-engine/src/core/registry.ts`：

```typescript
import type { Pipeline } from './pipeline'

export class PipelineRegistry {
  private pipelines = new Map<string, Pipeline>()

  register(pipeline: Pipeline): void {
    if (this.pipelines.has(pipeline.name)) {
      throw new Error(`Pipeline already registered: ${pipeline.name}`)
    }
    this.pipelines.set(pipeline.name, pipeline)
  }

  get(name: string): Pipeline | undefined {
    return this.pipelines.get(name)
  }

  has(name: string): boolean {
    return this.pipelines.has(name)
  }

  names(): string[] {
    return [...this.pipelines.keys()]
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/ai-engine/src/types.ts packages/ai-engine/src/core/pipeline.ts packages/ai-engine/src/core/registry.ts
git commit -m "feat(ai-engine): add Pipeline interface and PipelineRegistry

Define Pipeline contract (name + run method), PipelineRuntime for
JSONL I/O, and a type-safe registry for dispatching by request type."
```

---

### Task 2: 迁移现有逻辑到 Pipeline 模块

**Files:**
- Create: `packages/ai-engine/src/pipelines/chat.ts`
- Create: `packages/ai-engine/src/pipelines/complete.ts`
- Create: `packages/ai-engine/src/pipelines/compact.ts`
- Create: `packages/ai-engine/src/pipelines/fetch-models.ts`

- [ ] **Step 1: 创建 chat pipeline**

创建 `packages/ai-engine/src/pipelines/chat.ts`：

```typescript
import { createEngine } from '../index'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult, ProviderConfig, ModelParameters, Message, ToolCallRequest, ToolCallResult } from '../types'

interface ChatInput extends PipelineInput {
  type: 'chat'
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
}

export class ChatPipeline implements Pipeline {
  readonly name = 'chat'

  async run(input: PipelineInput, runtime: PipelineRuntime): Promise<PipelineResult> {
    const chatInput = input as ChatInput
    const engine = createEngine()
    engine.providerManager.addProvider(chatInput.provider)

    const result = await engine.agent.run(chatInput.messages, {
      providerId: chatInput.provider.id,
      parameters: chatInput.parameters,
      systemPrompt: chatInput.systemPrompt,
      executeTools: async (calls: ToolCallRequest[]) => {
        runtime.writeOutput({ type: 'tool_call', calls })
        const resultInput = (await runtime.readInput()) as { type: string; results: ToolCallResult[] }
        if (resultInput.type !== 'tool_result') {
          throw new Error('Expected tool_result')
        }
        return resultInput.results
      },
    })

    return { type: 'done', content: result.content, toolCalls: result.toolCalls }
  }
}
```

- [ ] **Step 2: 创建 complete pipeline**

创建 `packages/ai-engine/src/pipelines/complete.ts`：

```typescript
import { createEngine } from '../index'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult, ProviderConfig, ModelParameters, Message } from '../types'

interface CompleteInput extends PipelineInput {
  type: 'complete'
  provider: ProviderConfig
  parameters: ModelParameters
  systemPrompt: string
  messages: Message[]
}

export class CompletePipeline implements Pipeline {
  readonly name = 'complete'

  async run(input: PipelineInput, _runtime: PipelineRuntime): Promise<PipelineResult> {
    const completeInput = input as CompleteInput
    const engine = createEngine()
    engine.providerManager.addProvider(completeInput.provider)

    const result = await engine.agent.complete(completeInput.messages, {
      providerId: completeInput.provider.id,
      parameters: completeInput.parameters,
      systemPrompt: completeInput.systemPrompt,
    })

    return { type: 'done', content: result.content }
  }
}
```

- [ ] **Step 3: 创建 compact pipeline**

创建 `packages/ai-engine/src/pipelines/compact.ts`：

```typescript
import { generateCompactSummary } from '../compact'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult, ProviderConfig, ModelParameters, Message } from '../types'

interface CompactInput extends PipelineInput {
  type: 'compact'
  provider: ProviderConfig
  parameters: ModelParameters
  messages: Message[]
}

export class CompactPipeline implements Pipeline {
  readonly name = 'compact'

  async run(input: PipelineInput, _runtime: PipelineRuntime): Promise<PipelineResult> {
    const compactInput = input as CompactInput
    const content = await generateCompactSummary({
      provider: compactInput.provider,
      parameters: compactInput.parameters,
      messages: compactInput.messages,
    })
    return { type: 'compact_summary', content }
  }
}
```

- [ ] **Step 4: 创建 fetch-models pipeline**

创建 `packages/ai-engine/src/pipelines/fetch-models.ts`：

```typescript
import { fetchModels } from '../models'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult } from '../types'

interface FetchModelsInput extends PipelineInput {
  type: 'fetch_models'
  baseURL: string
  apiKey: string
  providerType?: 'openai-compatible' | 'google' | 'anthropic'
}

export class FetchModelsPipeline implements Pipeline {
  readonly name = 'fetch_models'

  async run(input: PipelineInput, _runtime: PipelineRuntime): Promise<PipelineResult> {
    const fetchInput = input as FetchModelsInput
    const models = await fetchModels(
      fetchInput.baseURL,
      fetchInput.apiKey,
      fetchInput.providerType ?? 'openai-compatible',
    )
    return { type: 'models', models }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/ai-engine/src/pipelines/
git commit -m "feat(ai-engine): migrate chat/complete/compact/fetch_models to Pipeline modules

Each request type is now a self-contained Pipeline class with a
run() method. No behavioral changes — pure refactor."
```

---

### Task 3: 重写 cli.ts 为协议层 + Pipeline 路由

**Files:**
- Modify: `packages/ai-engine/src/cli.ts`
- Modify: `packages/ai-engine/src/index.ts`

- [ ] **Step 1: 重写 cli.ts**

将 `packages/ai-engine/src/cli.ts` 的全部内容替换为：

```typescript
#!/usr/bin/env node

import { PipelineRegistry } from './core/registry'
import { ChatPipeline } from './pipelines/chat'
import { CompletePipeline } from './pipelines/complete'
import { CompactPipeline } from './pipelines/compact'
import { FetchModelsPipeline } from './pipelines/fetch-models'
import type { PipelineInput } from './types'
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

// --- Main ---

async function main() {
  const input = (await readJsonFromStdin()) as PipelineInput

  if (!input.type) {
    writeJson({ type: 'error', message: 'Missing request type' })
    process.exit(1)
  }

  const pipeline = registry.get(input.type)
  if (!pipeline) {
    writeJson({ type: 'error', message: `Unknown pipeline: ${input.type}. Available: ${registry.names().join(', ')}` })
    process.exit(1)
  }

  const runtime: PipelineRuntime = {
    readInput: readJsonFromStdin,
    writeOutput: writeJson,
  }

  try {
    const result = await pipeline.run(input, runtime)
    writeJson(result as Record<string, unknown>)
  } catch (error) {
    writeJson({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    process.exit(1)
  }
}

main()
```

- [ ] **Step 2: 更新 index.ts 导出**

在 `packages/ai-engine/src/index.ts` 末尾追加：

```typescript
export { PipelineRegistry } from './core/registry'
export type { Pipeline, PipelineRuntime } from './core/pipeline'
```

- [ ] **Step 3: 验证构建**

Run: `cd ~/projects/Creator-Studio && npm run ai-engine:build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 4: 运行现有测试**

Run: `cd ~/projects/Creator-Studio && node test-suite/run.mjs ai-engine-spawn`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai-engine/src/cli.ts packages/ai-engine/src/index.ts
git commit -m "refactor(ai-engine): rewrite cli.ts as protocol layer + pipeline dispatch

cli.ts is now ~70 lines: JSONL I/O + registry lookup + error handling.
All business logic lives in Pipeline modules. Functionally identical."
```

---

### Task 4: Extract Pipeline（世界观提取）

**Files:**
- Create: `packages/ai-engine/src/pipelines/extract.ts`

- [ ] **Step 1: 创建 extract pipeline**

创建 `packages/ai-engine/src/pipelines/extract.ts`：

```typescript
import { createEngine } from '../index'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult, ProviderConfig, ModelParameters } from '../types'

interface ExtractInput extends PipelineInput {
  type: 'extract'
  provider: ProviderConfig
  parameters: ModelParameters
  text: string
  extractTypes?: string[] // ['characters', 'relationships', 'factions', 'events']
}

const EXTRACT_SYSTEM_PROMPT = `你是一个小说文本分析专家。分析用户提供的小说文本，提取以下结构化信息。

请严格按照 JSON 格式输出，不要输出其他内容。

JSON Schema:
{
  "characters": [
    {
      "name": "string (角色名)",
      "description": "string (简短描述，1-2句)",
      "role": "string (protagonist/antagonist/supporting/minor)",
      "tags": ["string (性格特征或标签)"]
    }
  ],
  "relationships": [
    {
      "from": "string (角色名A)",
      "to": "string (角色名B)",
      "type": "friend|enemy|lover|family|rival|other",
      "description": "string (关系描述)"
    }
  ],
  "factions": [
    {
      "name": "string (组织/势力名)",
      "description": "string (描述)",
      "members": ["string (成员角色名)"]
    }
  ],
  "events": [
    {
      "title": "string (事件标题)",
      "description": "string (事件描述)",
      "type": "normal|plot_point|foreshadowing|turning_point|subplot",
      "characters": ["string (涉及角色名)"]
    }
  ]
}

注意：
- 只提取文本中明确提到的信息，不要虚构
- 角色名使用文本中出现的原名
- 关系的 from/to 使用角色名而非 ID
- 如果某类信息在文本中没有，返回空数组`

export class ExtractPipeline implements Pipeline {
  readonly name = 'extract'

  async run(input: PipelineInput, _runtime: PipelineRuntime): Promise<PipelineResult> {
    const extractInput = input as ExtractInput
    const engine = createEngine()
    engine.providerManager.addProvider(extractInput.provider)

    const sdk = engine.providerManager.createSDK(extractInput.provider.id)
    const model = sdk(extractInput.parameters.model)

    const { generateText } = await import('ai')
    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
        { role: 'user', content: extractInput.text },
      ] as any,
      maxSteps: 1,
      temperature: 0.1,
      maxTokens: extractInput.parameters.maxTokens ?? 4000,
    } as any)

    const text = (result as any).text ?? ''

    // 尝试解析 JSON
    let structured: unknown = null
    try {
      // 处理模型可能输出的 markdown code block
      const jsonStr = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim()
      structured = JSON.parse(jsonStr)
    } catch {
      // 解析失败，返回原始文本
      structured = null
    }

    return { type: 'extract_result', content: text, structured }
  }
}
```

- [ ] **Step 2: 注册到 cli.ts**

在 `packages/ai-engine/src/cli.ts` 的 import 区域追加：

```typescript
import { ExtractPipeline } from './pipelines/extract'
```

在 registry 注册区域追加：

```typescript
registry.register(new ExtractPipeline())
```

- [ ] **Step 3: Commit**

```bash
git add packages/ai-engine/src/pipelines/extract.ts packages/ai-engine/src/cli.ts
git commit -m "feat(ai-engine): add extract pipeline for worldbuilding extraction

Analyzes novel text and returns structured JSON with characters,
relationships, factions, and events. Uses low temperature (0.1)
and strict JSON Schema prompting for reliable output."
```

---

### Task 5: Transform Pipeline（润色/改写）

**Files:**
- Create: `packages/ai-engine/src/pipelines/transform.ts`

- [ ] **Step 1: 创建 transform pipeline**

创建 `packages/ai-engine/src/pipelines/transform.ts`：

```typescript
import { createEngine } from '../index'
import type { Pipeline, PipelineRuntime } from '../core/pipeline'
import type { PipelineInput, PipelineResult, ProviderConfig, ModelParameters } from '../types'

type TransformAction = 'polish' | 'expand' | 'condense' | 'restyle'

interface TransformInput extends PipelineInput {
  type: 'transform'
  provider: ProviderConfig
  parameters: ModelParameters
  text: string
  action: TransformAction
  style?: string // 仅 restyle 时使用
}

const SYSTEM_PROMPTS: Record<TransformAction, string> = {
  polish: `你是一位专业的小说编辑。对用户提供的文本进行润色，改善文笔和表达，保持原意不变。
要求：
- 只输出润色后的文本，不要输出解释或说明
- 保持原文的人称、时态、语气
- 修正病句、提升文采、改善节奏感
- 不要大幅改变情节或增删内容`,

  expand: `你是一位专业的小说作家。对用户提供的文本进行扩写，丰富细节和描写。
要求：
- 只输出扩写后的文本，不要输出解释或说明
- 保持原文的人称、时态、语气和情节走向
- 增加环境描写、心理活动、对话细节
- 扩写幅度约为原文的 1.5-2 倍`,

  condense: `你是一位专业的小说编辑。对用户提供的文本进行缩写，精炼表达。
要求：
- 只输出缩写后的文本，不要输出解释或说明
- 保留关键情节和信息
- 删减冗余描写、重复内容
- 缩写幅度约为原文的 50-70%`,

  restyle: `你是一位专业的小说作家。将用户提供的文本改写为指定风格。
要求：
- 只输出改写后的文本，不要输出解释或说明
- 保持原文的情节和人物不变
- 按照用户指定的风格进行改写`,
}

export class TransformPipeline implements Pipeline {
  readonly name = 'transform'

  async run(input: PipelineInput, _runtime: PipelineRuntime): Promise<PipelineResult> {
    const transformInput = input as TransformInput
    const engine = createEngine()
    engine.providerManager.addProvider(transformInput.provider)

    const sdk = engine.providerManager.createSDK(transformInput.provider.id)
    const model = sdk(transformInput.parameters.model)

    let systemPrompt = SYSTEM_PROMPTS[transformInput.action] ?? SYSTEM_PROMPTS.polish
    if (transformInput.action === 'restyle' && transformInput.style) {
      systemPrompt += `\n\n目标风格：${transformInput.style}`
    }

    const { generateText } = await import('ai')
    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transformInput.text },
      ] as any,
      maxSteps: 1,
      temperature: transformInput.action === 'polish' ? 0.3 : 0.7,
      maxTokens: transformInput.parameters.maxTokens ?? 4000,
    } as any)

    return { type: 'transform_result', content: (result as any).text ?? '' }
  }
}
```

- [ ] **Step 2: 注册到 cli.ts**

在 `packages/ai-engine/src/cli.ts` 追加 import 和注册：

```typescript
import { TransformPipeline } from './pipelines/transform'
```

```typescript
registry.register(new TransformPipeline())
```

- [ ] **Step 3: Commit**

```bash
git add packages/ai-engine/src/pipelines/transform.ts packages/ai-engine/src/cli.ts
git commit -m "feat(ai-engine): add transform pipeline for text polishing

Supports 4 actions: polish (润色), expand (扩写), condense (缩写),
restyle (改风格). Each has a tailored system prompt."
```

---

### Task 6: Rust 端 — 新增 extract/transform 转发

**Files:**
- Modify: `src-tauri/src/ai_bridge.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 在 ai_bridge.rs 中新增 run_extract 函数**

在 `src-tauri/src/ai_bridge.rs` 中，在 `generate_compact_summary` 函数附近新增：

```rust
pub fn run_extract(
    provider: Value,
    parameters: Value,
    text: String,
) -> Result<Value, String> {
    let ai_engine_path = get_ai_engine_path()?;
    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

    // Runtime API Key injection
    let mut provider_with_auth = provider.clone();
    if let Some(provider_id) = provider_with_auth.get("id").and_then(|v| v.as_str()) {
        if let Ok(Some(api_key)) = keyring_store::get_api_key(provider_id) {
            let provider_type = provider_with_auth
                .get("provider_type")
                .and_then(|v| v.as_str())
                .unwrap_or("openai-compatible");
            match provider_type {
                "anthropic" => {
                    if let Some(obj) = provider_with_auth.as_object_mut() {
                        let headers = obj.entry("headers").or_insert(json!({}));
                        if let Some(h) = headers.as_object_mut() {
                            h.insert("x-api-key".to_string(), json!(api_key));
                        }
                    }
                }
                "google" => {
                    if let Some(obj) = provider_with_auth.as_object_mut() {
                        let headers = obj.entry("headers").or_insert(json!({}));
                        if let Some(h) = headers.as_object_mut() {
                            h.insert("x-goog-api-key".to_string(), json!(api_key));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let request = json!({
        "type": "extract",
        "provider": provider_with_auth,
        "parameters": parameters,
        "text": text,
    });

    writeln!(stdin, "{}", request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    drop(stdin);

    let mut line = String::new();
    reader.read_line(&mut line)
        .map_err(|e| format!("Failed to read from stdout: {e}"))?;

    let trimmed = line.trim();
    if trimmed.is_empty() {
        let _ = child.wait();
        return Err("Empty response from ai-engine".to_string());
    }

    let response: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse response: {e}. line={trimmed:?}"))?;

    let _ = child.wait();

    match response["type"].as_str() {
        Some("extract_result") => Ok(response),
        Some("error") => Err(response["message"].as_str().unwrap_or("Unknown error").to_string()),
        _ => Err(format!("Unknown response: {trimmed}")),
    }
}
```

- [ ] **Step 2: 新增 run_transform 函数**

在同一文件中追加：

```rust
pub fn run_transform(
    provider: Value,
    parameters: Value,
    text: String,
    action: String,
    style: Option<String>,
) -> Result<String, String> {
    let ai_engine_path = get_ai_engine_path()?;
    let mut child = spawn_ai_engine(&ai_engine_path)?;

    let mut stdin = child.stdin.take().ok_or("Failed to get stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
    let mut reader = BufReader::new(stdout);

    // Runtime API Key injection (same pattern)
    let mut provider_with_auth = provider.clone();
    if let Some(provider_id) = provider_with_auth.get("id").and_then(|v| v.as_str()) {
        if let Ok(Some(api_key)) = keyring_store::get_api_key(provider_id) {
            let provider_type = provider_with_auth
                .get("provider_type")
                .and_then(|v| v.as_str())
                .unwrap_or("openai-compatible");
            match provider_type {
                "anthropic" => {
                    if let Some(obj) = provider_with_auth.as_object_mut() {
                        let headers = obj.entry("headers").or_insert(json!({}));
                        if let Some(h) = headers.as_object_mut() {
                            h.insert("x-api-key".to_string(), json!(api_key));
                        }
                    }
                }
                "google" => {
                    if let Some(obj) = provider_with_auth.as_object_mut() {
                        let headers = obj.entry("headers").or_insert(json!({}));
                        if let Some(h) = headers.as_object_mut() {
                            h.insert("x-goog-api-key".to_string(), json!(api_key));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut request = json!({
        "type": "transform",
        "provider": provider_with_auth,
        "parameters": parameters,
        "text": text,
        "action": action,
    });
    if let Some(s) = style {
        request["style"] = json!(s);
    }

    writeln!(stdin, "{}", request.to_string())
        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
    drop(stdin);

    let mut line = String::new();
    reader.read_line(&mut line)
        .map_err(|e| format!("Failed to read from stdout: {e}"))?;

    let trimmed = line.trim();
    if trimmed.is_empty() {
        let _ = child.wait();
        return Err("Empty response from ai-engine".to_string());
    }

    let response: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Failed to parse response: {e}. line={trimmed:?}"))?;

    let _ = child.wait();

    match response["type"].as_str() {
        Some("transform_result") => {
            Ok(response["content"].as_str().unwrap_or("").to_string())
        }
        Some("error") => Err(response["message"].as_str().unwrap_or("Unknown error").to_string()),
        _ => Err(format!("Unknown response: {trimmed}")),
    }
}
```

- [ ] **Step 3: 在 lib.rs 中注册 Tauri commands**

在 `src-tauri/src/lib.rs` 中，在现有的 `ai_chat` command 附近新增：

```rust
#[tauri::command(rename_all = "camelCase")]
async fn ai_extract(
    provider: serde_json::Value,
    parameters: serde_json::Value,
    text: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ai_bridge::run_extract(provider, parameters, text)
    })
    .await
    .map_err(|e| format!("ai_extract join error: {e}"))?
}

#[tauri::command(rename_all = "camelCase")]
async fn ai_transform(
    provider: serde_json::Value,
    parameters: serde_json::Value,
    text: String,
    action: String,
    style: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ai_bridge::run_transform(provider, parameters, text, action, style)
    })
    .await
    .map_err(|e| format!("ai_transform join error: {e}"))?
}
```

Then add `ai_extract` and `ai_transform` to the `invoke_handler` macro's handler list.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/ai_bridge.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): add ai_extract and ai_transform commands

Forward extract/transform requests to ai-engine Pipeline via JSONL.
Both commands include runtime API key injection from OS keyring."
```

---

### Task 7: 前端 API — aiExtract / aiTransform

**Files:**
- Modify: `src/lib/ai.ts`

- [ ] **Step 1: 在 ai.ts 中新增 aiExtract 函数**

在 `src/lib/ai.ts` 的末尾（在 `aiComplete` 和 `aiCompleteCancel` 之后）追加：

```typescript
export interface ExtractedWorldbuilding {
  characters: Array<{
    name: string;
    description: string;
    role: string;
    tags: string[];
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
    description: string;
  }>;
  factions: Array<{
    name: string;
    description: string;
    members: string[];
  }>;
  events: Array<{
    title: string;
    description: string;
    type: string;
    characters: string[];
  }>;
}

export async function aiExtract(params: {
  text: string;
}): Promise<{ content: string; structured: ExtractedWorldbuilding | null }> {
  const active = await getActiveChatConfig();
  if (!active) {
    throw new Error("请先在设置中添加 Provider，并设为当前，然后配置模型参数。");
  }

  const result = (await invoke("ai_extract", {
    provider: active.provider,
    parameters: active.parameters,
    text: params.text,
  })) as { content?: string; structured?: ExtractedWorldbuilding };

  return {
    content: result.content ?? "",
    structured: result.structured ?? null,
  };
}

export async function aiTransform(params: {
  text: string;
  action: "polish" | "expand" | "condense" | "restyle";
  style?: string;
}): Promise<string> {
  const active = await getActiveChatConfig();
  if (!active) {
    throw new Error("请先在设置中添加 Provider，并设为当前，然后配置模型参数。");
  }

  return (await invoke("ai_transform", {
    provider: active.provider,
    parameters: active.parameters,
    text: params.text,
    action: params.action,
    style: params.style ?? null,
  })) as string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/ai.ts
git commit -m "feat: add aiExtract and aiTransform frontend API functions

Type-safe wrappers for the new Tauri commands. aiExtract returns
structured worldbuilding data, aiTransform returns transformed text."
```

---

### Task 8: 行内补全优化 — 去抖 + 缓存 + 超时

**Files:**
- Modify: `src/components/Editor/Editor.tsx` (行内补全触发逻辑)

- [ ] **Step 1: 在 Editor.tsx 中找到行内补全触发逻辑并增加去抖和缓存**

在 `src/components/Editor/Editor.tsx` 中，找到触发 `aiComplete` 的位置（通常在 `completionTimerRef` 相关代码附近）。在组件顶层（useEffect 之前）添加缓存 Map：

```typescript
// 行内补全缓存：前文 hash → { result, timestamp }
const completionCacheRef = useRef<Map<string, { result: string; ts: number }>>(new Map());
const COMPLETION_CACHE_TTL = 30_000; // 30 秒
const COMPLETION_DEBOUNCE = 500; // 500ms 去抖
const COMPLETION_TIMEOUT = 8_000; // 8 秒超时
```

然后在触发补全的地方（设置 `completionTimerRef.current = setTimeout(...)` 的代码），修改：

1. 将 setTimeout 的延迟改为 `COMPLETION_DEBOUNCE`（500ms）
2. 在调用 `aiComplete` 前，检查缓存：
```typescript
const cacheKey = beforeText.slice(-200); // 用最后 200 字符作为 key
const cached = completionCacheRef.current.get(cacheKey);
if (cached && Date.now() - cached.ts < COMPLETION_CACHE_TTL) {
  // 使用缓存
  showInlineCompletion(cached.result);
  return;
}
```

3. 在 `aiComplete` 调用处增加超时控制：
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), COMPLETION_TIMEOUT);
try {
  const result = await aiComplete({ ... });
  clearTimeout(timeoutId);
  if (result) {
    completionCacheRef.current.set(cacheKey, { result, ts: Date.now() });
    showInlineCompletion(result);
  }
} catch {
  clearTimeout(timeoutId);
  // 超时或错误，静默失败
}
```

注意：这个 Task 需要仔细阅读 Editor.tsx 中现有的行内补全逻辑来精确定位修改位置。以上是伪代码指导，实际行号和变量名需要根据代码调整。

- [ ] **Step 2: Commit**

```bash
git add src/components/Editor/Editor.tsx
git commit -m "perf: add debounce, cache, and timeout for inline completion

- 500ms debounce prevents excessive API calls while typing
- 30s LRU cache avoids redundant calls for same context
- 8s timeout with silent failure (no error popup)"
```

---

### Task 9: 构建验证 + 推送

**Files:** None (verification only)

- [ ] **Step 1: 构建 AI Engine**

Run: `cd ~/projects/Creator-Studio && npm run ai-engine:build 2>&1 | tail -5`
Expected: 构建成功

- [ ] **Step 2: 运行 ai-engine-spawn 测试**

Run: `node test-suite/run.mjs ai-engine-spawn`
Expected: PASS

- [ ] **Step 3: 推送到 GitHub**

```bash
git push origin main
```
