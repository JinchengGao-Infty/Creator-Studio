# AI Engine 重构 RFC

> **状态**: v3 — ✅ Claude + GPT 双方 Approved
> **日期**: 2026-04-07
> **作者**: Claude Lead + GPT Review

---

## 1. 现状分析

### 1.1 架构概览

```
┌─────────────────────────────────────────────────────────┐
│  React Frontend (Vite + Tauri WebView)                  │
│  AIPanel / PolishToolbar / AIExtractModal / Editor       │
│       └── lib/ai.ts → invoke("ai_*")                   │
└───────────────────┬─────────────────────────────────────┘
                    │ Tauri IPC (invoke, blocking)
┌───────────────────┴─────────────────────────────────────┐
│  Rust Backend                                           │
│  ai_bridge.rs (orchestration) + session.rs + rag.rs     │
│       └── spawn_ai_engine() → 每次请求新建子进程        │
└───────────────────┬─────────────────────────────────────┘
                    │ JSONL over stdin/stdout (one-shot)
┌───────────────────┴─────────────────────────────────────┐
│  Node.js Sidecar (packages/ai-engine/)                  │
│  cli.ts → PipelineRegistry → 6 pipelines               │
│  Vercel AI SDK generateText() (非流式)                  │
└─────────────────────────────────────────────────────────┘
```

### 1.2 已识别的关键问题

| # | 问题 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | **无真实流式输出** | Critical | 用户体验差，等待时间长，前端用假打字动画掩盖 |
| 2 | **每次请求新建进程** | High | Node.js 冷启动开销大（~200-500ms），高频补全场景不可接受 |
| 3 | **IPC 协议脆弱** | High | JSONL stdin/stdout 无错误恢复、无心跳、进程崩溃无感知 |
| 4 | **Token 计数不准** | Medium | `chars/4` 对中文偏差 ~4x，压缩触发时机错误 |
| 5 | **认证逻辑重复 4 次** | Medium | ai_bridge.rs 中 4 个函数各自拼装 auth header |
| 6 | **Prompt 硬编码** | Medium | 无版本管理、无 A/B 测试能力、修改需重编译 |
| 7 | **无重试机制** | Medium | 网络抖动直接报错，无指数退避 |
| 8 | **Gemini 工具调用 hack** | Low | `direct_return_tool_results` 绕过多轮工具调用 |
| 9 | **世界观数据仅内存** | Medium | Zustand store 不持久化，刷新丢失 |
| 10 | **补全无 debounce 优化** | Low | 快速打字时可能触发过多请求 |

---

## 2. 方案评估

### 2.1 候选方案

#### 方案 A：渐进式修补（Patch）
保持现有 one-shot sidecar 架构，逐个修 bug。
- **优点**: 改动最小，风险低
- **缺点**: 无法解决架构级问题（流式、进程开销），技术债持续累积
- **评估**: ❌ 用户明确要求整体重构，且 bug 数量说明架构已不适合

#### 方案 B：长驻 Daemon + JSONL 流式升级
将 sidecar 从 one-shot 改为长驻进程，IPC 从请求-响应改为流式。
- **优点**: 改动中等，复用现有 pipeline 代码
- **缺点**: JSONL 协议扩展性差，仍需要自己实现消息路由、心跳、重连
- **评估**: ⚠️ 可行但半成品，不如直接用成熟协议

#### 方案 C：长驻 Daemon + HTTP/SSE（v1 当前最佳折中）
Sidecar 启动为 HTTP 服务器，暴露 REST + SSE 端点，Rust 层用 reqwest streaming 转发到前端 Channel。
- **优点**: 
  - SSE 是 LLM 流式输出的行业标准（OpenAI/Anthropic/Ollama 均使用）
  - HTTP 协议成熟，有现成的错误处理、超时、重试机制
  - 可独立测试（curl 直接调试）
  - Tauri Channel API 高性能有序传递，官方推荐用于流式数据
- **缺点**: 需要引入 HTTP server 框架
- **评估**: ✅ **v1 推荐方案**

