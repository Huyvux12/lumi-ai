import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT_STANDALONE === "1"
    ? { output: "standalone" as const, cacheMaxMemorySize: 8 * 1024 * 1024 }
    : {}),
  async rewrites() {
    const root = (
      process.env.PYTHON_API_URL ?? "http://127.0.0.1:8000"
    ).replace(/\/$/, "");
    return [
      { source: "/api/v1/:path*", destination: `${root}/api/v1/:path*` },
      { source: "/health", destination: `${root}/health` },
    ];
  },
};
export default nextConfig;
