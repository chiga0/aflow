export interface SseEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

export type SseStatus = "connecting" | "live" | "closed";

const EVENT_TYPES = [
  "message.delta",
  "tool.start",
  "tool.update",
  "tool.end",
  "permission.request",
  "permission.resolved",
  "status.change",
  "error",
  "done",
];

/**
 * Subscribe to a session's SSE stream.
 * Returns a cleanup function.
 */
export function subscribeSession(
  sessionId: string,
  onEvent: (event: SseEvent) => void,
  onStatus: (status: SseStatus) => void,
): () => void {
  const source = new EventSource(`/api/sessions/${sessionId}/events`);

  source.onopen = () => onStatus("live");
  source.onerror = () => {
    if (source.readyState === EventSource.CLOSED) onStatus("closed");
  };

  const handler = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ id: Number(e.lastEventId), type: e.type, data });
    } catch {
      // ignore malformed
    }
  };

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, handler);
  }

  return () => {
    for (const type of EVENT_TYPES) {
      source.removeEventListener(type, handler);
    }
    source.close();
    onStatus("closed");
  };
}
