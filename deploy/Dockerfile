# syntax=docker/dockerfile:1
# aflow-lite runtime + embedded web console + pi execution engine.
# Build context = repository root (aflow-lite/); dockerfile = deploy/Dockerfile.
#
# The pi engine runs as short-lived `pi --mode rpc` subprocesses of the runtime
# (AFLOW_ENGINE=pi). The qwen engine (AFLOW_ENGINE=qwen) instead talks to the
# separate qwen serve container in docker-compose.yml.

# ---- stage 1: build the web console ----
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
# Do not download Playwright browsers during install (e2e is CI-only).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY web/package.json web/package-lock.json ./
COPY web/vendor ./vendor
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- stage 2: runtime (python + node/pi) ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
# python3 = control-plane runtime; git = agent needs to clone/build in the
# workspace; libsqlite3-0 backs the sqlite store.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 libsqlite3-0 git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG PI_VERSION=0.83.0
RUN npm install -g "@earendil-works/pi-coding-agent@${PI_VERSION}" \
 && npm cache clean --force

# Runtime is dependency-free (stdlib only); copy the package + built console.
COPY runtime ./runtime
COPY --from=web /build/web/dist ./static

# Agent workspace (mounted volume in compose); pi sessions default to it.
RUN mkdir -p /workspace

ENV AFLOW_STATIC_DIR=/app/static \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PI_ENGINE_CWD=/workspace

EXPOSE 8765
# Persistent control-plane state (SQLite, bootstrap password).
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python3 -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=3).status==200 else 1)" \
 || exit 1

CMD ["python3", "-m", "runtime", "--host", "0.0.0.0", "--port", "8765"]
