# Novel Context / Embedding Plan

## Objective

把 Creator Studio 的小说 AI 从“散装 prompt + 工具自搜”升级成“统一 context bundle + 本地 embedding 检索”。

当前阶段只做 embedding，不上 reranker。
embedding 采用可选下载模式，不要求用户首次安装时必须具备本地模型。

## Phase 1

1. 把写作 preset 支持 `md/txt` 导入导出，降低调 prompt 的摩擦。
2. 把 AIPanel 内联的 prompt/context 装配抽成统一 builder。
3. 保持现有 `knowledge/ + rag_search` 能继续工作，不破坏旧项目。

## Phase 2

1. 把 `rag.rs` 从通用知识库检索升级成小说上下文检索。
2. 数据源扩到：
   - `knowledge/`
   - `summaries.json`
   - worldbuilding store 的导出摘要
   - 章节摘要 / 最近章节尾部片段
3. 提供 `get_writing_context(...)` 这类应用级接口，而不是只暴露裸 `rag_search`。

## Phase 3

1. 接入本地 embedding backend。
2. 优先选择软件内嵌方案，避免外部服务依赖。
3. 模型改为按需下载/导入：
   - 未安装时不阻塞主功能
   - 用户主动启用本地语义检索时再提示下载
   - 支持手动导入本地模型目录
4. 若直接使用 GGUF，则以内嵌 `llama.cpp` 方式加载，不暴露额外进程接口。

## Constraints

- 当前阶段只做 embedding。
- 不引入 reranker。
- 新能力必须兼容现有项目目录结构。
- Prompt/context 装配要能继续复用在 Discussion / Continue 两种模式。

## Verification

- `npm run build`
- `cargo test`
- 预设导入导出 smoke test
- 旧项目在不配置新 embedding 的情况下仍能正常聊天/续写
