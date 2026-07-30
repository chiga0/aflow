import { useState } from "react";

interface Props {
  name: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
}

export function ToolCallCard({ name, input, output, isError }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 text-sm">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="text-zinc-500">🔧</span>
        <span className="font-mono text-xs text-zinc-400">{name}</span>
        {isError && <span className="text-xs text-red-400">✗</span>}
        <span className="ml-auto text-xs text-zinc-600">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
          {input != null && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">输入</div>
              <pre className="max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300 scrollbar-hide">
                {typeof input === "string" ? input : JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output != null && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">输出</div>
              <pre className={`max-h-40 overflow-auto rounded bg-zinc-950 p-2 text-xs scrollbar-hide ${isError ? "text-red-300" : "text-zinc-300"}`}>
                {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
