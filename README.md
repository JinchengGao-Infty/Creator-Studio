# Creator Studio

Creator Studio 是一个面向长篇小说创作的桌面应用，基于 Tauri、React、TypeScript 和 Rust 构建。项目当前重点覆盖章节管理、正文编辑、AI 对话与续写，以及围绕安装包、默认模型和编辑器交互建立的回归测试体系。

## 安装

### Windows 用户

- 优先使用安装包版本，不要直接运行 `src-tauri/target/debug/` 下的调试产物。
- 当前最新版安装包默认同步到项目根目录 [`release/`](C:/Users/16053/proj/07-story/Creator-Studio/release)。
- Windows 常用产物：
  - `release/CreatorAI_<version>_x64_en-US.msi`
  - `release/CreatorAI_<version>_x64-setup.exe`

### macOS 用户

- macOS 打包产物会出现在项目根目录 `release/`，常见文件为 `.dmg`。

### 默认 AI Provider

- 应用内置默认 Provider 配置，预置 Base URL、Provider 类型和默认模型。
- 出于安全原因，软件不再内置任何真实 API key。
- 首次使用 AI 前，用户需要在设置中为当前 Provider 手工填写自己的 API key。
- 当前默认配置：
  - Base URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - Model: `qwen-plus`

## 开发

### 环境要求

- Node.js 18+
- npm
- Rust stable
- Windows 下需要可用的 Rust MSVC 工具链

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run tauri:dev
```

说明：
- 该命令会先构建 AI sidecar，再启动前端和 Tauri 桌面壳。
- 不要把调试版可执行文件当成发布版验证结果；Windows demo、安装包联调要使用安装版或 release 版。

## 测试

项目已经拆出独立测试子工程 [`test-suite/`](C:/Users/16053/proj/07-story/Creator-Studio/test-suite)，后续新增功能和修 bug 都应优先在这里补测试，而不是继续堆临时脚本。

### 常用测试命令

```bash
npm run test:default-provider
npm run test:ai-engine-sidecar
npm run test:no-hardcoded-secrets
npm run test:editor-shortcuts
npm run test:editor-e2e
npm run test:windows-demo
npm run test:regression
```

### 测试要求

- 修复 bug 时，优先补一个可复现该问题的测试用例。
- 安装包问题必须补安装链路或运行链路测试。
- 编辑器交互问题必须补实际交互回归测试，必要时走 Playwright。
- 凡是安全修复，都必须补对应的仓库扫描或回归校验。
- 技术说明同时写入 `bug/` 和 `test-suite/docs/`，保证后续模型可直接接手。

详细规则见：
- [test-suite/README.md](C:/Users/16053/proj/07-story/Creator-Studio/test-suite/README.md)
- [test-suite/docs/testing-rules.md](C:/Users/16053/proj/07-story/Creator-Studio/test-suite/docs/testing-rules.md)

## 打包

### 本地构建

```bash
npm run tauri:build
```

该命令会执行三件事：
- 构建 AI engine sidecar
- 执行 Tauri release build
- 将最终安装包同步复制到项目根目录 `release/`

### Tauri 实际输出目录

Tauri 原始 bundle 输出目录不是根目录 `release/`，而是：

- `src-tauri/target/release/bundle/msi/`
- `src-tauri/target/release/bundle/nsis/`
- macOS 对应 `src-tauri/target/release/bundle/dmg/`

项目根目录 `release/` 的作用是：

- 作为统一交付目录
- 方便人工验收
- 方便后续上传到 GitHub 或发给测试同学

### 打包前检查

- 确认版本号已更新
- 先跑核心回归测试
- 确认默认 Provider 配置存在且模型选择正常
- 确认没有硬编码 API key
- 确认安装后 AI 引擎能正常启动
- 确认不会弹黑色 shell 窗口

相关记录见：
- [bug/package_building_notes.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/package_building_notes.md)
- [bug/default_provider_dashscope_qwen_demo.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/default_provider_dashscope_qwen_demo.md)

## 发布

### 当前约定

- 每次完成可交付构建后，把最新安装包同步到项目根目录 `release/`
- 对外说明时，以 `release/` 中的产物为准
- 不把 Tauri 内部产物路径直接发给最终用户
- 不得把任何真实 API key 写入代码、文档、测试样例或安装包默认配置

### 推荐发布流程

1. 更新版本号
2. 运行核心回归测试
3. 执行 `npm run tauri:build`
4. 验证 `release/` 中的最新 MSI/EXE
5. 安装后做一次实际启动与 AI 请求验证
6. 确认 GitHub Release 附件不包含敏感信息
7. 再上传到 GitHub Release 或交付渠道

如果只是需要本地找到安装包：

- 根目录交付目录：[`release/`](C:/Users/16053/proj/07-story/Creator-Studio/release)
- Tauri 原始输出目录：[`src-tauri/target/release/bundle/`](C:/Users/16053/proj/07-story/Creator-Studio/src-tauri/target/release/bundle)

## 目录说明

- [`src/`](C:/Users/16053/proj/07-story/Creator-Studio/src)：前端界面与编辑器逻辑
- [`src-tauri/`](C:/Users/16053/proj/07-story/Creator-Studio/src-tauri)：Tauri 后端、配置和 sidecar 启动逻辑
- [`packages/ai-engine/`](C:/Users/16053/proj/07-story/Creator-Studio/packages/ai-engine)：AI 引擎源码
- [`scripts/`](C:/Users/16053/proj/07-story/Creator-Studio/scripts)：构建与产物同步脚本
- [`test-suite/`](C:/Users/16053/proj/07-story/Creator-Studio/test-suite)：独立测试工程
- [`bug/`](C:/Users/16053/proj/07-story/Creator-Studio/bug)：缺陷记录、修复注释、打包与回归说明
- [`release/`](C:/Users/16053/proj/07-story/Creator-Studio/release)：同步后的交付产物目录

## 最近重点修复

- 修复安装版 AI 引擎启动失败问题
- 修复安装后频繁弹出黑色 shell 窗口问题
- 修复编辑器自动保存后内容被旧状态覆盖的问题
- 补齐 `Ctrl+S`、`Ctrl+Z`、`Ctrl+Y`、`Ctrl+Shift+Z`、`Ctrl+A` 等常用快捷键
- 建立 Windows demo、默认 Provider、AI sidecar、编辑器交互回归测试
- 移除硬编码 API key，并加入泄露密钥清理和仓库扫描测试

对应文档：
- [bug/editor_autosave_content_loss.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/editor_autosave_content_loss.md)
- [bug/editor_shortcuts_improvement.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/editor_shortcuts_improvement.md)
- [bug/editor_interaction_regression_tests.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/editor_interaction_regression_tests.md)
- [bug/windows_demo_server_connection_note.md](C:/Users/16053/proj/07-story/Creator-Studio/bug/windows_demo_server_connection_note.md)
