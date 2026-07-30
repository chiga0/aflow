# syntax=docker/dockerfile:1
# aflow-lite runtime + embedded web console.
# Build context = repository root (aflow-lite/); dockerfile = lite/deploy/Dockerfile.

# ---- stage 1: build the web console ----
FROM node:22-bookworm-slim AS web
WORKDIR /build/web
# Do not download Playwright browsers during install (e2e is CI-only).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY lite/web/package.json lite/web/package-lock.json ./
COPY lite/web/vendor ./vendor
RUN npm ci
COPY lite/web/ ./
RUN npm run build

# ---- stage 2: runtime ----
FROM python:3.12-slim AS runtime
WORKDIR /app
# libsqlite3 is required by Python's sqlite3 module (the control-plane store).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libsqlite3-0 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Runtime is dependency-free (stdlib only); copy the package + built console.
COPY lite/runtime ./lite/runtime
COPY lite/__init__.py ./lite/__init__.py
COPY --from=web /build/web/dist ./static

ENV AFLOW_STATIC_DIR=/app/static \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8765
# Persistent control-plane state (SQLite, bootstrap password).
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8765/api/health',timeout=3).status==200 else 1)" \
  || exit 1

CMD ["python", "-m", "lite.runtime", "--host", "0.0.0.0", "--port", "8765"]
