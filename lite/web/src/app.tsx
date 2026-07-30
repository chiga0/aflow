import { StandaloneWebShell } from "@qwen-code/web-shell";
import type { WelcomeHeaderProps } from "@qwen-code/web-shell";

/* ── AFlow brand welcome header ─────────────────────────── */

function AflowWelcomeHeader(_props: WelcomeHeaderProps) {
  return (
    <div className="aflow-welcome">
      {/* Ambient glow */}
      <div className="aflow-glow" />

      {/* Logo mark */}
      <div className="aflow-mark">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
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
      </div>

      {/* Brand text */}
      <h1 className="aflow-title">
        <span className="aflow-title-main">AFlow</span>
        <span className="aflow-title-sub">Agent Runtime</span>
      </h1>

      <p className="aflow-tagline">
        描述你的目标，Agent 会规划、执行、验证，并交付结果。
      </p>

      {/* Quick-start chips */}
      <div className="aflow-chips">
        <span className="aflow-chip aflow-chip--1">
          <span className="aflow-chip-icon">⚡</span>
          审计部署链路风险
        </span>
        <span className="aflow-chip aflow-chip--2">
          <span className="aflow-chip-icon">🔍</span>
          分析代码变更影响
        </span>
        <span className="aflow-chip aflow-chip--3">
          <span className="aflow-chip-icon">🛠</span>
          重构模块并补测试
        </span>
      </div>
    </div>
  );
}

/* ── Footer hints ───────────────────────────────────────── */

function AflowWelcomeFooter(_props: WelcomeHeaderProps) {
  return (
    <div className="aflow-footer-hints">
      <span>
        <kbd>Enter</kbd> 发送
      </span>
      <span className="aflow-footer-sep">·</span>
      <span>
        <kbd>Shift+Enter</kbd> 换行
      </span>
      <span className="aflow-footer-sep">·</span>
      <span>
        <kbd>@</kbd> 引用文件
      </span>
      <span className="aflow-footer-sep">·</span>
      <span>
        <kbd>/</kbd> 命令
      </span>
    </div>
  );
}

/* ── Loading phrases ────────────────────────────────────── */

const AFLOW_LOADING_PHRASES = [
  "正在分析代码结构…",
  "Agent 正在思考下一步…",
  "执行工具调用中…",
  "正在验证结果…",
  "整理输出报告…",
  "检查依赖关系…",
  "扫描项目文件…",
  "正在构建上下文…",
];

/* ── App ────────────────────────────────────────────────── */

