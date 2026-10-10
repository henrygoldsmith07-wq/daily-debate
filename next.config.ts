import path from "node:path";
import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${process.env.NODE_ENV === "development" ? " http: https: ws: wss:" : " https://vercel.live https://*.vercel.live wss://*.vercel.live"}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

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
          // HSTS: without it a first plaintext request can strip the session
          // cookie, and `secure: NODE_ENV === "production"` does not describe
          // the actual transport. Two years + subdomains is the preload-eligible
          // form. Only meaningful over TLS, which production/Vercel enforce.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Drop the APIs this product never uses. Geolocation/camera/mic are
          // denied outright; `microphone=()` would be wrong because voice input
          // uses the Web Speech API, which is not gated by this header.
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
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
