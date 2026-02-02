# T5.7 上下文压缩 (自动 Compact)

## 目标

当上下文接近 token 上限时，自动压缩历史对话，无需用户手动触发。

## 功能

### 自动压缩流程
1. 每次调用 AI 前，估算当前消息的 token 数
2. 如果超过阈值（如 80% 上限），自动触发压缩
3. 压缩完成后继续发送请求

### 压缩逻辑
1. 保留最近 N 条消息（如 5 条）
2. 将其余消息发给 AI 生成摘要
3. 删除原始消息，插入一条 `[系统摘要]` 消息
4. 摘要作为上下文继续对话

### 摘要格式
```
[会话摘要]

讨论要点：
- ...

决定事项：
- ...

上下文：
- ...
```

## 技术实现

### Token 估算
- 简单方案：字符数 / 4（粗略估算）
- 精确方案：用 tiktoken 或类似库

### 前端
- `src/components/AIPanel/AIPanel.tsx`
  - 发送前检查 token 数
  - 超限时自动调用 compact
  - 显示"正在压缩上下文..."提示

### 后端
- `src-tauri/src/session.rs`
  - `compact_session(session_id, keep_recent: u32)` — 压缩会话
  - `estimate_tokens(messages)` — 估算 token 数

### AI Engine
- `packages/ai-engine/src/compact.ts`
  - `generateCompactSummary(messages)` — 生成压缩摘要

## 配置项

```typescript
const COMPACT_CONFIG = {
  maxTokens: 8000,        // 上下文上限
  compactThreshold: 0.8,  // 80% 时触发压缩
  keepRecent: 5,          // 保留最近 5 条
}
```

## 验收标准

- [ ] 自动检测 token 超限
- [ ] 自动压缩，用户无感知
- [ ] 压缩后 AI 仍能理解上下文
- [ ] 摘要消息正确显示

## 可选增强

- Token 计数显示（当前/上限）
- 手动 `/compact` 命令（强制压缩）
- 压缩历史记录（可查看被压缩的内容）
