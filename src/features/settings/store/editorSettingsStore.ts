/**
 * 编辑器设置状态管理
 *
 * 统一管理编辑器外观和格式设置，包括背景、字体、行宽、缩进等配置
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 预设字体配置
 */
export interface PresetFont {
  id: string;
  name: string;
  value: string;
}

/**
 * 预设背景配置
 */
export interface PresetBackground {
  id: string;
  name: string;
  color: string;
}

/**
 * 默认预设字体列表
 */
export const PRESET_FONTS: PresetFont[] = [
  {
    id: 'system',
    name: '系统默认',
    value: '"PingFang SC","Microsoft YaHei",system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
  },
  { id: 'pingfang', name: '苹方', value: '"PingFang SC"' },
  {
    id: 'songti',
    name: '思源宋体',
    value: '"Noto Serif SC","Songti SC",serif',
  },
  { id: 'sans', name: '思源黑体', value: '"Noto Sans SC"' },
  { id: 'wenkai', name: '霞鹜文楷', value: '"LXGW WenKai"' },
  { id: 'harmony', name: '鸿蒙黑体', value: '"HarmonyOS Sans SC"' },
  { id: 'kaiti', name: '楷体', value: '"KaiTi","楷体","STKaiti"' },
];

/**
 * 默认预设背景列表
 */
export const PRESET_BACKGROUNDS: PresetBackground[] = [
  { id: 'paper', name: '纸张', color: '#faf8f5' },
  { id: 'cream', name: '米黄', color: '#fdf6e3' },
  { id: 'sepia', name: '羊皮纸', color: '#f4ecd8' },
  { id: 'sage', name: '淡绿', color: '#e8f0e8' },
  { id: 'sky', name: '淡蓝', color: '#e8f4f8' },
];

/**
 * 编辑器设置接口
 */
export interface EditorSettings {
  // 背景设置
  /** 背景类型：solid-纯色, preset-预设, custom-自定义 */
  backgroundType: 'solid' | 'preset' | 'custom';
  /** 纯色背景颜色，默认 #faf8f5 */
  backgroundColor: string;
  /** 预设背景图片ID */
  presetBackground: string;
  /** 自定义背景图片URL（base64或blob） */
  customBackgroundUrl: string;
  /** 背景透明度 0-100，默认100 */
  backgroundOpacity: number;
  /** 背景适配方式 */
  backgroundFit: 'cover' | 'contain' | 'center';

  // 字体设置
  /** 字体名称 */
  fontFamily: string;
  /** 字号 14-24，默认16 */
  fontSize: number;
  /** 行高 1.5-2.5，默认1.8 */
  lineHeight: number;

  // 固定行宽设置
  /** 是否启用固定行宽 */
  fixedLineWidthEnabled: boolean;
  /** 每行字符数 40-80，默认60 */
  lineWidth: number;
  /** 是否显示右边距指示线 */
  showMarginLine: boolean;

  // 缩进设置
  /** 空格宽度比例（相对于汉字宽度）1.0-1.5，默认1.0（一个空格=一个汉字位置） */
  spaceWidthRatio: number;
  /** Tab宽度（汉字数）1-4，默认2 */
  tabWidth: number;
  /** 是否启用首行缩进 */
  firstLineIndentEnabled: boolean;
  /** 首行缩进字符数，默认2 */
  firstLineIndentChars: number;
}

/**
 * 默认编辑器设置
 */
const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  // 背景设置
  backgroundType: 'solid',
  backgroundColor: '#faf8f5',
  presetBackground: 'paper',
  customBackgroundUrl: '',
  backgroundOpacity: 100,
  backgroundFit: 'cover',

  // 字体设置
  fontFamily: PRESET_FONTS[0].value,
  fontSize: 16,
  lineHeight: 1.8,

  // 固定行宽设置
  fixedLineWidthEnabled: false,
  lineWidth: 60,
  showMarginLine: true,

  // 缩进设置
  spaceWidthRatio: 1.0,
  tabWidth: 2,
  firstLineIndentEnabled: true,
  firstLineIndentChars: 2,
};

/**
 * 编辑器设置 Store 接口
 */
export interface EditorSettingsStore {
  /** 当前编辑器设置 */
  settings: EditorSettings;
  /** 更新部分设置 */
  updateSettings: (updates: Partial<EditorSettings>) => void;
  /** 重置为默认设置 */
  resetSettings: () => void;
  /** 获取预设字体 */
  getPresetFont: (id: string) => PresetFont | undefined;
  /** 获取预设背景 */
  getPresetBackground: (id: string) => PresetBackground | undefined;
}

/**
 * 编辑器设置状态管理 Store
 * 使用 Zustand 进行状态管理，支持 localStorage 持久化
 */
export const useEditorSettingsStore = create<EditorSettingsStore>()(
  persist(
    (set) => ({
      // 初始状态
      settings: { ...DEFAULT_EDITOR_SETTINGS },

      /**
       * 更新部分设置
       * @param updates - 要更新的设置字段
       */
      updateSettings: (updates) => {
        set((state) => ({
          settings: { ...state.settings, ...updates },
        }));
      },

      /**
       * 重置为默认设置
       */
      resetSettings: () => {
        set({ settings: { ...DEFAULT_EDITOR_SETTINGS } });
      },

      /**
       * 获取预设字体
       * @param id - 字体ID
       */
      getPresetFont: (id) => {
        return PRESET_FONTS.find((font) => font.id === id);
      },

      /**
       * 获取预设背景
       * @param id - 背景ID
       */
      getPresetBackground: (id) => {
        return PRESET_BACKGROUNDS.find((bg) => bg.id === id);
      },
    }),
    {
      name: 'editor-settings',
    }
  )
);

// 导出默认设置常量供外部使用
export { DEFAULT_EDITOR_SETTINGS };

export default useEditorSettingsStore;
