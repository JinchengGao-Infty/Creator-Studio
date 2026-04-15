import type { ChatMessage } from "../../lib/ai";
import { formatWritingPreset } from "../../lib/writingPresets";
import type { WritingPreset } from "../../types/writingPreset";
import type { PanelMessage } from "./types";

export type ContinuePhase = "draft" | "apply";

export const CONTINUE_DRAFT_MARKER = "<<<CONTINUE_DRAFT>>>";

function chapterFilePath(chapterId: string) {
  return `chapters/${chapterId}.txt`;
}

export function stripContinueDraftMarker(reply: string): { isDraft: boolean; content: string } {
  const normalized = reply.replace(/^\uFEFF/, "");
  const escapedMarker = CONTINUE_DRAFT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\r?\\n)\\s*${escapedMarker}\\s*(\\r?\\n|$)`);
  const match = re.exec(normalized);
  if (!match) return { isDraft: false, content: reply };

  const after = normalized.slice(match.index + match[0].length);
  return { isDraft: true, content: after.replace(/^\s+/, "") };
}

export function buildMessagesForAi(workingMessages: PanelMessage[]): ChatMessage[] {
  return workingMessages
    .filter((m) => {
      if (m.role === "user" || m.role === "assistant") return true;
      if (m.role === "system" && m.content.startsWith("[系统摘要]")) return true;
      return false;
    })
    .map((m) => ({
      role: m.role as ChatMessage["role"],
      content: m.content,
    }));
}

function buildContinueSystemPrompt(params: {
  projectPath: string;
  chapterId: string;
  chapterTitle?: string | null;
  writingPreset: string;
  phase: ContinuePhase;
}): string {
  const chapterLabel = params.chapterTitle ? `${params.chapterTitle}（${params.chapterId}）` : params.chapterId;
  const chapterPath = chapterFilePath(params.chapterId);
  const phaseHint =
    params.phase === "apply"
      ? "【应用阶段】用户已确认追加。请将你上一条提供的续写预览原文（不要改写）追加到章节末尾，然后保存本次续写的摘要。"
      : "【草稿阶段】请先读取上下文并生成续写预览。此阶段严禁调用 append/write/save_summary 修改任何文件。";

  return `
你是一位专业的小说续写 AI Agent。你的任务是帮助作者续写当前章节内容。

## 可用工具
- read: 读取章节内容
- list: 列出目录内容（需要时）
- search: 搜索摘要获取前情
- get_chapter_info: 获取当前章节信息（路径、字数等）
- rag_search: 在知识库（knowledge/）中语义检索相关资料
- append: 追加续写内容到章节末尾（仅在用户确认后）
- save_summary: 保存本次续写的摘要（仅在用户确认后）

## 当前阶段
${phaseHint}

## 工作流程（草稿阶段）
1. 首先用 read 读取当前章节的最后部分（建议 offset: -2000）作为上下文
2. 可用 rag_search 检索 knowledge/ 里的设定/人物/时间线资料
3. 用 search 搜索 summaries.json 相关摘要，了解前情和人物关系
4. 根据用户指令和上下文，生成续写内容（约 500-1000 字）
5. 输出“续写预览”（只输出正文，不要把工具返回的 JSON 原样贴出来），等待用户确认

## 工作流程（应用阶段）
1. 用户已确认后，调用 append 将“上一条续写预览原文”追加到章节文件末尾
2. 调用 save_summary 保存本次续写摘要（50-100 字左右，chapterId: ${params.chapterId}）
3. 回复用户：已追加、摘要已保存，并可提示当前字数

## 写作要求
${params.writingPreset}

## 当前项目
- 项目路径：${params.projectPath}
- 当前章节：${chapterLabel}
- 章节文件：${chapterPath}
- 摘要文件：summaries.json

