import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FlowDag, type DagEdge, type DagNode } from "./flow-dag";

const nodes: DagNode[] = [
  {
    id: "brain",
    label: "Planner",
    sublabel: "Plan the work",
    badge: "brain",
    status: "completed",
  },
  {
    id: "builder",
    label: "Builder",
    status: "running",
  },
  {
    id: "reviewer",
    label: "Reviewer",
    sublabel: "Review output",
    badge: "reviewer",
    status: "failed",
  },
];

const edges: DagEdge[] = [
  { from: "brain", to: "builder" },
  { from: "builder", to: "reviewer" },
];

describe("FlowDag", () => {
  it("renders node labels, badges, and sublabels", () => {
    render(<FlowDag dagNodes={nodes} dagEdges={edges} />);
    expect(screen.getByText("Planner")).toBeDefined();
    expect(screen.getByText("Builder")).toBeDefined();
    expect(screen.getByText("Reviewer")).toBeDefined();
    expect(screen.getByText("brain")).toBeDefined();
    expect(screen.getByText("Plan the work")).toBeDefined();
    expect(screen.getByText("Review output")).toBeDefined();
  });

  it("renders an empty graph without crashing", () => {
    const { container } = render(<FlowDag dagNodes={[]} dagEdges={[]} />);
    expect(container).toBeDefined();
  });

  it("ignores edges referencing unknown nodes", () => {
    render(
      <FlowDag
        dagNodes={[{ id: "a", label: "A", status: "completed" }]}
        dagEdges={[{ from: "a", to: "missing" }]}
      />,
    );
    expect(screen.getByText("A")).toBeDefined();
  });
});
