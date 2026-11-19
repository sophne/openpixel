import type { NextConfig } from "next";

// The site has no user input and no embeds, so the policy can be strict. Next.js inlines small bootstrap scripts,
// hence 'unsafe-inline' for scripts. The only outside code is Google Tag Manager with Google Analytics, which the
// cookie banner loads only after the visitor allows it (src/lib/consent.ts); these are the hosts Google lists for it.
const google = {
  script: "https://*.googletagmanager.com",
  img: "https://*.google-analytics.com https://*.googletagmanager.com",
  connect: "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
};
const dev = process.env.NODE_ENV === "development";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${google.script}` + (dev ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${google.img}`,
  "font-src 'self'",
  `connect-src 'self' ${google.connect}`,
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
