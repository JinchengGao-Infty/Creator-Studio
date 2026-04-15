import { createDefaultWritingPreset, type WritingPreset } from "../types/writingPreset";

const SECTION_STYLE = "风格";
const SECTION_RULES = "写作规则";
const SECTION_CUSTOM = "额外要求";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function splitSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current = "__root__";
  sections.set(current, []);

  for (const rawLine of normalizeNewlines(text).split("\n")) {
    const heading = rawLine.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    sections.get(current)?.push(rawLine);
  }

  return sections;
}

function extractName(rootLines: string[], fallbackName: string): string {
  for (const line of rootLines) {
    const heading = line.match(/^#\s*(?:预设[:：]\s*)?(.+?)\s*$/);
    if (heading?.[1]?.trim()) return heading[1].trim();
  }
  return fallbackName;
}

function parseStyleLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*[-*]\s*([^:：]+)\s*[:：]\s*(.+?)\s*$/);
  if (!match) return null;
  const key = match[1].trim();
  const value = match[2].trim();
  if (!key || !value) return null;
  return { key, value };
}

function sanitizeRules(lines: string[]): string[] {
  return lines
    .map((line) => line.match(/^\s*[-*]\s*(.+?)\s*$/)?.[1]?.trim() ?? "")
    .filter(Boolean);
}

function inferPresetName(fileName?: string | null): string {
  const base = (fileName ?? "").trim().replace(/\.[^.]+$/, "");
  return base || "导入预设";
}

export function formatPresetAsMarkdown(preset: WritingPreset): string {
  const rulesBlock =
    preset.rules.length > 0
      ? preset.rules.map((rule) => `- ${rule}`).join("\n")
      : "- （暂无，按需要补充）";

  const customPrompt = preset.customPrompt.trim() || "（暂无）";

  return [
    `# 预设：${preset.name}`,
    "",
    `## ${SECTION_STYLE}`,
    `- 文风：${preset.style.tone}`,
    `- 叙事视角：${preset.style.perspective}`,
    `- 时态：${preset.style.tense}`,
    `- 描写风格：${preset.style.description}`,
    "",
    `## ${SECTION_RULES}`,
    rulesBlock,
    "",
    `## ${SECTION_CUSTOM}`,
    customPrompt,
    "",
  ].join("\n");
}

export function parsePresetFromText(text: string, fileName?: string | null): WritingPreset {
  const fallback = createDefaultWritingPreset();
  const sections = splitSections(text);
  const rootLines = sections.get("__root__") ?? [];
  const name = extractName(rootLines, inferPresetName(fileName));

  const styleSection = sections.get(SECTION_STYLE) ?? [];
  const rulesSection = sections.get(SECTION_RULES) ?? [];
  const customSection = sections.get(SECTION_CUSTOM) ?? [];

  const style = { ...fallback.style };
  for (const line of styleSection) {
    const parsed = parseStyleLine(line);
    if (!parsed) continue;
    if (parsed.key === "文风") style.tone = parsed.value;
    if (parsed.key === "叙事视角") style.perspective = parsed.value;
    if (parsed.key === "时态") style.tense = parsed.value;
    if (parsed.key === "描写风格") style.description = parsed.value;
  }

  const rules = sanitizeRules(rulesSection);
  const customPrompt = customSection.join("\n").trim().replace(/^（暂无）$/u, "");

  return {
    ...fallback,
    id: fallback.id,
    name,
    isDefault: false,
    style,
    rules,
    customPrompt,
  };
}
