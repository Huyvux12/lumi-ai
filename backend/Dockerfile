FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir .
RUN useradd --create-home lumi && mkdir /data && chown lumi:lumi /data
USER lumi
ENV DATA_DIR=/data AUTO_MIGRATE=false
EXPOSE 8000
CMD ["sh", "-c", "python -m alembic upgrade head && python -m app.cli seed && exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --no-access-log"]
