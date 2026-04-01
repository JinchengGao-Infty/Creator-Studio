/**
 * 编辑器主题系统
 *
 * 根据 EditorSettings 配置生成 CodeMirror 的 EditorView.theme() 扩展
 * 支持背景、字体、行宽等设置
 * 使用 CSS 变量实现深色/浅色主题自动切换
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { EditorSettings } from "../../features/settings/store/editorSettingsStore";
import { PRESET_BACKGROUNDS } from "../../features/settings/store/editorSettingsStore";

// ============================================================
// 主题检测函数
// ============================================================

/**
 * 检测当前是否为暗色主题
 */
export function isDarkTheme(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ============================================================
// 颜色配置对象（使用 CSS 变量）
// ============================================================

/**
 * 编辑器主题配置接口
 */
export interface EditorThemeConfig {
  /** 编辑器基础样式 */
  editor: {
    color: string;
    caretColor: string;
  };
  /** Scroller 滚动区域 */
  scroller: {
    fontFamily: string | null;
    fontSize: string | null;
    lineHeight: string | null;
  };
  /** 选中样式 */
  selection: {
    background: string;
  };
  /** 光标样式 */
  cursor: {
    borderLeftColor: string;
  };
  /** 行高亮 */
  lineHighlight: {
    background: string;
  };
  /** 行号 gutter 背景 */
  gutter: {
    background: string;
  };
  /** 是否为暗色主题（用于特殊处理） */
  isDark: boolean;
}

/**
 * 获取编辑器主题配置
 * 根据全局主题自动选择合适的颜色
 */
export function getEditorThemeConfig(): EditorThemeConfig {
  const isDark = isDarkTheme();
  
  return {
    // 编辑器基础样式
    editor: {
      color: "var(--editor-text)",
      caretColor: "var(--editor-cursor)",
    },
    // Scroller 滚动区域
    scroller: {
      fontFamily: null as string | null,  // 由设置控制
      fontSize: null as string | null,   // 由设置控制
      lineHeight: null as string | null, // 由设置控制
    },
    // 选中样式
    selection: {
      background: "var(--editor-selection)",
    },
    // 光标样式
    cursor: {
      borderLeftColor: "var(--editor-cursor)",
    },
    // 行高亮
    lineHighlight: {
      background: "var(--editor-line-highlight)",
    },
    // 行号 gutter 背景
    gutter: {
      background: "var(--editor-gutter)",
    },
    // 是否为暗色主题
    isDark,
  };
}

// ============================================================
// 背景计算函数
// ============================================================

/**
 * 计算背景值
 * 根据背景类型返回对应的背景值
 *
 * @param settings - 编辑器设置
 * @returns 背景值字符串
 */
function getBackgroundValue(settings: EditorSettings): string {
  switch (settings.backgroundType) {
    case 'solid':
      return settings.backgroundColor;
    case 'preset': {
      // 预设背景使用纯色
      const bg = PRESET_BACKGROUNDS.find(b => b.id === settings.presetBackground);
      return bg?.color || '#faf8f5';
    }
    case 'custom':
      return settings.customBackgroundUrl
        ? `url(${settings.customBackgroundUrl})`
        : 'transparent';
    default:
      return 'transparent';
  }
}

// ============================================================
// 创建编辑器主题函数
// ============================================================

/**
 * 创建 CodeMirror 编辑器主题
 *
 * 根据编辑器设置生成 EditorView.theme() 扩展
 * 支持根据全局主题自动切换亮/暗样式
 *
 * @param settings - 编辑器设置
 * @returns CodeMirror Extension
 */
export function createEditorTheme(settings: EditorSettings): Extension {
  const config = getEditorThemeConfig();
  
  // 计算空格宽度的 CSS 值
  // spaceWidthRatio: 空格宽度相对于汉字宽度的比例 (0.3-0.8，默认0.5)
  // 一个空格 = spaceWidthRatio em
  // 例如: spaceWidthRatio = 0.5 时，空格宽度为 0.5em
  
  // 计算 Tab 宽度的 CSS 值
  // tabWidth: Tab 宽度（以汉字数为单位）(1-4，默认2)
  // Tab 宽度 = tabWidth 个汉字宽 = tabWidth em
  const tabWidthCss = `${settings.tabWidth}em`;
  
  // 计算首行缩进的 CSS 值
  // 首行缩进字符数 * 汉字宽度（1em）* 字号（px）
  // 注意：这里使用 em 单位来保持与汉字宽度的比例
  const firstLineIndentCss = `${settings.firstLineIndentChars}em`;

  return EditorView.theme({
    "&": {
      height: "100%",
      background: getBackgroundValue(settings),
      color: config.editor.color,
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily: settings.fontFamily,
      fontSize: `${settings.fontSize}px`,
      lineHeight: String(settings.lineHeight),
      padding: "20px 24px",
    },
    ".cm-content": {
      caretColor: config.editor.caretColor,
      // 注意：空格宽度现在由 firstLineIndent.ts 通过插入多个空格字符控制
      // 不再使用 CSS letterSpacing，因为那会影响所有字符的间距
      ...(settings.fixedLineWidthEnabled && {
        maxWidth: `${settings.lineWidth}ch`,
        marginRight: "20px",
        wordBreak: "break-word", // 智能断行
      }),
    },
    ".cm-line": {
      // 【关键修复】首行缩进使用 em 单位以匹配汉字宽度
      // 2em = 2个汉字宽度（因为汉字 = 1em）
      ...(settings.firstLineIndentEnabled && {
        textIndent: firstLineIndentCss,
      }),
    },
    ".cm-tab": {
      // Tab 宽度 = tabWidth 个汉字宽
      // tabWidth = 2 时，Tab = 2em
      width: tabWidthCss,
      // 可选：添加 Tab 字符的视觉样式
      display: "inline-block",
    },
    // 选中背景
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      background: config.selection.background,
    },
    // 光标
    "&.cm-focused .cm-cursor": {
      borderLeftColor: config.cursor.borderLeftColor,
    },
    // 行高亮
    ".cm-activeLine": {
      backgroundColor: config.lineHighlight.background,
    },
    ".cm-activeLineGutter": {
      backgroundColor: config.lineHighlight.background,
    },
    // 行号 gutter 背景
    ".cm-gutters": {
      backgroundColor: config.gutter.background,
    },
  }, { dark: config.isDark });
}

