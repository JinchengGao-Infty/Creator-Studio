export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "calling" | "success" | "error";
  result?: string;
  error?: string;
  duration?: number;
}

export type PanelMessageRole = "user" | "assistant" | "system";

export interface PanelMessageMetadata {
  summary?: string | null;
  word_count?: number | null;
  applied?: boolean | null;
}

export interface PanelMessage {
  id: string;
  role: PanelMessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  metadata?: PanelMessageMetadata | null;
}
