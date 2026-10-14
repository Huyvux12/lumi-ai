FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.0 /uv /usr/local/bin/uv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN uv sync --locked --no-dev --no-editable --python /usr/local/bin/python
RUN groupadd --gid 1000 lumi && useradd --create-home --uid 1000 --gid lumi lumi && mkdir /data && chown lumi:lumi /data && chmod -R a+rX /app
USER lumi
ENV PATH="/app/.venv/bin:$PATH" DATA_DIR=/data AUTO_MIGRATE=false
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic upgrade head && python -m app.cli seed && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips 127.0.0.1,::1 --no-access-log"]
