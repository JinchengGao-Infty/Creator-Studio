import { invoke } from "@tauri-apps/api/core";

export type SessionMode = "Discussion" | "Continue";

export interface Session {
  id: string;
  name: string;
  mode: SessionMode;
  chapter_id: string | null;
  created_at: number;
  updated_at: number;
}

export type MessageRole = "User" | "Assistant" | "System";

export interface MessageMetadata {
  summary?: string | null;
  word_count?: number | null;
  applied?: boolean | null;
  tool_calls?: unknown;
}

export interface SessionMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  metadata: MessageMetadata | null;
}

export async function listSessions(projectPath: string): Promise<Session[]> {
  return (await invoke("list_sessions", { project_path: projectPath })) as Session[];
}

export async function createSession(params: {
  projectPath: string;
  name: string;
  mode: SessionMode;
  chapterId?: string | null;
}): Promise<Session> {
  return (await invoke("create_session", {
    project_path: params.projectPath,
    name: params.name,
    mode: params.mode,
    chapter_id: params.chapterId ?? null,
  })) as Session;
}

export async function getSessionMessages(params: {
  projectPath: string;
  sessionId: string;
}): Promise<SessionMessage[]> {
  return (await invoke("get_session_messages", {
    project_path: params.projectPath,
    session_id: params.sessionId,
  })) as SessionMessage[];
}

export async function addSessionMessage(params: {
  projectPath: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata | null;
}): Promise<SessionMessage> {
  return (await invoke("add_message", {
    project_path: params.projectPath,
    session_id: params.sessionId,
    role: params.role,
    content: params.content,
    metadata: params.metadata ?? null,
  })) as SessionMessage;
}

export async function updateMessageMetadata(params: {
  projectPath: string;
  sessionId: string;
  messageId: string;
  summary?: string;
  wordCount?: number;
  applied?: boolean;
}): Promise<SessionMessage> {
  return (await invoke("update_message_metadata", {
    project_path: params.projectPath,
    session_id: params.sessionId,
    message_id: params.messageId,
    metadata: {
      summary: params.summary,
      word_count: params.wordCount,
      applied: params.applied,
    },
  })) as SessionMessage;
}

export async function renameSession(params: {
  projectPath: string;
  sessionId: string;
  newName: string;
}): Promise<void> {
  await invoke("rename_session", {
    project_path: params.projectPath,
    session_id: params.sessionId,
    new_name: params.newName,
  });
}

export async function deleteSession(params: {
  projectPath: string;
  sessionId: string;
}): Promise<void> {
  await invoke("delete_session", {
    project_path: params.projectPath,
    session_id: params.sessionId,
  });
}
