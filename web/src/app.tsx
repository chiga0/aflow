import { useEffect, useState, type FormEvent } from "react";

import { ChatApp } from "./chat-ui";

/* ── Brand mark ────────────────────────────────────────── */

function BrandMark({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <rect width="48" height="48" rx="12" fill="url(#aflow-grad)" />
      <path
        d="M16 34 L24 14 L32 34"
        stroke="#fff"
        strokeOpacity="0.96"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M18.8 27 L29.2 27"
        stroke="#fff"
        strokeOpacity="0.96"
        strokeWidth="4.5"
        strokeLinecap="round"
        fill="none"
      />
      <defs>
        <linearGradient id="aflow-grad" x1="0" y1="0" x2="48" y2="48">
          <stop stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── Auth gate + login ─────────────────────────────────── */

type AuthState = "checking" | "unauthed" | "authed" | "disabled";

function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>("checking");
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/session", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (!d.auth_enabled) setState("disabled");
        else if (d.authenticated) setState("authed");
        else setState("unauthed");
      })
      .catch(() => alive && setState("unauthed"));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) {
        setError("邮箱或密码不正确");
        return;
      }
      onDone();
    } catch {
      setError("无法连接服务");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="aflow-auth">
      <div className="aflow-auth-card">
        <div className="aflow-auth-brand">
          <BrandMark size={44} />
          <div>
            <div className="aflow-title-main" style={{ fontSize: "1.5rem" }}>
              AFlow
            </div>
            <div className="aflow-auth-sub">Agent Runtime</div>
          </div>
        </div>
        <p className="aflow-auth-hint">登录以继续</p>
        <form className="aflow-auth-form" onSubmit={submit}>
          <label className="aflow-field">
            <span>邮箱</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@aflow.local"
              required
            />
          </label>
          <label className="aflow-field">
            <span>密码</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>
          {error && <div className="aflow-auth-error">{error}</div>}
          <button type="submit" className="aflow-auth-submit" disabled={busy || !email || !password}>
            {busy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

function CheckingScreen() {
  return (
    <div className="aflow-auth">
      <div className="aflow-auth-card" style={{ textAlign: "center" }}>
        <BrandMark size={44} />
        <div className="aflow-auth-hint" style={{ marginTop: 16 }}>
          正在连接…
        </div>
      </div>
    </div>
  );
}

/* ── viewport (mobile IME never covers the composer) ───── */

function useViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setHeight(Math.round(vv.height));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("orientationchange", update);
    window.addEventListener("resize", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("orientationchange", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return height;
}

/* ── App ───────────────────────────────────────────────── */

export function App() {
  const auth = useAuth();
  const viewportHeight = useViewportHeight();

  return (
    <>
      <style>{aflowStyles}</style>
      {auth === "checking" && <CheckingScreen />}
      {auth === "unauthed" && <LoginScreen onDone={() => window.location.reload()} />}
      {(auth === "authed" || auth === "disabled") && (
        <ChatApp height={viewportHeight} />
      )}
    </>
  );
}

/* ── login screen styles (chat UI uses tailwind) ───────── */

const aflowStyles = `
.aflow-auth {
  position: fixed; inset: 0; display: grid; place-items: center;
  background: #09090b; padding: 1.5rem; overflow: auto;
}
.aflow-auth-card {
  position: relative; z-index: 1; width: 100%; max-width: 360px;
  background: rgba(24,24,27,0.7); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px; padding: 1.75rem; backdrop-filter: blur(12px);
}
.aflow-auth-brand { display: flex; align-items: center; gap: 0.75rem; }
.aflow-auth-sub {
  font-family: ui-monospace, "SF Mono", monospace; font-size: 0.7rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: rgba(148,163,184,0.6);
}
.aflow-auth-hint { color: rgba(203,213,225,0.7); font-size: 0.875rem; margin: 1rem 0 0.25rem; }
.aflow-auth-form { display: grid; gap: 0.85rem; margin-top: 1rem; }
.aflow-field { display: grid; gap: 0.35rem; font-size: 0.8rem; color: rgba(203,213,225,0.8); }
.aflow-field input {
  height: 42px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(9,9,11,0.6); color: #f4f4f5; padding: 0 0.85rem; font-size: 0.9rem;
  outline: none; transition: border-color 0.2s;
}
.aflow-field input:focus { border-color: #6366f1; }
.aflow-auth-error {
  font-size: 0.8rem; color: #fca5a5; background: rgba(239,68,68,0.1);
  border: 1px solid rgba(239,68,68,0.3); border-radius: 8px; padding: 0.5rem 0.7rem;
}
.aflow-auth-submit {
  height: 44px; border: none; border-radius: 10px; cursor: pointer;
  font-size: 0.95rem; font-weight: 600; color: #fff;
  background: linear-gradient(135deg, #6366f1, #06b6d4);
}
.aflow-auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.aflow-title-main {
  font-family: "SF Pro Display", Inter, system-ui, sans-serif;
  font-weight: 800; letter-spacing: -0.04em;
  background: linear-gradient(135deg, #c7d2fe 0%, #a5f3fc 50%, #c7d2fe 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
}
`;
