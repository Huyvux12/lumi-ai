import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3001",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: ["--no-sandbox"] }
      : {},
  },
  webServer: [
    {
      command: "backend/.venv/bin/python -m uvicorn backend.tests.ui_server:app --host 127.0.0.1 --port 8000 --no-access-log",
      env: { PYTHONPATH: "backend:backend/tests" },
      url: "http://127.0.0.1:8000/health",
      timeout: 30_000,
    },
    {
      command: "node .next/standalone/server.js",
      env: { PORT: "3001", HOSTNAME: "127.0.0.1", NEXT_TELEMETRY_DISABLED: "1" },
      url: "http://127.0.0.1:3001/welcome",
      timeout: 30_000,
    },
  ],
});
