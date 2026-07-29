import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider, useToast } from "./toast";

function Trigger({
  message,
  variant,
}: {
  message: string;
  variant?: "success" | "error" | "info";
}) {
  const { toast } = useToast();
  return (
    <button onClick={() => toast(message, variant)} type="button">
      fire
    </button>
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders children and shows a toast on demand", () => {
    render(
      <ToastProvider>
        <Trigger message="Saved successfully" variant="success" />
      </ToastProvider>,
    );
    expect(screen.getByText("fire")).toBeDefined();
    expect(screen.queryByText("Saved successfully")).toBeNull();

    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Saved successfully")).toBeDefined();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("supports each variant", () => {
    render(
      <ToastProvider>
        <Trigger message="error toast" variant="error" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("error toast")).toBeDefined();
  });

  it("dismisses a toast via the dismiss button", () => {
    render(
      <ToastProvider>
        <Trigger message="bye" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("bye")).toBeDefined();

    fireEvent.click(screen.getByLabelText("Dismiss"));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.queryByText("bye")).toBeNull();
  });

  it("auto-dismisses after the timeout", () => {
    render(
      <ToastProvider>
        <Trigger message="auto" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("auto")).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(4250);
    });
    expect(screen.queryByText("auto")).toBeNull();
  });

  it("keeps at most five toasts stacked", () => {
    render(
      <ToastProvider>
        <Trigger message="stack" />
      </ToastProvider>,
    );
    for (let i = 0; i < 7; i += 1) {
      fireEvent.click(screen.getByText("fire"));
    }
    expect(screen.getAllByRole("status").length).toBeLessThanOrEqual(5);
  });
});
