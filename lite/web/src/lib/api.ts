const BASE = "/api";

export interface SessionInfo {
  id: string;
  title: string;
  status: string;
  qwen_session_id: string | null;
  workspace: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageInfo {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  partial: boolean;
  created_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status}`);
  }
  return res.json();
}

export const api = {
  health: () => request<{ ok: boolean; qwen: boolean }>("/health"),

  listSessions: () =>
    request<{ sessions: SessionInfo[] }>("/sessions"),

  getSession: (id: string) =>
    request<{ session: SessionInfo; messages: MessageInfo[] }>(`/sessions/${id}`),

  createSession: (prompt: string, workspace?: string) =>
    request<SessionInfo>("/sessions", {
      method: "POST",
      body: JSON.stringify({ prompt, workspace }),
    }),

  sendPrompt: (id: string, prompt: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/prompt`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),

  cancelSession: (id: string) =>
    request<{ ok: boolean }>(`/sessions/${id}/cancel`, { method: "POST" }),
};
