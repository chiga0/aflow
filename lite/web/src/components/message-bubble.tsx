import { ToolCallCard } from "./tool-call-card";

export interface TranscriptItem {
  id: string;
  kind: "user" | "agent" | "tool" | "error" | "status";
  text: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  isError?: boolean;
  thought?: boolean;
}

export function MessageBubble({ item }: { item: TranscriptItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-sm text-white">
          {item.text}
        </div>
      </div>
    );
  }

  if (item.kind === "tool") {
    return (
      <ToolCallCard
        name={item.toolName ?? "tool"}
        input={item.toolInput}
        output={item.toolOutput}
        isError={item.isError}
      />
    );
  }

  if (item.kind === "error") {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
        ⚠ {item.text}
      </div>
    );
  }

  if (item.kind === "status") {
    return (
      <div className="text-center text-xs text-zinc-600">{item.text}</div>
    );
  }

  // agent
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-md px-4 py-2.5 text-sm whitespace-pre-wrap ${
          item.thought
            ? "bg-zinc-800/50 text-zinc-400 italic"
            : "bg-zinc-800 text-zinc-100"
        }`}
      >
        {item.text}
      </div>
    </div>
  );
}