// ============================================================
// 辅助函数
// ============================================================

/**
 * 获取背景样式
 * 用于编辑器容器的背景样式配置
 *
 * @param settings - 编辑器设置
 * @returns React CSS 属性对象
 */
export function getBackgroundStyles(settings: EditorSettings): React.CSSProperties {
  const base: React.CSSProperties = {};

  switch (settings.backgroundType) {
    case 'solid':
      base.backgroundColor = settings.backgroundColor;
      break;
    case 'preset': {
      const bg = PRESET_BACKGROUNDS.find(b => b.id === settings.presetBackground);
      base.backgroundColor = bg?.color || '#faf8f5';
      break;
    }
    case 'custom':
      if (settings.customBackgroundUrl) {
        base.backgroundImage = `url(${settings.customBackgroundUrl})`;
        base.backgroundSize = settings.backgroundFit || 'cover';
        base.backgroundPosition = 'center';
        base.backgroundRepeat = 'no-repeat';
        base.opacity = settings.backgroundOpacity / 100;
      }
      break;
  }

  return base;
}

/**
 * 获取右边距指示线样式
 * 当启用固定行宽和右边距指示线时，返回指示线的 CSS 样式
 *
 * @param settings - 编辑器设置
 * @returns CSS 属性对象或 null（当不显示指示线时）
 */
export function getMarginLineStyle(settings: EditorSettings): React.CSSProperties | null {
  if (!settings.fixedLineWidthEnabled || !settings.showMarginLine) {
    return null;
  }

  // 计算右边距线的位置
  // 20px padding + 超出部分的宽度
  const rightOffset = 20 + (80 - settings.lineWidth) * settings.fontSize * 0.5;

  return {
    position: 'absolute',
    right: `${rightOffset}px`,
    top: 0,
    bottom: 0,
    width: '1px',
    backgroundColor: 'var(--border)',
    pointerEvents: 'none',
    zIndex: 1,
  };
}
