import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  ...(process.env.TACIT_TEST_DIST_DIR === ".next-test" ? { distDir: ".next-test" } : {}),
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), display-capture=(self)",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
