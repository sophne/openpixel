import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { OS_SCRIPT } from "@/lib/platforms";
import { DESCRIPTION, OG_IMAGE, SITE_NAME, SITE_URL, TAGLINE, TWITTER_IMAGE, X_HANDLE } from "@/lib/seo";
import CookieBanner from "@/components/CookieBanner";
import DownloadTracking from "@/components/DownloadTracking";
import EventTracking from "@/components/EventTracking";
import "./globals.css";

// Fonts are downloaded at build time and served from this site: visitors make no requests to Google.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap", axes: ["opsz"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

// Defaults for every page; each page sets its own title, description and canonical address with pageMeta().
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TAGLINE, template: `%s · ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, images: [TWITTER_IMAGE] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#1e1e1e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script below adds data-os to <html> before React starts, hence suppressHydrationWarning (one level deep).
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        {/* First in the body, so the visitor's system is known before anything is painted. */}
        <script dangerouslySetInnerHTML={{ __html: OS_SCRIPT }} />
        {children}
        <CookieBanner />
        <DownloadTracking />
        <EventTracking />
      </body>
    </html>
  );
}
