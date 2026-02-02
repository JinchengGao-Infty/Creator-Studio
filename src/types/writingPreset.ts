export interface WritingPreset {
  id: string;
  name: string;
  isDefault: boolean;
  style: WritingStyle;
  rules: string[];
  customPrompt: string;
}

export interface WritingStyle {
  tone: string;
  perspective: string;
  tense: string;
  description: string;
}

export const DEFAULT_PRESET_ID = "default";

export function createDefaultWritingPreset(): WritingPreset {
  return {
    id: DEFAULT_PRESET_ID,
    name: "默认风格",
    isDefault: true,
    style: {
      tone: "自然流畅",
      perspective: "第三人称有限",
      tense: "过去式",
      description: "适中",
    },
    rules: [],
    customPrompt: "",
  };
}

