import {
  Cpu,
  GitBranch,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  Moon,
  Play,
  Search,
  Server,
  Shield,
  Sun,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../lib/i18n";
import { cn } from "../lib/utils";

export type PaletteAction = "toggle-theme" | "toggle-language" | "sign-out";

interface PaletteItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: "navigation" | "actions";
  run: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (path: string) => void;
  onAction: (action: PaletteAction) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: Array<{
      id: string;
      label: string;
      icon: LucideIcon;
      to: string;
    }> = [
      { id: "workspace", label: t("nav.workspace"), icon: Home, to: "/" },
      {
        id: "overview",
        label: t("nav.overview"),
        icon: LayoutDashboard,
        to: "/admin",
      },
      { id: "runs", label: t("nav.runs"), icon: Play, to: "/admin/runs" },
      { id: "units", label: t("nav.units"), icon: Server, to: "/admin/units" },
      {
        id: "executors",
        label: t("nav.executors"),
        icon: Cpu,
        to: "/admin/executors",
      },
      {
        id: "missions",
        label: t("nav.missions"),
        icon: GitBranch,
        to: "/admin/missions",
      },
      {
        id: "profiles",
        label: t("nav.profiles"),
        icon: Users,
        to: "/admin/profiles",
      },
      {
        id: "access",
        label: t("nav.access"),
        icon: Shield,
        to: "/admin/access",
      },
      {
        id: "operations",
        label: t("nav.operations"),
        icon: Wrench,
        to: "/admin/operations",
      },
    ];
    const navItems: PaletteItem[] = nav.map((entry) => ({
      id: entry.id,
      label: entry.label,
      icon: entry.icon,
      group: "navigation",
      run: () => onNavigate(entry.to),
    }));
    const actionItems: PaletteItem[] = [
      {
        id: "theme",
        label: t("palette.theme"),
        icon: dark ? Sun : Moon,
        group: "actions",
        run: () => onAction("toggle-theme"),
      },
      {
        id: "language",
        label: t("palette.language"),
        icon: Languages,
        group: "actions",
        run: () => onAction("toggle-language"),
      },
      {
        id: "sign-out",
        label: t("palette.signOut"),
        icon: LogOut,
        group: "actions",
        run: () => onAction("sign-out"),
      },
    ];
    return [...navItems, ...actionItems];
  }, [t, dark, onNavigate, onAction]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.label.toLowerCase().includes(q));
  }, [items, query]);

  const groups = useMemo(() => {
    const order: Array<PaletteItem["group"]> = ["navigation", "actions"];
    return order
      .map((group) => ({
        group,
        label:
          group === "navigation"
            ? t("palette.navigation")
            : t("palette.actions"),
        entries: filtered.filter((item) => item.group === group),
      }))
      .filter((section) => section.entries.length > 0);
  }, [filtered, t]);

  useEffect(() => {
    setSelected(0);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selected}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!open) return null;

  const activate = (item: PaletteItem) => {
    onOpenChange(false);
    item.run();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((value) => (value + 1) % Math.max(filtered.length, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(
        (value) =>
          (value - 1 + Math.max(filtered.length, 1)) %
          Math.max(filtered.length, 1),
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = filtered[selected];
      if (item) activate(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
    }
  };

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.placeholder")}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <style>{`
        @keyframes palette-in {
          from { opacity: 0; transform: scale(0.98) translateY(-4px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .animate-palette-in { animation: palette-in 140ms ease-out both; }
      `}</style>
      <div className="mx-auto mt-[20vh] w-[calc(100%-2rem)] max-w-lg">
        <div
          className="animate-palette-in overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              aria-label={t("palette.placeholder")}
              autoComplete="off"
              className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
              placeholder={t("palette.placeholder")}
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
              esc
            </kbd>
          </div>

          <div ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
            {groups.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                {t("palette.noResults")}
              </div>
            ) : (
              groups.map((section) => (
                <div key={section.group} className="mb-1 last:mb-0">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {section.label}
                  </div>
                  {section.entries.map((item) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const Icon = item.icon;
                    const isSelected = index === selected;
                    return (
                      <button
                        key={item.id}
                        data-index={index}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border-l-2 border-transparent px-2.5 py-2 text-left text-sm transition-colors",
                          isSelected
                            ? "border-primary bg-muted text-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                        onMouseEnter={() => setSelected(index)}
                        onClick={() => activate(item)}
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isSelected
                              ? "text-primary"
                              : "text-muted-foreground",
                          )}
                        />
                        <span className="flex-1 truncate">{item.label}</span>
                        {isSelected ? (
                          <kbd className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            ↵
                          </kbd>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {t("palette.hint")}
          </div>
        </div>
      </div>
    </div>
  );
}
