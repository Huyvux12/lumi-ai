FROM node:24-bookworm-slim AS frontend
WORKDIR /build
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT_STANDALONE=1 \
    NEXT_PUBLIC_RENDER_DEMO=true PYTHON_API_URL=http://127.0.0.1:8000
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
WORKDIR /app/backend
COPY backend/ ./
RUN pip install --no-cache-dir .
COPY --from=frontend /build/.next/standalone /app/frontend
COPY --from=frontend /build/.next/static /app/frontend/.next/static
COPY --from=frontend /build/public /app/frontend/public
COPY deploy/render/start.py /app/start.py
RUN useradd --create-home lumi && mkdir /data && chown lumi:lumi /data
USER lumi
ENV APP_ENV=render-demo AUTO_MIGRATE=false DATA_DIR=/data \
    NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=192 TOKENIZERS_PARALLELISM=false PORT=10000
EXPOSE 10000
CMD ["python", "/app/start.py"]
