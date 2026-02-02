import { useMemo, useState } from "react";
import { CheckOutlined, CloseOutlined, RightOutlined } from "@ant-design/icons";
import { Spin } from "antd";
import type { ToolCall } from "./types";

const TOOL_ICON_MAP: Record<string, string> = {
  read: "📖",
  write: "✏️",
  append: "➕",
  list: "📁",
  search: "🔍",
  save_summary: "💾",
};

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getPathArg(call: ToolCall): string | null {
  const path = call.args?.path;
  return typeof path === "string" && path.trim() ? path : null;
}

function summarizeToolCall(call: ToolCall): string {
  const path = getPathArg(call);

  if (call.status === "calling") {
    if (path) return `path: ${path}`;
    return "调用中...";
  }

  if (call.status === "error") {
    return call.error ? truncate(call.error, 120) : "执行失败";
  }

  switch (call.name) {
    case "read": {
      const data = call.result ? safeJsonParse(call.result) : null;
      const content = (data as { content?: unknown } | null)?.content;
      const len =
        typeof content === "string"
          ? content.length
          : typeof call.result === "string"
            ? call.result.length
            : 0;
      const info = `读取了 ${len.toLocaleString()} 字`;
      return path ? `path: ${path} · ${info}` : info;
    }
    case "search": {
      const data = call.result ? safeJsonParse(call.result) : null;
      const matches = (data as { matches?: unknown } | null)?.matches;
      const count = Array.isArray(matches) ? matches.length : null;
      const info = count === null ? "搜索完成" : `找到 ${count.toLocaleString()} 条结果`;
      return path ? `path: ${path} · ${info}` : info;
    }
    case "list": {
      const data = call.result ? safeJsonParse(call.result) : null;
      const entries = (data as { entries?: unknown } | null)?.entries;
      const count = Array.isArray(entries) ? entries.length : null;
      const info = count === null ? "列出完成" : `列出 ${count.toLocaleString()} 项`;
      return path ? `path: ${path} · ${info}` : info;
    }
    case "append":
      return path ? `path: ${path} · 已追加` : "已追加";
    case "write":
      return path ? `path: ${path} · 已写入` : "已写入";
    case "save_summary":
      return "已保存";
    default:
      return path ? `path: ${path}` : "";
  }
}

export default function ToolCallDisplay({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(() => summarizeToolCall(toolCall), [toolCall]);
  const icon = TOOL_ICON_MAP[toolCall.name] || "🔧";

  return (
    <div className={`tool-call tool-call-${toolCall.status}`}>
      <button
        type="button"
        className="tool-call-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="tool-icon" aria-hidden>
          {icon}
        </span>
        <span className="tool-name">{toolCall.name}</span>

        <span className="tool-status" aria-hidden>
          {toolCall.status === "calling" ? <Spin size="small" /> : null}
          {toolCall.status === "success" ? <CheckOutlined style={{ color: "green" }} /> : null}
          {toolCall.status === "error" ? <CloseOutlined style={{ color: "#ff4d4f" }} /> : null}
        </span>

        <span className="tool-summary">{summary}</span>

        {typeof toolCall.duration === "number" ? (
          <span className="tool-duration">{`${toolCall.duration}ms`}</span>
        ) : null}

        <RightOutlined className={`tool-expand ${expanded ? "expanded" : ""}`} />
      </button>

      {expanded ? (
        <div className="tool-call-details">
          <div className="tool-section">
            <strong>参数：</strong>
            <pre>{JSON.stringify(toolCall.args ?? {}, null, 2)}</pre>
          </div>

          {toolCall.result ? (
            <div className="tool-section">
              <strong>结果：</strong>
              <pre>{truncate(toolCall.result, 500)}</pre>
            </div>
          ) : null}

          {toolCall.error ? (
            <div className="tool-section tool-error">
              <strong>错误：</strong>
              <span>{toolCall.error}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

