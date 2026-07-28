import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./error-boundary";

function ThrowingChild({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <p>healthy content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy content")).toBeDefined();
  });

  it("shows error fallback when a child throws", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByText("boom")).toBeDefined();
    expect(screen.getByText("Reload")).toBeDefined();
  });

  it("renders custom fallback when provided", () => {
    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <ThrowingChild message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeDefined();
  });
});
