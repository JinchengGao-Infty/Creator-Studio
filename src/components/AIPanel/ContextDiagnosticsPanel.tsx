import { Button, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { WritingContextDiagnostics } from "./contextBuilder";

interface ContextDiagnosticsPanelProps {
  diagnostics: WritingContextDiagnostics | null;
}

export default function ContextDiagnosticsPanel({ diagnostics }: ContextDiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const promptPreview = useMemo(() => {
    if (!diagnostics?.finalSystemPromptPreview) return "";
    return diagnostics.finalSystemPromptPreview.length >= diagnostics.finalSystemPromptChars
      ? diagnostics.finalSystemPromptPreview
      : `${diagnostics.finalSystemPromptPreview}…`;
  }, [diagnostics]);

  if (!diagnostics) return null;

  return (
    <div className="context-diagnostics-panel">
      <div className="context-diagnostics-header">
        <div>
          <Typography.Text strong>上下文装配</Typography.Text>
          <Typography.Text type="secondary" className="context-diagnostics-subtitle">
            {diagnostics.modeLabel} · {diagnostics.chapterLabel}
          </Typography.Text>
        </div>
        <Button size="small" type="link" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "收起" : "展开"}
        </Button>
      </div>

      <div className="context-diagnostics-summary">
        <Tag color="blue">消息 {diagnostics.includedMessages}/{diagnostics.totalWorkingMessages}</Tag>
        <Tag color="cyan">Prompt {diagnostics.finalSystemPromptChars} chars</Tag>
        <Tag color={diagnostics.compactSummaryMessages > 0 ? "green" : "default"}>
          摘要 {diagnostics.compactSummaryMessages}
        </Tag>
        <Tag color={diagnostics.filteredSystemMessages > 0 ? "orange" : "default"}>
          过滤 system {diagnostics.filteredSystemMessages}
        </Tag>
      </div>

      {expanded ? (
        <div className="context-diagnostics-body">
          <div className="context-diagnostics-grid">
            <div className="context-diagnostics-metric">
              <span className="context-diagnostics-label">用户消息</span>
              <span>{diagnostics.userMessages}</span>
            </div>
            <div className="context-diagnostics-metric">
              <span className="context-diagnostics-label">助手消息</span>
              <span>{diagnostics.assistantMessages}</span>
            </div>
            <div className="context-diagnostics-metric">
              <span className="context-diagnostics-label">消息字符数</span>
              <span>{diagnostics.messageChars}</span>
            </div>
            <div className="context-diagnostics-metric">
              <span className="context-diagnostics-label">System Prompt</span>
              <span>{diagnostics.finalSystemPromptChars}</span>
            </div>
          </div>

          <div className="context-diagnostics-sources">
            {diagnostics.sources.map((source) => (
              <div key={source.key} className="context-diagnostics-source">
                <Space size={8}>
                  <Tag color={source.included ? "green" : "default"}>
                    {source.included ? "已注入" : "未注入"}
                  </Tag>
                  <Typography.Text>{source.label}</Typography.Text>
                </Space>
                <Typography.Text type="secondary">
                  {source.details ?? "—"} · {source.chars} chars
                </Typography.Text>
              </div>
            ))}
          </div>

          <div className="context-diagnostics-preview">
            <Typography.Text type="secondary">System Prompt 预览</Typography.Text>
            <pre>{promptPreview || "（空）"}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
