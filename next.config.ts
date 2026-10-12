import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    const root = (
      process.env.PYTHON_API_URL ?? "http://127.0.0.1:8000"
    ).replace(/\/$/, "");
    return [{ source: "/api/v1/:path*", destination: `${root}/api/v1/:path*` }];
  },
};
export default nextConfig;
