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

export interface PanelMessage {
  id: string;
  role: PanelMessageRole;
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  metadata?: unknown;
}

