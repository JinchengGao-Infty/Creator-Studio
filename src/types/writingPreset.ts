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

export function createBuiltinWritingPresets(): WritingPreset[] {
  return [
    {
      id: DEFAULT_PRESET_ID,
      name: "默认风格",
      isDefault: true,
      style: {
        tone: "自然流畅",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "适中",
      },
      rules: [
        "优先写清当前场景目标，再展开动作和情绪。",
        "避免空泛抒情，细节要服务人物和剧情。",
        "段落之间保持自然过渡，不要跳剪式断层。",
      ],
      customPrompt: "默认追求稳健、自然、可持续连载的正文写法。",
    },
    {
      id: "tight-pacing",
      name: "紧凑推进",
      isDefault: false,
      style: {
        tone: "利落克制",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "偏动作与决策",
      },
      rules: [
        "每个场景都要有明确推进，不要原地打转。",
        "减少空镜和重复心理描写，优先事件、冲突、选择。",
        "结尾尽量留下下一步张力。",
      ],
      customPrompt: "适合剧情推进、追逐、谈判、危机处理这类需要节奏的章节。",
    },
    {
      id: "lyrical-detail",
      name: "细腻抒情",
      isDefault: false,
      style: {
        tone: "细腻温润",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "感官描写更丰富",
      },
      rules: [
        "感官细节要具体，但不要堆砌形容词。",
        "情绪变化通过动作、停顿和环境映射出来。",
        "句子可以稍微舒展，但仍要保持清晰。",
      ],
      customPrompt: "适合情感递进、关系升温、氛围场景和偏文学化段落。",
    },
    {
      id: "cold-suspense",
      name: "冷峻悬疑",
      isDefault: false,
      style: {
        tone: "冷静压抑",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "信息控制更严格",
      },
      rules: [
        "信息要分层释放，不要一次解释完。",
        "可留白，但线索必须真实存在。",
        "避免角色突然话多，保持克制和压迫感。",
      ],
      customPrompt: "适合悬疑、调查、危险接近、人物互相试探的章节。",
    },
    {
      id: "light-comedy",
      name: "轻快喜剧",
      isDefault: false,
      style: {
        tone: "轻松灵动",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "对话驱动更强",
      },
      rules: [
        "笑点优先来自人物反应和关系，而不是硬插段子。",
        "对话要短促，有来回。",
        "轻快不等于轻飘，仍要保留剧情推进。",
      ],
      customPrompt: "适合轻喜、日常互动、反差萌和轻松群像场景。",
    },
    {
      id: "webnovel-hook",
      name: "网文爽感",
      isDefault: false,
      style: {
        tone: "直接有力",
        perspective: "第三人称有限",
        tense: "过去式",
        description: "强调爽点和钩子",
      },
      rules: [
        "尽早亮出本章核心看点，不要藏太久。",
        "冲突和回报要清楚，让读者感到值回一章。",
        "章末尽量留下钩子，吸引继续读。",
      ],
      customPrompt: "适合连载节奏、爽点兑现、反转和章末钩子设计。",
    },
  ];
}

export function createDefaultWritingPreset(): WritingPreset {
  return createBuiltinWritingPresets()[0];
}
