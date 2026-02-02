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
  summary: string | null;
  word_count: number | null;
  applied: boolean | null;
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

