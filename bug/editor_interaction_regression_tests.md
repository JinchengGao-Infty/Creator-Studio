# 编辑器实际交互回归测试

## 背景

- 仅做源码静态检查不足以覆盖真实键盘交互问题。
- 编辑器快捷键、选区、保存链路需要浏览器级自动化测试。

## 本次新增

- 增加编辑器测试页：
  - [`editor-harness.html`](c:\Users\16053\proj\07-story\Creator-Studio\editor-harness.html)
  - [`src/testHarness/editorHarness.tsx`](c:\Users\16053\proj\07-story\Creator-Studio\src\testHarness\editorHarness.tsx)
- 增加 Playwright 配置：
  - [`playwright.config.ts`](c:\Users\16053\proj\07-story\Creator-Studio\playwright.config.ts)
- 增加实际交互用例：
  - [`test-suite/e2e/editor-shortcuts.spec.ts`](c:\Users\16053\proj\07-story\Creator-Studio\test-suite\e2e\editor-shortcuts.spec.ts)

## 覆盖内容

- `Ctrl+S` 保存
- `Ctrl+Z` 撤销
- `Ctrl+Y` 重做
- `Ctrl+Shift+Z` 重做
- `Ctrl+A` 全选后整体替换

## 技术注释

- 为了让测试稳定，测试页关闭了编辑器的 AI 行内补全，避免异步补全干扰键盘事件验证。
- 测试不依赖 Tauri，直接跑浏览器级页面，因此更适合在调试阶段高频执行。

## 运行方式

- `npm run test:editor-e2e`
