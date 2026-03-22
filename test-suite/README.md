# Test Suite

这个目录是项目的独立测试工程入口，后续所有测试程序统一放在这里。

## 目录结构

- `run.mjs`: 测试总入口
- `cases/`: 各类测试用例编排

## 当前可运行测试

- `regression`: 回归测试
- `default-provider`: 内置默认 Provider 配置检查
- `editor-shortcuts`: 编辑器快捷键检查
- `editor-e2e`: 编辑器实际交互回归测试
- `windows-demo`: Windows 演示启动检查

## 运行方式

在项目根目录执行：

```bash
npm run test:regression
```

或者进入测试工程目录执行：

```bash
cd test-suite
npm run default-provider
```

```bash
cd test-suite
npm run editor-e2e
```

```bash
cd test-suite
npm run editor-shortcuts
```

```bash
cd test-suite
npm run regression
```

```bash
cd test-suite
npm run windows-demo
```

## 扩展约定

- 新功能测试统一放到 `cases/` 中
- 每个测试文件负责一类能力，不把所有逻辑堆到一个大脚本里
- `run.mjs` 只负责分发，不直接堆业务测试细节
- 演示/发布类问题也要在这里补一个对应测试或检查项
