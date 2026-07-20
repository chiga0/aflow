import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LanguageProvider, useI18n } from "./i18n";

function MissingProviderConsumer() {
  useI18n();
  return null;
}

function LocaleProbe() {
  const { locale, t, toggleLocale } = useI18n();
  return (
    <div>
      <div data-testid="locale">{locale}</div>
      <div data-testid="title">{t("nav.title")}</div>
      <div data-testid="missing">{t("missing.key" as never)}</div>
      <button type="button" onClick={toggleLocale}>
        toggle
      </button>
    </div>
  );
}

describe("i18n provider guard", () => {
  it("throws when used outside LanguageProvider", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    expect(() => render(<MissingProviderConsumer />)).toThrow(
      "useI18n must be used within LanguageProvider",
    );
    consoleError.mockRestore();
  });

  it("reads, toggles, and falls back between locales", async () => {
    const user = userEvent.setup();
    localStorage.clear();
    const { unmount } = render(
      <LanguageProvider>
        <LocaleProbe />
      </LanguageProvider>,
    );

    expect(screen.getByTestId("locale")).toHaveTextContent("zh");
    expect(screen.getByTestId("title")).toHaveTextContent("aflow");
    expect(screen.getByTestId("missing")).toHaveTextContent("missing.key");
    expect(document.documentElement.lang).toBe("zh-CN");

    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(localStorage.getItem("agentflow-locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("locale")).toHaveTextContent("zh");
    expect(localStorage.getItem("agentflow-locale")).toBe("zh");
    await user.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    unmount();

    render(
      <LanguageProvider>
        <LocaleProbe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
  });
});