#### 方案 D：纯 Rust 实现（去掉 Node.js sidecar）
用 Rust HTTP client 直接调用 LLM API，去掉 Node.js 层。
- **优点**: 进程最少，性能最优
- **缺点**: 
  - 放弃 Vercel AI SDK 生态（provider 抽象、tool calling、结构化输出）
  - Rust LLM 生态不成熟，需要自己实现大量逻辑
  - 开发效率低，迭代慢
- **评估**: ❌ 对于需要快速迭代的创作工具，TypeScript 生态优势太大

#### 方案 E：Rust 薄层 + Vercel AI SDK 全权（混合方案）
Rust 只做 HTTP 代理转发 + 工具执行 + 安全校验，AI 逻辑全部在 Node.js daemon 中用 Vercel AI SDK 的 `streamText()` 处理。
- **评估**: ✅ 这是方案 C 的具体实现形式，合并论述

### 2.2 为什么不选其他传输方式

| 传输方式 | 排除理由 |
|----------|---------|
| **WebSocket** | 当前场景是"请求→流式响应"单向流，SSE 完全足够。WebSocket 的全双工优势仅在需要服务端主动推送任意时刻消息时有意义。工具执行回调已通过独立 HTTP 请求解决，不需要复用同一连接。如果未来出现需要服务端主动推 cancel ack、heartbeat event 等场景，可升级为 WebSocket，但 v1 不引入。 |
| **Unix Domain Socket / Named Pipe** | 性能上优于 TCP localhost（少一层网络栈），但：① Windows named pipe API 与 Unix UDS 语义不同，跨平台封装复杂；② 无法用 curl 直接调试；③ reqwest 不原生支持 UDS，需要 hyper 底层适配。localhost HTTP 的延迟在本机场景下已经足够低（<1ms RTT）。 |
| **继续升级 JSONL stdin/stdout** | stdin/stdout 是无结构的字节流，要在上面实现消息边界、并发路由、心跳检测、背压控制，等于重新发明一个应用层协议。HTTP 已经解决了所有这些问题。 |

### 2.3 方案决策矩阵

| 维度 | A (Patch) | B (Daemon+JSONL) | C (Daemon+HTTP/SSE) | D (纯 Rust) |
|------|-----------|-------------------|---------------------|-------------|
| 流式支持 | ❌ | ⚠️ 自研 | ✅ 行业标准 | ✅ 自研 |
| 开发效率 | ✅ | ⚠️ | ✅ | ❌ |
| 可维护性 | ❌ | ⚠️ | ✅ | ⚠️ |
| 性能 | ❌ | ✅ | ✅ | ✅✅ |
| 生态利用 | ✅ | ✅ | ✅ | ❌ |
| 可测试性 | ❌ | ⚠️ | ✅✅ | ✅ |

**结论：方案 C（长驻 HTTP Daemon + SSE + Tauri Channel）是 v1 当前最佳折中。**

---

## 3. 目标架构

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│  React Frontend                                               │
│                                                               │
│  ┌─────────┐  ┌──────────────┐  ┌────────────┐              │
│  │ AIPanel  │  │PolishToolbar │  │ AIComplete │  ...          │
│  └────┬─────┘  └──────┬───────┘  └─────┬──────┘              │
│       └───────────────┼────────────────┘                      │
│                       │                                       │
│              useAIStream() hook                               │
│              (Channel-based streaming)                        │
│                       │                                       │
│              invoke("ai_stream", { channel })                 │
└───────────────────────┼───────────────────────────────────────┘
                        │ Tauri Command + Channel (高性能有序)
