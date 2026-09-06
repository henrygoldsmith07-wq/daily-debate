import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node-postgres must stay external: the dynamic import in
  // src/lib/backend/sql.ts (TCP transport for non-Neon databases) resolves it
  // from node_modules, and bundling CJS optional deps breaks on Vercel.
  serverExternalPackages: ["pg"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
