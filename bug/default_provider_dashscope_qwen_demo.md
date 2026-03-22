# DashScope Qwen 默认 Provider Demo

## 目标

- 软件首次启动时，默认内置一个可直接使用的 DashScope Provider。
- 用户不需要手动新增 Provider，也不需要手动填写模型名。

## 默认配置

- Provider 名称：`DashScope Qwen Demo`
- Provider ID：`builtin_dashscope_qwen_demo`
- Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`
- 模型：`qwen-plus`
- Provider 类型：`openai-compatible`

## 替换内容

- 已移除旧的内置 GLM Demo 默认配置。
- 如果本地配置中存在旧的 `builtin_glm_4_7_demo`，读取配置时会自动移除。
- 如果激活项仍然指向旧的 GLM demo，会自动切换到新的 DashScope demo。

## 接口测试结果

- `GET /models` 测试成功，能够获取模型列表。
- `POST /chat/completions` 使用 `qwen-plus` 测试成功，服务端返回正常响应。

## 技术实现

- 在 [config.rs](c:\Users\16053\proj\07-story\Creator-Studio\src-tauri\src\config.rs) 中注入内置默认 Provider。
- 首次读取配置时，如果本地没有对应 Provider，则自动补入配置。
- 如果本地已经存在同 ID 的内置 Provider，但字段被旧版本或错误配置污染，也会在加载时强制规范化：
  - `name = DashScope Qwen Demo`
  - `base_url = https://dashscope.aliyuncs.com/compatible-mode/v1`
  - `provider_type = openai-compatible`
  - `models = [qwen-plus]`
  - `headers = null`
- 如果当前没有激活 Provider，或仍然指向旧 GLM demo，则自动切换到 DashScope demo。
- 如果默认模型为空，或仍为旧的 `glm-4.7`，则自动改为 `qwen-plus`。
- API Key 会尝试写入系统 keyring。
- 配置文件如果带 UTF-8 BOM，也会在读取时先去掉 BOM，避免 `expected value at line 1 column 1`。

## 验证

- `cargo test --manifest-path src-tauri/Cargo.toml config::tests:: -- --nocapture`
- `npm run test:default-provider`
- `npm run test:regression`
- `npm run tauri:build`
