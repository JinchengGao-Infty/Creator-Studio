import { invoke } from "@tauri-apps/api/core";
import {
  createDefaultWritingPreset,
  DEFAULT_PRESET_ID,
  type WritingPreset,
} from "../types/writingPreset";

export interface WritingPresetsState {
  presets: WritingPreset[];
  activePresetId: string;
}

interface GetPresetsResponse {
  presets: WritingPreset[];
  active_preset_id: string;
}

export async function getWritingPresets(projectPath: string): Promise<WritingPresetsState> {
  const fallback = createDefaultWritingPreset();

  const result = (await invoke("get_presets", {
    project_path: projectPath,
  })) as Partial<GetPresetsResponse> | null;

  const presets = Array.isArray(result?.presets) && result?.presets.length ? result.presets : [fallback];
  const activePresetId = typeof result?.active_preset_id === "string" && result.active_preset_id.trim()
    ? result.active_preset_id
    : presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? DEFAULT_PRESET_ID;

  return { presets, activePresetId };
}

export async function saveWritingPresets(params: {
  projectPath: string;
  presets: WritingPreset[];
  activePresetId: string;
}): Promise<void> {
  await invoke("save_presets", {
    project_path: params.projectPath,
    presets: params.presets,
    active_preset_id: params.activePresetId,
  });
}

export function buildSystemPrompt(preset: WritingPreset, basePrompt: string): string {
  const styleDesc = `
写作风格要求：
- 文风：${preset.style.tone}
- 叙事视角：${preset.style.perspective}
- 时态：${preset.style.tense}
- 描写风格：${preset.style.description}
`;

  const rulesDesc =
    preset.rules.length > 0 ? `\n写作规则：\n${preset.rules.map((r) => `- ${r}`).join("\n")}` : "";

  const customDesc = preset.customPrompt ? `\n额外要求：\n${preset.customPrompt}` : "";

  return `${basePrompt}\n${styleDesc}${rulesDesc}${customDesc}`.trim();
}

