import { describe, expect, it } from "vitest";

import { __shellTestUtils } from "./shell";

const {
  dockPendingPermission,
  dockRunPreview,
  dockRunStatus,
  eventPreviewText,
} = __shellTestUtils;

let seq = 0;
function evt(type: string, data: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `evt_${seq}`,
    run_id: "run_test",
    sequence: seq,
    created_at: new Date().toISOString(),
    type,
    data,
  };
}

describe("shell dock utils", () => {
  it("eventPreviewText reads direct and nested fields", () => {
    expect(eventPreviewText(evt("agent.message", { text: "hello" }))).toBe(
      "hello",
    );
    expect(eventPreviewText(evt("agent.message", { message: "msg" }))).toBe(
      "msg",
    );
    expect(eventPreviewText(evt("shell.output", { output: "out" }))).toBe(
      "out",
    );
    expect(
      eventPreviewText(
        evt("runner", {
          raw: { data: { update: { content: { text: "nested" } } } },
        }),
      ),
    ).toBe("nested");
    expect(
      eventPreviewText(
        evt("runner", { raw: { data: { update: { rawOutput: "raw" } } } }),
      ),
    ).toBe("raw");
    expect(eventPreviewText(evt("unknown", {}))).toBeUndefined();
    expect(eventPreviewText(evt("blank", { text: "   " }))).toBeUndefined();
  });

  it("dockRunPreview returns latest text and truncates long output", () => {
    expect(
      dockRunPreview([
        evt("agent.message", { text: "first" }),
        evt("agent.message", { text: "second" }),
      ]),
    ).toBe("second");
    const long = "x".repeat(200);
    const preview = dockRunPreview([evt("agent.message", { text: long })]);
    expect(preview?.length).toBeLessThanOrEqual(144);
    expect(dockRunPreview([evt("noop", {})])).toBeUndefined();
  });

  it("dockRunStatus prefers terminal events", () => {
    expect(
      dockRunStatus("running", [evt("run.started"), evt("run.completed")]),
    ).toBe("completed");
    expect(dockRunStatus("running", [evt("run.failed")])).toBe("failed");
    expect(dockRunStatus("running", [evt("run.cancelled")])).toBe("cancelled");
    expect(dockRunStatus("running", [evt("run.started")])).toBe("running");
  });

  it("dockPendingPermission returns undefined when terminal or empty", () => {
    expect(dockPendingPermission([])).toBeUndefined();
    expect(
      dockPendingPermission([
        evt("permission.requested", {
          permission: { permission_id: "p1", tool: "shell" },
        }),
        evt("run.completed"),
      ]),
    ).toBeUndefined();
  });
});
