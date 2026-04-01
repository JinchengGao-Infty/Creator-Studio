/**
 * 首行缩进扩展
 * 
 * 功能：在段落开头按 Enter 后，自动在新段落添加首行缩进
 * 用于中文写作的首行缩进格式（每段开头空两格）
 * 
 * 注意：空格键宽度控制现在在 Editor.tsx 中处理
 */

import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * 检测当前位置是否是段落开头
 * 段落开头定义为：前面是空行或只有空白字符
 * 
 * @param doc - CodeMirror 文档对象
 * @param pos - 当前位置
 * @returns 是否是段落开头
 */
function isParagraphStart(doc: { sliceString: (from: number, to: number) => string }, pos: number): boolean {
  if (pos === 0) return true;

  // 获取前一段文本（最多回溯100个字符）
  const textBefore = doc.sliceString(Math.max(0, pos - 100), pos);
  const lastNewline = textBefore.lastIndexOf("\n");

  // 如果没有换行符，检查整个文本是否是空白
  if (lastNewline === -1) {
    return textBefore.trim().length === 0;
  }

  // 检查最后一行是否是空行或只有空白
  const lastLine = textBefore.slice(lastNewline + 1);
  return lastLine.trim().length === 0;
}

/**
 * 创建首行缩进扩展
 * 
 * @param enabled - 是否启用首行缩进
 * @param indentChars - 缩进字符数（中文写作通常为2）
 * @param spaceWidthRatio - 空格宽度比例（相对于汉字宽度）
 * @returns CodeMirror 扩展
 */
export function firstLineIndentExtension(
  enabled: boolean, 
  indentChars: number,
  spaceWidthRatio: number = 1.0
): Extension {
  // 如果未启用首行缩进，返回空数组
  if (!enabled) return [];

  return keymap.of([
    {
      key: "Enter",
      run: (view: EditorView) => {
        const { state } = view;
        const selection = state.selection.main;
        const pos = selection.head;

        // 检查当前位置是否是段落开头
        const isStart = isParagraphStart(state.doc, pos);

        if (isStart) {
          // 计算缩进空格数
          // 
          // 目标：indentChars 个汉字宽
          // 每个空格 = spaceWidthRatio 个汉字宽
          // 所以需要的空格数 = indentChars / spaceWidthRatio
          //
          // 例如：
          // - indentChars = 2 (2个汉字宽)
          // - spaceWidthRatio = 1.0 (每个空格 = 1个汉字宽)
          // - 需要的空格数 = 2 / 1.0 = 2 个空格 ✓
          //
          // - indentChars = 2 (2个汉字宽)
          // - spaceWidthRatio = 0.5 (每个空格 = 半个汉字宽)
          // - 需要的空格数 = 2 / 0.5 = 4 个空格 ✓
          const spaceCount = Math.round(indentChars / spaceWidthRatio);
          const spaces = " ".repeat(spaceCount);

          // 延迟执行，确保先插入换行符
          setTimeout(() => {
            if (!view.state) return;
            const newPos = view.state.selection.main.head;
            view.dispatch({
              changes: { from: newPos, insert: spaces },
              selection: { anchor: newPos + spaces.length },
            });
          }, 0);
        }

        // 返回 false 以继续执行默认的换行行为
        return false;
      },
    },
  ]);
}

export { isParagraphStart };
