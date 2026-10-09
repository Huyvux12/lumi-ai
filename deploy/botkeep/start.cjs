/* eslint-disable @typescript-eslint/no-require-imports -- Native CommonJS launcher for the standalone server. */
// The pinned Next standalone server reads rewrites from this manifest on startup.
// Keep runtime dependencies nested so a root npm install cannot prune them.
const fs = require("node:fs");
const path = require("node:path");

function start() {
  process.chdir(__dirname);
  try { process.loadEnvFile(".env"); } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rawPort = process.env.SERVER_PORT || "";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("SERVER_PORT must be the port assigned in Botkeep Network");
  }
  let backend;
  try { backend = new URL(process.env.PYTHON_API_URL); } catch {
    throw new Error("Set PYTHON_API_URL to the backend HTTPS origin in Environment");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname);
  if ((backend.protocol !== "https:" && !(backend.protocol === "http:" && loopback)) ||
      backend.username || backend.password || backend.search || backend.hash || backend.pathname !== "/") {
    throw new Error("PYTHON_API_URL must be an HTTPS origin without credentials or a path");
  }
  const runtime = path.join(__dirname, "runtime");
  // Keep Git-tracked files pristine so later repository updates can apply cleanly.
  // Only .next and the launcher are copied; large read-only dependencies stay shared.
  const working = path.join(__dirname, ".botkeep-runtime");
  fs.rmSync(working, { recursive: true, force: true });
  fs.mkdirSync(working);
  for (const file of ["server.js", "package.json"]) {
    fs.copyFileSync(path.join(runtime, file), path.join(working, file));
  }
  fs.cpSync(path.join(runtime, ".next"), path.join(working, ".next"), { recursive: true });
  for (const directory of ["node_modules", "public"]) {
    fs.symlinkSync(path.join(runtime, directory), path.join(working, directory), "dir");
  }
  const manifestPath = path.join(working, ".next", "routes-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const groups = Array.isArray(manifest.rewrites)
    ? [manifest.rewrites]
    : Object.values(manifest.rewrites || {});
  let updated = 0;
  for (const group of groups) {
    for (const route of group) {
      if (route.source === "/api/v1/:path*" || route.source === "/health") {
        route.destination = backend.origin + route.source;
        updated++;
      }
    }
  }
  if (updated !== 2) throw new Error("Unexpected Next rewrite manifest; rerun the Botkeep GitHub build");
  const temporary = manifestPath + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(manifest));
  fs.renameSync(temporary, manifestPath);
  process.env.HOSTNAME = "0.0.0.0";
  process.env.PORT = rawPort;
  process.env.NODE_ENV = "production";
  process.env.NEXT_TELEMETRY_DISABLED = "1";
  require(path.join(working, "server.js"));
}

if (require.main === module) start();
module.exports = { start };
