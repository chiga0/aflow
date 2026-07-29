import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  leaving: boolean;
}

const ToastContext = createContext<{
  toast: (message: string, variant?: ToastVariant) => void;
}>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const icons: Record<ToastVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const styles: Record<ToastVariant, string> = {
  success: "border-success/40 bg-card text-success",
  error: "border-destructive/40 bg-card text-destructive",
  info: "border-sky-500/40 bg-card text-sky-600 dark:text-sky-400",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const remove = useCallback((id: number) => {
    setItems((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
    );
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const toast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = ++counter.current;
      setItems((prev) => [
        ...prev.slice(-4),
        { id, message, variant, leaving: false },
      ]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
          {items.map((item) => {
            const Icon = icons[item.variant];
            return (
              <div
                key={item.id}
                className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg transition-all duration-200 ${
                  styles[item.variant]
                } ${item.leaving ? "translate-x-4 opacity-0" : "translate-x-0 opacity-100"}`}
                role="status"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="flex-1 text-foreground">{item.message}</span>
                <button
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                  onClick={() => remove(item.id)}
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
