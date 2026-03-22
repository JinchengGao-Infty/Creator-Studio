# 编辑器快捷键规范

## 目标

编辑器必须符合桌面写作软件的常见快捷键预期，尤其是 Windows 用户的肌肉记忆。

## 当前要求

- `Ctrl+S` / `Cmd+S`: 保存
- `Ctrl+Z` / `Cmd+Z`: 撤销
- `Ctrl+Shift+Z` / `Cmd+Shift+Z`: 重做
- Windows/Linux 额外支持 `Ctrl+Y`: 重做
- `Ctrl+A` / `Cmd+A`: 全选

## 实现说明

- 编辑器使用 CodeMirror 6。
- 默认历史能力来自官方 `history()` 和 `historyKeymap`。
- 对桌面常用键位再做显式绑定，避免浏览器默认行为抢占快捷键。
- 显式绑定需要设置 `preventDefault: true`。

## 测试要求

- 每次改动编辑器快捷键后，至少运行：
  - `npm run test:editor-e2e`
  - `npm run test:editor-shortcuts`
  - `npm run build`
- 如果变更影响保存、撤销、重做行为，应补充新的 `test-suite/cases/` 检查项。
- 如果变更影响真实交互，应补充 `test-suite/e2e/` 中的浏览器级测试。

## 兼容性备注

- `Ctrl+C / Ctrl+V / Ctrl+X` 主要依赖浏览器和 CodeMirror 原生剪贴板行为。
- 如果后续发现剪贴板或输入法冲突，需要单独补专项测试和文档。
