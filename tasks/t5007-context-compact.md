# T5.7 上下文压缩 (/compact)

## 目标

实现 `/compact` 命令，将历史对话压缩成摘要，释放上下文空间。

## 功能

### 用户触发
- 在 AI 面板输入 `/compact` 触发压缩
- 或者当 token 接近上限时自动提示用户

### 压缩流程
1. 获取当前会话的所有消息（除了最近 N 条）
2. 调用 AI 生成摘要：
   - 关键讨论点
   - 做出的决定
   - 重要的上下文信息
3. 删除原始消息，插入一条 `[系统摘要]` 消息
4. 保留最近 N 条消息不压缩

### 摘要格式
```
[会话摘要 - 已压缩 X 条消息]

讨论要点：
- ...

决定事项：
- ...

上下文：
- ...
```

## 技术实现

### 前端
- `src/components/AIPanel/AIPanel.tsx`
  - 检测 `/compact` 命令
  - 显示压缩进度
  - 压缩完成后刷新消息列表

### 后端
- `src-tauri/src/session.rs`
  - `compact_session(session_id, keep_recent: u32)` — 压缩会话
  - 删除旧消息，插入摘要消息

### AI Engine
- `packages/ai-engine/src/compact.ts`
  - `generateCompactSummary(messages)` — 生成压缩摘要

## 验收标准

- [ ] `/compact` 命令可用
- [ ] 压缩后保留最近 5 条消息
- [ ] 摘要消息正确显示
- [ ] 压缩后 AI 仍能理解上下文

## 可选增强

- Token 计数显示（当前/上限）
- 自动压缩提醒（接近上限时）
- 压缩前确认对话框
