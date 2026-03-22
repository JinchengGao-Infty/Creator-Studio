# 编辑器常用快捷键体验补强

## 背景

- 用户反馈文本编辑器中的 `Ctrl+S`、`Ctrl+Z` 等常用快捷键体验不稳定，不符合桌面编辑器预期。

## 处理目标

- 让编辑器快捷键更贴近 Windows 常见写作软件和代码编辑器习惯。
- 把这类问题固定成测试和文档要求，避免后续退化。

## 本次改动

- 在 [`src/components/Editor/Editor.tsx`](c:\Users\16053\proj\07-story\Creator-Studio\src\components\Editor\Editor.tsx) 中显式绑定：
  - `Mod-z`
  - `Mod-Shift-z`
  - Windows/Linux `Ctrl-y`
  - `Mod-a`
  - `Mod-s`
  - Windows/Linux `Ctrl-Shift-s`
- 在 [`src/components/Editor/EditorHeader.tsx`](c:\Users\16053\proj\07-story\Creator-Studio\src\components\Editor\EditorHeader.tsx) 中同步更新快捷键提示文案。

## 技术注释

- CodeMirror 官方已有 `historyKeymap`，但桌面产品中用户对 `Ctrl+Y` 的预期很强，因此需要显式覆盖。
- 全选通过 `EditorSelection.single(0, view.state.doc.length)` 直接选中全文。
- 显式快捷键要设置 `preventDefault: true`，否则浏览器默认行为可能干扰编辑器交互。

## 验证

- `npm run test:editor-shortcuts`
- `npm run build`
