# DashScope 默认 Provider 安全说明

## 当前策略

- 软件仍然内置一个默认 DashScope Provider。
- 该默认 Provider 只预置以下非敏感配置：
  - Provider ID: `builtin_dashscope_qwen_demo`
  - Provider Name: `DashScope Qwen Demo`
  - Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - Model: `qwen-plus`
  - Provider Type: `openai-compatible`

## 安全调整

- 已移除代码中的硬编码 API key。
- 已移除首次加载时自动把默认 key 写入系统 keyring 的逻辑。
- 已加入旧泄露 key 清理逻辑：
  - 如果本地 keyring 中检测到历史泄露 key，会自动删除。

## 为什么这样改

- 真实 API key 一旦进入源码仓库、安装包、公开 Release 或日志，就存在被盗刷风险。
- 默认 Provider 可以保留，方便用户少填一层 URL 和模型配置。
- 但 API key 必须改为用户本地自行配置，不能继续跟随软件分发。

## 用户侧行为

- 首次使用 AI 前，需要在设置中为当前 Provider 手工填写自己的 API key。
- API key 仍然保存在系统凭据库，不写入普通配置文件。

## 回归要求

- 仓库中不得出现任何真实 API key 字面量。
- 安全修复后必须补测试，当前已新增：
  - `npm run test:no-hardcoded-secrets`
  - `npm run test:regression`

## 额外处理建议

- 已经暴露过的 key 不应继续使用。
- 必须到供应商控制台立即废弃旧 key，并重新生成新 key。
