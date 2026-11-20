import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { OG_IMAGE, SITE_NAME, SITE_URL, TWITTER_IMAGE, X_HANDLE } from "@/lib/seo";
import CookieBanner from "@/components/CookieBanner";
import DownloadTracking from "@/components/DownloadTracking";
import "./globals.css";

// Fonts are downloaded at build time and served from this site: visitors make no requests to Google.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap", axes: ["opsz"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap", weight: ["400", "500"] });

// Defaults for every page; each page sets its own title, description and canonical address with pageMeta().
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "OpenPixel: the agentic pixel editor for Mac", template: `%s · ${SITE_NAME}` },
  description:
    "Free, open-source pixel art and voxel editor for the Mac with a built-in MCP server. Draw sprites, animations and 3D models with Claude, Codex, Cursor or any agent.",
  applicationName: SITE_NAME,
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: { siteName: SITE_NAME, type: "website", locale: "en_US", images: [OG_IMAGE] },
  twitter: { card: "summary_large_image", site: X_HANDLE, creator: X_HANDLE, images: [TWITTER_IMAGE] },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#1e1e1e", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        {children}
        <CookieBanner />
        <DownloadTracking />
      </body>
    </html>
  );
}
