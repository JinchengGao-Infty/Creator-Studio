# 测试与缺陷处理规范

## 目标

这份文档给后续模型和开发者使用，统一约束测试、演示、修复和文档补充流程。

## 基本规则

- 新增功能时，要在 `test-suite/` 中补至少一个对应测试或检查项。
- 修复 bug 时，要同步做三件事：
  - 在 `test-suite/` 补一个能覆盖该问题的测试或检查项
  - 在 `bug/` 下新增或更新缺陷说明
  - 在文档里写清根因、修复点、验证方式
- 交互类问题也算 bug，快捷键、焦点、菜单、提示文案都要补测试或检查项。
- 默认内置 Provider 也是回归范围，修改模型接入时必须补一个 `test-suite` 检查项，确保内置 ID、URL、Provider Type、模型名和激活状态都正确。
- 演示程序时，不要直接把开发态产物当成交付版本。
- Windows 演示优先使用安装版或发布版产物，不使用 `src-tauri/target/debug/creatorai-v2.exe`。
- 安装包问题必须区分“发布目录可运行”和“安装版可运行”，后者必须单独验证。
- 修复安装版问题时，版本号必须递增，避免 MSI 沿用旧版本导致覆盖不完整。

## 测试工程约定

- `test-suite/run.mjs` 是统一入口。
- `test-suite/cases/` 存放各类测试编排。
- 一个文件只负责一类测试，不把所有逻辑堆到单一脚本里。
- 根目录 `npm script` 只做转发，测试实现收敛到 `test-suite/`。
- `npm run tauri:build` 后，安装包应同步复制到项目根目录 `release/`。

## Bug 处理流程

1. 先定位问题是代码缺陷、配置问题、环境问题，还是错误使用方式。
2. 修复后必须补测试。
3. 测试命名要能看出覆盖的问题。
4. 在 `bug/` 文档里补技术注释：
   - 问题现象
   - 影响范围
   - 根因
   - 修复方案
   - 验证结果
   - 后续注意事项

## 安装版专项规则

- 只要问题涉及 MSI / 安装版，必须额外检查安装后的真实目录内容。
- 至少检查：
  - 安装根目录中的 `creatorai-v2.exe`
  - 安装根目录或 `bin/` 下的 `ai-engine` sidecar
  - 安装后的应用是否能成功启动
- 如果修复涉及首启清理、用户目录、WebView 数据目录，必须验证安装后应用不会闪退。

## Windows 演示特别规则

- `src-tauri/target/debug/creatorai-v2.exe` 是开发态/调试态产物。
- 调试态产物可能依赖 `http://localhost:1420` 这样的开发服务器。
- 如果直接运行调试态产物，出现“无法连接服务器/无法连接 localhost”不代表业务功能故障。
- 对外演示、验收、录屏、交付时，应使用安装版或发布版：
  - 例如 `C:\Program Files\CreatorAI\creatorai-v2.exe`

## 当前固定检查项

- `npm run test:regression`
- `npm run test:default-provider`
- `npm run test:ai-engine-sidecar`
- `npm run test:editor-shortcuts`
- `npm run test:editor-e2e`
- `npm run test:windows-demo`
