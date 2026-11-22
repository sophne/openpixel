import type { NextConfig } from "next";

// The site has no user input and no embeds, so the policy can be strict. Next.js inlines small bootstrap scripts,
// hence 'unsafe-inline' for scripts. The only outside service is PostHog (src/lib/consent.ts): it sends events to
// its ingestion host and loads the session replay recorder from its assets host (*.i.posthog.com), and the recorder
// compresses recordings in a web worker (blob:), as PostHog's docs list.
const posthog = "https://*.posthog.com";
const dev = process.env.NODE_ENV === "development";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${posthog}` + (dev ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${posthog}`,
  "worker-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Not in development: Safari would upgrade http://localhost requests to https and load no CSS, JS or images.
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // The download page moved to /downloads; old links keep working.
  async redirects() {
    return [
      { source: "/download", destination: "/downloads", permanent: true },
      { source: "/download/mac", destination: "/downloads/mac", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
