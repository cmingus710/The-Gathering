import type { NextConfig } from "next";

/**
 * Cache Components is deliberately off: nearly every page depends on the
 * signed-in member, and keeping rendering fully dynamic guarantees private
 * pages are never prerendered, cached, or prefetched across sessions.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  // The statement PDF reads the logo from disk.
  outputFileTracingIncludes: {
    "/giving/statement/**": ["./public/brand/the-gathering-logo.png", "./assets/fonts/*.ttf"],
    "/admin/finance/statements/**": ["./public/brand/the-gathering-logo.png", "./assets/fonts/*.ttf"],
  },
  experimental: {
    // Uploads go through Server Actions; Vercel caps request bodies at 4.5 MB.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/(home|announcements|directory|profile|giving|give|admin|account-status|api|community|groups|messages|notifications)/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default nextConfig;
