import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";

import { cn } from "../lib/utils";

export interface DagNode {
  id: string;
  label: string;
  sublabel?: string;
  badge?: string;
  status: string;
}

export interface DagEdge {
  from: string;
  to: string;
}

const NODE_W = 208;
const NODE_H = 84;
const GAP_X = 88;
const GAP_Y = 32;

const statusStyles: Record<string, string> = {
  completed: "border-success/50 bg-success/5",
  pass: "border-success/50 bg-success/5",
  running: "border-sky-500/60 bg-sky-500/5",
  starting: "border-sky-500/60 bg-sky-500/5",
  queued: "border-warning/50 bg-warning/5",
  waiting: "border-warning/50 bg-warning/5",
  failed: "border-destructive/50 bg-destructive/5",
  cancelled: "border-destructive/50 bg-destructive/5",
};

const dotStyles: Record<string, string> = {
  completed: "bg-success",
  pass: "bg-success",
  running: "bg-sky-500 animate-pulse",
  starting: "bg-sky-500 animate-pulse",
  queued: "bg-warning",
  waiting: "bg-warning",
  failed: "bg-destructive",
  cancelled: "bg-destructive",
};

function DagNodeCard({ data }: NodeProps) {
  const d = data as unknown as DagNode;
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 shadow-sm transition-colors",
        statusStyles[d.status] ?? "border-border",
      )}
      style={{ width: NODE_W, minHeight: NODE_H }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-0 !bg-muted-foreground/40"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full",
              dotStyles[d.status] ?? "bg-muted-foreground/40",
            )}
            aria-hidden="true"
          />
          <span className="truncate text-sm font-medium text-foreground">
            {d.label}
          </span>
        </span>
        {d.badge ? (
          <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {d.badge}
          </span>
        ) : null}
      </div>
      {d.sublabel ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {d.sublabel}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-0 !bg-muted-foreground/40"
      />
    </div>
  );
}

const nodeTypes = { dag: DagNodeCard };

/** Longest-path layering: depth = 1 + max(depth of dependencies). */
function layout(dagNodes: DagNode[], dagEdges: DagEdge[]): Node[] {
  const ids = dagNodes.map((n) => n.id);
  const depsOf = new Map<string, string[]>();
  for (const id of ids) depsOf.set(id, []);
  for (const e of dagEdges) {
    if (depsOf.has(e.to) && ids.includes(e.from)) {
      depsOf.get(e.to)!.push(e.from);
    }
  }
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = depsOf.get(id) ?? [];
    const d = deps.length
      ? 1 + Math.max(...deps.map((x) => visit(x, seen)))
      : 0;
    depth.set(id, d);
    return d;
  };
  for (const id of ids) visit(id, new Set());

  const byLayer = new Map<number, DagNode[]>();
  for (const n of dagNodes) {
    const layer = depth.get(n.id) ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n);
  }

  const nodes: Node[] = [];
  for (const [layer, items] of byLayer) {
    items.forEach((n, i) => {
      nodes.push({
        id: n.id,
        type: "dag",
        position: {
          x: layer * (NODE_W + GAP_X),
          y: i * (NODE_H + GAP_Y),
        },
        data: n as unknown as Record<string, unknown>,
        draggable: false,
        selectable: false,
      });
    });
  }
  return nodes;
}

function FlowDagInner({
  dagNodes,
  dagEdges,
}: {
  dagNodes: DagNode[];
  dagEdges: DagEdge[];
}) {
  const nodes = useMemo(() => layout(dagNodes, dagEdges), [dagNodes, dagEdges]);
  const statusById = useMemo(
    () => new Map(dagNodes.map((n) => [n.id, n.status])),
    [dagNodes],
  );
  const edges: Edge[] = useMemo(
    () =>
      dagEdges
        .filter((e) => statusById.has(e.from) && statusById.has(e.to))
        .map((e, i) => {
          const active = statusById.get(e.to) === "running";
          const done = statusById.get(e.from) === "completed";
          return {
            id: `e-${i}-${e.from}-${e.to}`,
            source: e.from,
            target: e.to,
            animated: active,
            className: done
              ? "!stroke-success/60"
              : "!stroke-muted-foreground/30",
            style: { strokeWidth: active ? 2 : 1.5 },
          };
        }),
    [dagEdges, statusById],
  );

  return (
    <div className="h-[360px] w-full overflow-hidden rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function FlowDag(props: { dagNodes: DagNode[]; dagEdges: DagEdge[] }) {
  return (
    <ReactFlowProvider>
      <FlowDagInner {...props} />
    </ReactFlowProvider>
  );
}