export function App() {
  return (
    <>
      <style>{aflowStyles}</style>
      <StandaloneWebShell
        baseUrl="/daemon"
        language="zh"
        style={{ height: "100vh", width: "100vw" }}
        renderWelcomeHeader={AflowWelcomeHeader}
        renderWelcomeFooter={AflowWelcomeFooter}
        composerPlaceholders={{
          idle: "描述你想让 Agent 完成的任务…",
          loading: "Agent 正在执行，新消息会排队…",
          processing: "处理中，请稍候…",
        }}
        loadingPhrases={() => AFLOW_LOADING_PHRASES}
        hiddenSlashCommands={[
          "agents",
          "auth",
          "bug",
          "docs",
          "extensions",
          "mcp",
          "memory",
          "release",
          "settings",
        ]}
        sidebar={{
          enabled: true,
          branding: {
            render: () => (
              <div style={{ padding: "2px 0" }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    background: "linear-gradient(135deg, #818cf8, #22d3ee)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  AFlow
                </div>
                <div
                  style={{
                    fontSize: 11,
                    opacity: 0.5,
                    marginTop: 1,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase" as const,
                  }}
                >
                  Agent Runtime
                </div>
              </div>
            ),
          },
          footer: false,
        }}
      />
    </>
  );
}

/* ── Scoped styles ──────────────────────────────────────── */

const aflowStyles = `
/* Welcome container */
.aflow-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
  padding: 2rem 1.5rem 1rem;
  position: relative;
  animation: aflow-fade-in 0.6s ease-out both;
}

/* Ambient radial glow behind the logo */
.aflow-glow {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 320px;
  height: 200px;
  background: radial-gradient(
    ellipse at center,
    rgba(99, 102, 241, 0.12) 0%,
    rgba(6, 182, 212, 0.06) 40%,
    transparent 70%
  );
  pointer-events: none;
  animation: aflow-glow-pulse 4s ease-in-out infinite alternate;
}

@keyframes aflow-glow-pulse {
  0%   { opacity: 0.6; transform: translateX(-50%) scale(1); }
  100% { opacity: 1;   transform: translateX(-50%) scale(1.08); }
}

/* Logo mark */
.aflow-mark {
  position: relative;
  z-index: 1;
  margin-bottom: 1.25rem;
  animation: aflow-mark-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  animation-delay: 0.1s;
}
.aflow-mark svg {
  filter: drop-shadow(0 4px 24px rgba(99, 102, 241, 0.3));
  transition: transform 0.3s ease, filter 0.3s ease;
}
.aflow-mark:hover svg {
  transform: scale(1.08) rotate(-2deg);
  filter: drop-shadow(0 6px 32px rgba(99, 102, 241, 0.45));
}

/* Title */
.aflow-title {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin: 0 0 0.5rem;
  animation: aflow-slide-up 0.5s ease-out both;
  animation-delay: 0.2s;
}
.aflow-title-main {
  font-family: "SF Pro Display", "Inter", system-ui, sans-serif;
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.04em;
  background: linear-gradient(135deg, #c7d2fe 0%, #a5f3fc 50%, #c7d2fe 100%);
  background-size: 200% 200%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: aflow-shimmer 6s ease-in-out infinite;
}
.aflow-title-sub {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", monospace;
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(148, 163, 184, 0.6);
  padding: 2px 8px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 4px;
}

/* Tagline */
.aflow-tagline {
  position: relative;
  z-index: 1;
  font-size: 0.95rem;
  color: rgba(203, 213, 225, 0.7);
  margin: 0 0 1.75rem;
  text-align: center;
  max-width: 360px;
  line-height: 1.6;
  animation: aflow-slide-up 0.5s ease-out both;
  animation-delay: 0.3s;
}

/* Quick-start chips */
.aflow-chips {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  animation: aflow-slide-up 0.5s ease-out both;
  animation-delay: 0.4s;
}
.aflow-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.85rem;
  font-size: 0.8rem;
  color: rgba(203, 213, 225, 0.8);
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: default;
  transition: all 0.25s ease;
  backdrop-filter: blur(8px);
}
.aflow-chip:hover {
  background: rgba(99, 102, 241, 0.1);
  border-color: rgba(99, 102, 241, 0.3);
  color: #e0e7ff;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.15);
}
.aflow-chip-icon {
  font-size: 0.9rem;
  line-height: 1;
}

/* Stagger chip animations */
.aflow-chip--1 { animation: aflow-chip-in 0.4s ease-out both; animation-delay: 0.5s; }
.aflow-chip--2 { animation: aflow-chip-in 0.4s ease-out both; animation-delay: 0.6s; }
.aflow-chip--3 { animation: aflow-chip-in 0.4s ease-out both; animation-delay: 0.7s; }

/* Footer hints */
.aflow-footer-hints {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 0 0.25rem;
  font-size: 0.7rem;
  color: rgba(148, 163, 184, 0.4);
  animation: aflow-fade-in 0.5s ease-out both;
  animation-delay: 0.8s;
}
.aflow-footer-hints kbd {
  display: inline-block;
  padding: 1px 5px;
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 0.65rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  color: rgba(203, 213, 225, 0.5);
}
.aflow-footer-sep {
  opacity: 0.3;
}

/* Keyframes */
@keyframes aflow-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes aflow-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes aflow-mark-in {
  from { opacity: 0; transform: scale(0.7); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes aflow-chip-in {
  from { opacity: 0; transform: translateY(8px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes aflow-shimmer {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .aflow-welcome { padding: 1.5rem 1rem 0.75rem; }
  .aflow-title-main { font-size: 1.6rem; }
  .aflow-chips { flex-direction: column; align-items: center; }
  .aflow-chip { width: 100%; max-width: 260px; justify-content: center; }
}
`;
