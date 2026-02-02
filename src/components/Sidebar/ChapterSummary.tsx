import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Space, Typography, message } from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { aiChat } from "../../lib/ai";
import { formatError } from "../../utils/error";

type SummaryEntry = {
  chapterId: string;
  summary: string;
  createdAt: number;
};

interface ChapterSummaryProps {
  projectPath: string;
  chapterId: string | null;
  chapterTitle?: string | null;
}

function formatCreatedAt(ts: number): string {
  if (!ts) return "";
  const date = new Date(ts * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

async function copyText(text: string) {
  const value = text.trim();
  if (!value) return;

  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Fallback for environments without clipboard permission.
  }

  const el = document.createElement("textarea");
  el.value = value;
  el.setAttribute("readonly", "true");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
}

function summarySystemPrompt(): string {
  return `
你是一个小说章节摘要助手。你的任务是把“章节正文”压缩成一段简短摘要，帮助作者快速回忆本章发生了什么。

要求：
- 输出一段中文摘要（约 50-120 字，尽量精炼）
- 只陈述本章已发生的事件，不要脑补未写内容
- 不要使用 Markdown、标题、列表、引号
- 只输出摘要正文本身
  `.trim();
}

function summaryUserPrompt(params: { chapterId: string; chapterTitle?: string | null; content: string }): string {
  const title = params.chapterTitle?.trim() ? `《${params.chapterTitle.trim()}》` : "";
  return `
请为章节 ${title}${params.chapterId ? `（${params.chapterId}）` : ""} 生成摘要。

【章节正文】
${params.content}
  `.trim();
}

export default function ChapterSummary({ projectPath, chapterId, chapterTitle }: ChapterSummaryProps) {
  const [entry, setEntry] = useState<SummaryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const createdAtText = useMemo(() => (entry?.createdAt ? formatCreatedAt(entry.createdAt) : ""), [entry]);

  const loadLatest = useCallback(async () => {
    if (!chapterId) {
      setEntry(null);
      return;
    }

    setLoading(true);
    try {
      const result = (await invoke("get_latest_summary", {
        projectPath,
        chapterId,
      })) as SummaryEntry | null;
      setEntry(result ?? null);
    } catch {
      setEntry(null);
    } finally {
      setLoading(false);
    }
  }, [projectPath, chapterId]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  useEffect(() => {
    const onSummariesChanged = (event: Event) => {
      const { detail } = event as CustomEvent<{ projectPath: string; chapterId?: string | null }>;
      if (!detail || detail.projectPath !== projectPath) return;
      if (detail.chapterId && chapterId && detail.chapterId !== chapterId) return;
      void loadLatest();
    };

    window.addEventListener("creatorai:summariesChanged", onSummariesChanged);
    return () => window.removeEventListener("creatorai:summariesChanged", onSummariesChanged);
  }, [projectPath, chapterId, loadLatest]);

  const handleGenerate = async () => {
    if (!chapterId || generating) return;

    setGenerating(true);
    message.loading({ content: "正在生成摘要...", key: "summary", duration: 0 });
    try {
      const content = (await invoke("get_chapter_content", {
        projectPath,
        chapterId,
      })) as string;

      if (!content || !content.trim()) {
        message.error({ content: "章节内容为空，无法生成摘要。", key: "summary" });
        return;
      }

      const { content: summaryText } = await aiChat({
        projectDir: projectPath,
        mode: "Discussion",
        systemPrompt: summarySystemPrompt(),
        chapterId,
        allowWrite: false,
        messages: [
          {
            role: "user",
            content: summaryUserPrompt({ chapterId, chapterTitle, content }),
          },
        ],
      });

      const summary = summaryText.trim();
      if (!summary) {
        message.error({ content: "AI 未返回摘要，请重试。", key: "summary" });
        return;
      }

      const saved = (await invoke("save_summary_entry", {
        projectPath,
        chapterId,
        summary,
      })) as SummaryEntry;

      setEntry(saved);
      window.dispatchEvent(
        new CustomEvent("creatorai:summariesChanged", { detail: { projectPath, chapterId } }),
      );
      message.success({ content: "摘要已保存", key: "summary" });
    } catch (error) {
      message.error({ content: `生成摘要失败: ${formatError(error)}`, key: "summary" });
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!entry?.summary?.trim()) return;
    try {
      await copyText(entry.summary);
      message.success("已复制摘要");
    } catch (error) {
      message.error(`复制失败: ${formatError(error)}`);
    }
  };

  return (
    <div className="chapter-summary">
      <div className="chapter-summary-header">
        <div>
          <Typography.Text strong>摘要</Typography.Text>
          {createdAtText ? (
            <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              {createdAtText}
            </Typography.Text>
          ) : null}
        </div>
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void loadLatest()}
            disabled={!chapterId || loading || generating}
            title="刷新摘要"
          />
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => void handleCopy()}
            disabled={!entry?.summary?.trim()}
            title="复制摘要"
          />
        </Space>
      </div>

      <div className="chapter-summary-body">
        {loading ? (
          <div className="chapter-summary-empty">加载中...</div>
        ) : chapterId ? (
          entry?.summary?.trim() ? (
            <div className="chapter-summary-content">{entry.summary}</div>
          ) : (
            <div className="chapter-summary-empty">暂无摘要，可点击下方“生成摘要”。</div>
          )
        ) : (
          <div className="chapter-summary-empty">未选择章节</div>
        )}
      </div>

      <div className="chapter-summary-footer">
        <Button
          size="small"
          onClick={() => void handleGenerate()}
          disabled={!chapterId || loading}
          loading={generating}
          block
        >
          {entry?.summary?.trim() ? "重新生成摘要" : "生成摘要"}
        </Button>
      </div>
    </div>
  );
}