┌───────────────────────┼───────────────────────────────────────┐
│  Rust Thin Layer      │                                       │
│                       ▼                                       │
│  ┌─────────────────────────────────┐                          │
│  │  AIProxy                        │                          │
│  │  - HTTP client (reqwest)        │                          │
│  │  - SSE stream → Channel 转发    │                          │
│  │  - Tool 执行 + 安全校验         │                          │
│  │  - API Key 注入 (keyring)       │                          │
│  │  - 取消/超时管理                │                          │
│  └──────────────┬──────────────────┘                          │
│                 │ HTTP/SSE (127.0.0.1:PORT)                   │
│  ┌──────────────┴──────────────────┐                          │
│  │  Daemon 生命周期管理             │                          │
│  │  - 启动/停止/健康检查            │                          │
│  │  - 进程监控 + 自动重启           │                          │
│  │  - Crash loop 熔断              │                          │
│  └──────────────┬──────────────────┘                          │
│                 │                                              │
│  session.rs  rag.rs  keyring_store.rs  security.rs            │
└───────────────────────┼───────────────────────────────────────┘
                        │ HTTP/SSE (127.0.0.1:PORT)
┌───────────────────────┼───────────────────────────────────────┐
│  Node.js AI Daemon    │                                       │
│                       ▼                                       │
│  ┌─────────────────────────────────┐                          │
│  │  HTTP Server (Hono)             │  ← 轻量、TypeScript 原生 │
│  │                                 │                          │
│  │  POST /api/chat    → streamText │  SSE response            │
│  │  POST /api/complete→ streamText │  SSE response            │
│  │  POST /api/extract → generateObject│ JSON response         │
│  │  POST /api/transform→streamText │  SSE response            │
│  │  POST /api/compact → generateText│  JSON response          │
│  │  GET  /api/models  → proxy      │  JSON response           │
│  │  GET  /health      → status     │  健康检查                │
│  │                                 │                          │
│  │  ProviderManager (Vercel AI SDK)│                          │
│  │  ToolBridge (HTTP callback)     │                          │
│  │  PromptRegistry (YAML + schema) │                          │
│  └─────────────────────────────────┘                          │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 核心变更清单

| 变更 | 现状 | 目标 | 解决的问题 |
|------|------|------|-----------|
| **IPC 协议** | JSONL stdin/stdout, one-shot | HTTP/SSE, long-running | #1 #2 #3 |
| **流式传输** | `generateText()` 阻塞 | `streamText()` SSE | #1 |
| **前端接收** | `invoke()` 阻塞等待 | `invoke()` + Channel streaming | #1 |
| **进程模型** | 每次请求新进程 | 长驻 daemon + 健康检查 | #2 |
| **认证** | 4 处重复拼装 | 统一 `injectAuth()` helper | #5 |
| **Prompt** | 硬编码字符串 | YAML 文件 + PromptRegistry | #6 |
| **Token 计数** | `chars/4` 估算 | `js-tiktoken` 或 provider tokenizer | #4 |
| **重试** | 无 | 指数退避 + 可配置重试策略 | #7 |
| **工具执行** | Rust 内联 match | Rust HTTP endpoint + 安全中间件 | #8 |
| **世界观持久化** | 仅 Zustand 内存 | Zustand + persist middleware → JSON | #9 |

### 3.3 关键设计决策

#### 3.3.1 运行时决策：Node.js LTS

**v1 固定使用 Node.js LTS**（当前 v22），不使用 Bun。

理由：
- 长驻 daemon 已消除每次请求的冷启动成本（Bun 的启动速度优势不再有意义）
- Node.js 在 Windows 上的兼容性经过十年验证
- 第三方库（Vercel AI SDK、Hono）在 Node.js 上的测试覆盖最完整
- Bun 降级为后续 benchmark 实验项，Hono 的多运行时特性保证未来可平滑切换

#### 3.3.2 HTTP Server 选型：Hono

