import { AlertTriangle } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./ui";

const messages = {
  zh: { title: "页面出错了", reload: "重新加载" },
  en: { title: "Something went wrong", reload: "Reload" },
};

function localeMessages() {
  const saved = localStorage.getItem("agentflow-locale");
  return saved === "en" ? messages.en : messages.zh;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const t = localeMessages();
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center text-card-foreground">
            <div
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10"
              aria-hidden="true"
            >
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h1 className="mb-2 text-lg font-semibold">{t.title}</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              {this.state.error.message}
            </p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              {t.reload}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