## 注意
- 续写内容要与前文风格一致，保持人物性格与情节连贯
- 追加前必须让用户确认；未确认时禁止调用 append/save_summary/write
- 应用阶段 append 时必须使用上一条你给出的预览原文，不要改写或重新生成
  `.trim();
}

function buildUnifiedSystemPrompt(params: {
  projectPath: string;
  chapterId: string | null;
  chapterTitle: string | null;
  writingPreset: string;
}): string {
  const chapterLabel = params.chapterId
    ? params.chapterTitle
      ? `${params.chapterTitle}（${params.chapterId}）`
      : params.chapterId
    : "未选择章节";
  const chapterPath = params.chapterId ? chapterFilePath(params.chapterId) : "（未选择章节）";

  return `
你是 Creator Studio 的小说写作 AI Agent。你要在同一个对话中同时支持“讨论”和“续写”，并能自动判断用户意图。

## 工具（重要）
- 可读工具：list / read / search / get_chapter_info
- 写入工具：append / write / save_summary
- RAG 工具：rag_search（从 knowledge/ 语义检索资料）

写入工具只能在用户明确确认“确认追加”后使用；在未确认阶段严禁调用 append/write/save_summary。

## 自动判断意图
1) 讨论类：用户在聊剧情、人物、设定、结构、润色建议等
   - 你可以主动调用 list/read/search/get_chapter_info 读取上下文
   - 只给建议与方案，不要修改任何文件

2) 续写类：用户要求继续写某一章正文
   - 续写必须分为两阶段：草稿阶段 → 用户确认 → 应用阶段

## 续写草稿阶段（默认）
1. 先用 read 读取当前章节最后部分作为上下文（建议 offset: -2000）
2. 可用 rag_search 检索 knowledge/ 里的设定/人物/时间线资料
3. 用 search 搜索 summaries.json 相关摘要，确保前后连贯
4. 输出 500-1000 字的“正文续写预览”

输出格式必须严格遵守（为了让前端识别草稿）：
- 第一行：${CONTINUE_DRAFT_MARKER}
- 从第二行开始：只输出“纯正文预览”，不要标题/解释/Markdown

然后询问用户是否“确认追加”。

## 续写应用阶段（仅当用户明确说“确认追加”）
1. 使用 append 将你上一条给出的“正文预览原文（不要改写）”追加到章节文件末尾
2. 使用 save_summary 保存 50-120 字摘要（chapterId 使用当前章节）
3. 回复用户：已追加、摘要已保存，并可提示本章当前字数

## 当前项目
- 项目路径：${params.projectPath}
- 当前选中章节：${chapterLabel}
- 章节文件：${chapterPath}
- 摘要文件：summaries.json

## 写作要求
${params.writingPreset}

## 注意
- 如果用户要续写但当前没有选中章节，请先追问要续写哪一章，或提示用户在左侧选择章节。
  `.trim();
}

export function buildWritingContextBundle(params: {
  projectPath: string;
  workingMessages: PanelMessage[];
  preset: WritingPreset;
  allowWrite: boolean;
  continuePhase: ContinuePhase;
  chapterId: string | null;
  chapterTitle: string | null;
  worldSummary?: string;
}): {
  messagesForAi: ChatMessage[];
  finalSystemPrompt: string;
  presetPrompt: string;
} {
  const presetPrompt = formatWritingPreset(params.preset);
  const systemPrompt =
    params.allowWrite && params.chapterId
      ? buildContinueSystemPrompt({
          projectPath: params.projectPath,
          chapterId: params.chapterId,
          chapterTitle: params.chapterTitle,
          writingPreset: presetPrompt,
          phase: params.continuePhase,
        })
      : buildUnifiedSystemPrompt({
          projectPath: params.projectPath,
          chapterId: params.chapterId,
          chapterTitle: params.chapterTitle,
          writingPreset: presetPrompt,
        });

  const finalSystemPrompt = params.worldSummary?.trim()
    ? `${systemPrompt}\n\n${params.worldSummary.trim()}`
    : systemPrompt;

  return {
    messagesForAi: buildMessagesForAi(params.workingMessages),
    finalSystemPrompt,
    presetPrompt,
  };
}