选择 [Hono](https://hono.dev) 而非 Express/Fastify：
- **极轻量**: ~14KB，无依赖，适合 sidecar 场景
- **TypeScript 原生**: 类型安全的路由、中间件
- **SSE 内置支持**: `hono/streaming` 模块
- **多运行时**: 保证未来 Bun/Deno 切换可能

> **注意**：Hono 在 Cloudflare Workers 的生产使用不能直接类比本机长驻 daemon 的 SSE 稳定性。需要在本项目场景下做专项验证（长连接存活、内存泄漏、断流重连）。

#### 3.3.3 API 调用策略规则

不再按 route 硬编码，而是按 **交互语义** 统一定义：

| 规则 | 使用的 API | 适用场景 |
|------|-----------|---------|
| 用户可见的自然语言输出 | `streamText()` | chat、complete、transform |
| 结构化机器消费输出 | `generateObject()` | extract（世界观 JSON）|
| 短、原子、非用户可见、无中间态价值 | `generateText()` | **仅当** 输出极短且不影响用户等待体验时 |

**具体 route 映射**：
- `/api/chat` → `streamText()` — 用户直接看到 token 流
- `/api/complete` → `streamText()` — 编辑器补全，首 token 越快越好
- `/api/transform` → `streamText()` — 润色/扩写结果用户直接看到
- `/api/extract` → `generateObject()` — 结构化 JSON，机器消费
- `/api/compact` → `streamText()` — **改为流式**。虽然机器消费，但可能阻塞交互链路，用流式避免黑盒等待，前端可以显示压缩进度

#### 3.3.4 工具执行：回调模式 + 约束

工具定义在 Node.js（Vercel AI SDK tool schemas），执行在 Rust：

```
AI Model → tool_call → Node.js daemon
  → HTTP POST 127.0.0.1:RUST_PORT/tool/execute {name, args}
  → Rust 执行 (安全校验 + 文件操作 + RAG)
  → 返回结果 → Node.js 继续 agent loop
```

**约束设计**（GPT 审核建议）：

| 约束 | 规格 |
|------|------|
| **连接策略** | HTTP keep-alive 长连接，reqwest 连接池默认配置 |
| **单次超时** | 单个 tool 执行最长 30s（文件操作 < 1s，RAG 搜索 < 5s，留余量） |
| **整轮 agent 超时** | Chat agent loop 总超时 10 分钟（与现有一致） |
| **并发上限** | 单次 agent step 最多并行执行 5 个 tool call |
| **可取消** | Rust 收到前端 cancel → 设置 AtomicBool → tool callback 返回 cancel 错误 → Node.js 中止 agent loop |
| **失败策略** | 连续 3 次 tool 失败中止 loop（与现有一致），单次 timeout 视为失败 |

#### 3.3.5 流式数据流

```
LLM API ──SSE──→ Vercel AI SDK streamText()
                    │
                    ├─ text delta → SSE chunk → Rust reqwest stream
                    │                              → Channel.send(TextDelta{...})
                    │                                  → Frontend onmessage
                    │
                    ├─ tool_call → pause stream
                    │              → HTTP callback to Rust (keep-alive, 30s timeout)
                    │              → resume stream
                    │
                    └─ finish → SSE done event → Channel.send(Done{...})
```

#### 3.3.6 Daemon 生命周期 + 异常策略

```rust
struct AIDaemon {
    child: Child,
    port: u16,
    shared_secret: String,  // 随机 bearer token
    health_check: JoinHandle<()>,
    restart_count: AtomicU32,
    last_restart: Mutex<Instant>,
}
```

**正常流程**：
- App 启动时 spawn daemon → 等待 `/health` 返回 200 → 记录 port
- 端口动态分配（`0` → OS 选择），通过 stdout 第一行回传
- App 退出时发送 `SIGTERM` → 等待 5s graceful shutdown → `SIGKILL`

**异常策略**：

| 场景 | 处理 |
|------|------|
| Health check 失败 | 等待 3 次连续失败后触发重启 |
| Daemon 进程退出 | 立即重启，记录 restart_count |
| Crash loop（5 分钟内重启 > 3 次） | **熔断**：停止重启，向前端 emit 错误事件，等待用户手动操作 |
| 熔断回退 | 用户可选择"重试"或"回退到 one-shot 模式"（保留旧 cli.ts 作为 fallback） |
| 应用升级后旧 daemon 残留 | 启动时先检查是否有遗留进程（通过 PID file），kill 后再启动新 daemon |
| 协议版本不匹配 | `/health` 返回 `{"version": "2.0"}`，Rust 校验版本号，不匹配则重启 daemon |

#### 3.3.7 Prompt 管理 + 治理

```yaml
# packages/ai-engine/prompts/chat-discussion.yaml
name: chat-discussion
version: 2
description: 讨论模式系统提示词
variables:
  - name: worldbuilding
    required: false
    description: 世界观设定文本
  - name: writingPreset
    required: false
    description: 写作风格预设
template: |
  你是一位专业的中文小说创作助手。
  {{#if worldbuilding}}
  ## 世界观设定
  {{worldbuilding}}
  {{/if}}
  ...
```

**治理规则**（GPT 审核建议）：

| 规则 | 实现 |
|------|------|
| **Schema 校验** | 每个 YAML 必须符合 `PromptSchema`（name, version, variables, template 必填） |
| **启动时全量编译** | Daemon 启动时加载并编译所有 YAML 模板，任何解析/编译错误立即报错退出 |
| **变量白名单** | 模板只能引用 `variables` 中声明的变量，未声明变量编译时报错 |
| **版本策略** | version 单调递增，回滚通过 git revert 实现 |
| **格式选择** | YAML（不是 JSON）— 多段落中文 prompt 的可读性远优于 JSON 转义 |

---

## 4. 安全模型

### 4.1 Localhost 安全边界

桌面应用的 localhost 端口对同机所有进程可见，因此需要额外的安全措施：

| 措施 | 实现 |
|------|------|
| **绑定地址** | 只监听 `127.0.0.1`，不监听 `0.0.0.0` |
| **共享密钥** | Rust 启动 daemon 时生成随机 `shared_secret`，通过环境变量传入 Node.js |
| **Bearer Token 认证** | 所有 HTTP 请求携带 `Authorization: Bearer <shared_secret>`，Node.js 中间件校验 |
| **Tool Server 同理** | Rust tool execution endpoint 也用 shared_secret 校验来源 |
| **Origin 校验** | 当前 HTTP/SSE 模式：校验 Origin header，拒绝非 `localhost` / `127.0.0.1` / `tauri://localhost` 来源的请求，防止恶意网页通过浏览器发起 CSRF 攻击。WebSocket 场景同理。 |

### 4.2 API Key 保护

- API Key 仍存储在 OS Keyring（keyring_store.rs），不进入配置文件或日志
- Rust 层在转发请求到 daemon 时注入 auth header，daemon 本身不持久化 key
- 日志中间件对 `Authorization` / `x-api-key` / `x-goog-api-key` 自动脱敏

---

## 5. 可观测性设计

### 5.1 ID 体系

```
request_id  — 前端生成，贯穿整个请求链路（前端 → Rust → Node.js → LLM）
stream_id   — Node.js 生成，标识一个 SSE 流的生命周期
tool_call_id — LLM 生成，标识单次工具调用
```

所有日志行携带 `request_id`，实现跨层关联。

### 5.2 结构化日志

```json
{
  "ts": "2026-04-07T10:00:00Z",
  "level": "info",
  "request_id": "req_abc123",
  "stream_id": "str_def456",
  "event": "stream.token",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "latency_ms": 42,
  "tokens_so_far": 150
}
```

### 5.3 关键指标

| 指标 | 类型 | 用途 |
|------|------|------|
| `ttft_ms` | Histogram | 首 token 延迟（Time To First Token） |
| `tps` | Gauge | 每秒 token 数 |
| `stream_duration_ms` | Histogram | 流式响应总时长 |
| `tool_callback_latency_ms` | Histogram | 工具回调往返延迟 |
| `daemon_restart_count` | Counter | Daemon 重启次数 |
| `daemon_memory_bytes` | Gauge | Daemon 进程内存（RSS） |
| `daemon_fd_count` | Gauge | Daemon 打开的文件描述符数 |
| `active_streams` | Gauge | 当前活跃 SSE 流数量 |
| `sse_disconnect_reason` | Counter(label) | SSE 断流原因分类（complete/cancel/error/timeout） |

> v1 不引入外部监控系统，指标通过 `/health` 端点 JSON 暴露 + 日志文件持久化。后续可接入 Prometheus/Grafana。

---

## 6. 并发与背压模型

### 6.1 并发上限

| 资源 | 上限 | 理由 |
|------|------|------|
| 活跃 SSE 流（chat/complete/transform） | 3 | 桌面应用单用户场景，3 个足够覆盖"一个 chat + 一个 complete + 一个 transform" |
| 同一 session 的并发请求 | 1（串行） | 同 session 的上下文有序依赖，并发会导致消息乱序 |
| 单次 agent step 并行 tool call | 5 | LLM 单步最多返回的 tool call 数量限制 |

### 6.2 背压策略

| 场景 | 处理 |
|------|------|
| Channel 阻塞（前端处理慢） | Rust 端的 `Channel.send()` 是非阻塞的（Tauri Channel 内部有缓冲），但如果缓冲积压过多，记录 warning 日志 |
| 超过并发上限的新请求 | 返回 HTTP 429 + `Retry-After` header，前端显示"请等待当前请求完成" |
| 前端取消 | Rust 设置 cancel flag → 中断 reqwest stream → Node.js 收到连接断开 → 中止 Vercel AI SDK 请求（`AbortController`） → provider 侧停止生成 |

### 6.3 取消传播路径

```
前端 "取消" 按钮
  → invoke("ai_cancel", { request_id })
  → Rust: set cancel AtomicBool + abort reqwest stream
  → Node.js: SSE 连接断开触发 req.signal abort
  → Vercel AI SDK: AbortController.abort()
  → Provider API: 连接关闭，停止生成
```

---

## 7. 文件结构

```
packages/ai-engine/
├── src/
│   ├── server.ts              # Hono HTTP server 入口
│   ├── routes/
│   │   ├── chat.ts            # POST /api/chat (SSE)
│   │   ├── complete.ts        # POST /api/complete (SSE)
│   │   ├── extract.ts         # POST /api/extract (JSON)
│   │   ├── transform.ts       # POST /api/transform (SSE)
│   │   ├── compact.ts         # POST /api/compact (SSE)
│   │   └── models.ts          # GET /api/models (JSON)
│   ├── core/
│   │   ├── provider.ts        # ProviderManager (复用+重构)
│   │   ├── agent.ts           # Agent wrapper over streamText/generateText
│   │   ├── tools.ts           # Tool schemas (复用)
│   │   └── tool-bridge.ts     # HTTP callback to Rust for tool execution
│   ├── prompts/
│   │   ├── registry.ts        # PromptRegistry: load + compile + validate
│   │   ├── schema.ts          # PromptSchema validation (Zod)
│   │   ├── chat-discussion.yaml
│   │   ├── chat-continue.yaml
│   │   ├── complete.yaml
│   │   ├── extract.yaml
│   │   ├── transform-polish.yaml
│   │   ├── transform-expand.yaml
│   │   ├── transform-condense.yaml
│   │   ├── transform-restyle.yaml
│   │   └── compact.yaml
│   ├── middleware/
│   │   ├── auth.ts            # shared_secret bearer token 校验
│   │   ├── error.ts           # Unified error handling + retry
│   │   ├── logging.ts         # Structured logging with request_id
│   │   └── concurrency.ts     # 并发限制 + 429 响应
│   └── types.ts               # Shared types
├── package.json
└── tsconfig.json

src-tauri/src/
├── ai_daemon.rs               # Daemon lifecycle + crash loop breaker (NEW)
├── ai_proxy.rs                # HTTP proxy + Channel streaming (REPLACE ai_bridge.rs)
├── ai_tool_server.rs          # HTTP endpoint for tool execution (NEW)
├── session.rs                 # (保留)
├── rag.rs                     # (保留)
├── keyring_store.rs           # (保留)
└── security.rs                # (保留)

src/
├── hooks/
│   └── useAIStream.ts         # Channel-based streaming hook (NEW)
├── lib/
│   └── ai.ts                  # 重构：使用 Channel API
└── components/
    └── AIPanel/
        └── AIPanel.tsx         # 重构：接入 useAIStream
```

---

## 8. 迁移策略

**排期总览：4 周功能迁移 + 1-2 周加固验证**

### Feature Phase 1：基础设施 + 最小验证（第 1 周）
1. 搭建 Hono HTTP server 骨架 + `/health` 端点 + shared_secret 认证中间件
2. 实现 Rust `AIDaemon` 生命周期管理（启动、停止、健康检查、PID 文件、版本握手）
3. 实现一个最简 route（`/api/compact`）验证 HTTP IPC 全链路

### Feature Phase 2：流式核心（第 2 周）
4. 实现 `streamText()` + SSE 在 `/api/chat` route
5. 实现 Rust SSE → Channel 转发层（`ai_proxy.rs`）
6. 实现 `useAIStream` 前端 hook
7. 重构 `AIPanel.tsx` 接入真实流式
8. 实现取消传播路径（前端 → Rust → Node.js → provider）

### Feature Phase 3：完整迁移（第 3 周）
9. 迁移剩余 routes（complete、transform、extract、models）
10. 实现 tool-bridge（工具执行回调 + 约束）
11. 统一认证中间件（`injectAuth()` 提取）
12. 世界观数据持久化（Zustand persist）

### Feature Phase 4：优化补全（第 4 周）
13. PromptRegistry + YAML 治理（schema 校验、启动编译、变量白名单）
14. 并发控制 + 背压中间件
15. Token 计数器升级
16. 重试 + 指数退避
17. 删除旧的 cli.ts / JSONL 协议代码

### Hardening Phase（第 5-6 周）
18. Daemon crash loop 熔断 + one-shot fallback
19. 可观测性（结构化日志、request_id 关联、关键指标）
20. Fault injection 测试：daemon 崩溃、tool callback 超时、provider 429/5xx、前端中途取消、半开连接、超长上下文
21. 性能基准测试（TTFT、TPS、内存水位、FD 泄漏）
22. 跨平台验证（macOS + Windows）

> **v1 scope 边界**：Feature Phase 1-4（4 周）是功能交付。Hardening Phase（1-2 周）是加固验证。如果 Phase 3 中 tool-bridge 或 prompt 外置遇到耦合问题，可延后到 Phase 4 而不阻塞核心迁移。

---

## 9. 风险 + 缓解

| 风险 | 缓解措施 |
|------|---------|
| Daemon 进程管理复杂 | 参考 Ollama/LM Studio 实现，crash loop 熔断兜底，保留 one-shot fallback |
| 端口冲突 | OS 动态端口分配（端口 0） |
| Windows 兼容性 | Tauri Channel 跨平台，HTTP 127.0.0.1 在所有平台可用，Node.js LTS 验证最充分 |
| 迁移期间功能中断 | Phase 式迁移，每个 route 独立切换，旧路径保留到全部迁移完成 |
| Hono SSE 长连接稳定性 | 不依赖外部背书，在本项目场景做专项验证（Phase 5） |
| Localhost 安全 | shared_secret + 只绑定 127.0.0.1 + 日志脱敏 |
| 僵尸子进程 | PID 文件 + 启动时清理遗留进程 + App 退出时 SIGKILL fallback |

---

## 10. 审核记录

| 轮次 | 审核方 | 状态 | 备注 |
|------|--------|------|------|
| v1 | Claude Lead | Draft | 初版 |
| v1 | GPT (Codex) | approve-with-changes | 方向正确，12 条修改建议 |
| v2 | Claude Lead | 整合 GPT 意见 | 新增：安全模型、可观测性、并发模型、daemon 异常策略、prompt 治理、运行时决策、API 策略规则、传输方式排除论证、fault injection 测试 |
| v2 | GPT (Codex) | approve-with-minor-changes | 10/12 条完全采纳，2 条小修（排期口径、Origin 校验） |
| v3 | Claude Lead | 修复 GPT 终审意见 | 排期对齐"4 周 feature + 1-2 周 hardening"，Origin 校验明确定案 |
| **v3** | **双方共识** | **✅ Approved** | Claude + GPT 双方同意此方案 |
