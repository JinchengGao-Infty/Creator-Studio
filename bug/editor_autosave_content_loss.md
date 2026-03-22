# 编辑器自动保存后内容被旧状态覆盖

## 严重级别
- 严重

## 问题现象
- 在文本编辑框持续输入内容后，停顿触发自动保存，约一分钟内可能出现整段文本被清空或回退到旧版本的情况。
- 用户无法稳定保留新输入内容，属于高风险数据丢失缺陷。

## 根因
- 编辑器自动保存成功后，子组件的未保存状态会切换回 `false`。
- 这时父组件 `MainLayout` 中传给编辑器的 `initialContent` 仍然是保存前的旧值。
- 编辑器的同步逻辑在“当前无未保存改动”时会用 `initialContent` 重置编辑器内容，导致刚刚保存成功的新文本被旧内容覆盖。

## 修复方案
- 在 [`src/layouts/MainLayout.tsx`](c:\Users\16053\proj\07-story\Creator-Studio\src\layouts\MainLayout.tsx) 的 `handleSave` 中，Tauri 保存成功后立刻同步：
  - `setChapterContent(content)`
  - `setDraftContent(content)`
- 这样编辑器在自动保存完成后收到的 `initialContent` 已经是最新内容，不会再回滚到旧文本。

## 验证方式
- 执行 `npm run test:regression`
- 手工验证：
  1. 打开任一项目章节。
  2. 连续输入至少 1 分钟。
  3. 停止输入，等待自动保存完成。
  4. 确认文本未消失，重新切换章节后内容仍然存在。
