FROM node:22-slim AS web
WORKDIR /app/web
COPY lite/web/package.json lite/web/package-lock.json ./
RUN npm ci
COPY lite/web/ ./
RUN npx vite build

FROM python:3.12-slim
WORKDIR /app
COPY lite/runtime/ lite/runtime/
COPY --from=web /app/web/dist static/

ENV AFLOW_STATIC_DIR=/app/static
EXPOSE 8765

CMD ["python", "-m", "lite.runtime", "--host", "0.0.0.0", "--port", "8765"]
