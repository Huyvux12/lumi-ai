import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  // Providers can take 90 seconds per attempt; allow two attempts plus decoding.
  experimental: { proxyTimeout: 240_000 },
  async rewrites() {
    const root = (
      process.env.PYTHON_API_URL ?? "http://127.0.0.1:8000"
    ).replace(/\/$/, "");
    return [{ source: "/api/v1/:path*", destination: `${root}/api/v1/:path*` }];
  },
};
export default nextConfig;
