import type { Metadata } from "next";
import { REPO_URL, X_URL, assetUrl, hasFile, type Release } from "@/lib/github";
import { FILES } from "@/lib/platforms";
import type { Faq } from "@/lib/faq";
import { ICON_CATEGORIES, ICON_COUNT, LUCIDE_VERSION } from "@/lib/pixel-icons";

/**
 * Search and social metadata shared by every page. The preview cards in public/og are made by
 * scripts/og/make-og.sh; bump CARD_VERSION when you regenerate them so X, Slack and others fetch the new ones.
 */

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "OpenPixel";
export const X_HANDLE = `@${X_URL.replace(/\/$/, "").split("/").pop()}`;

/** The site's title and description, wherever a page doesn't set its own. */
export const TAGLINE = "OpenPixel: the agentic pixel editor for Mac, Windows and Linux";
export const DESCRIPTION =
  "Free, open-source pixel art and voxel editor for Mac, Windows and Linux with a built-in MCP server. Draw sprites, animations and 3D models with Claude, Codex, Cursor or any agent.";

const CARD_VERSION = 3;
const CARD_ALT =
  "OpenPixel is an agentic pixel editor for sprites and voxel worlds, free for Mac, Windows and Linux: a 32×32 pixel-art treasure chest drawn in OpenPixel, next to the prompt that made it.";
export const OG_IMAGE = { url: `/og/opengraph.png?v=${CARD_VERSION}`, width: 1200, height: 630, alt: CARD_ALT, type: "image/png" };
export const TWITTER_IMAGE = { url: `/og/twitter.png?v=${CARD_VERSION}`, width: 1200, height: 600, alt: CARD_ALT };

type CardImage = { url: string; width: number; height: number; alt: string; type?: string };
export type Card = { og: CardImage; twitter: CardImage };

/** A page's own preview cards, made by scripts/og/make-og.sh as public/og/<name>-opengraph.png and -twitter.png. */
function card(name: string, alt: string): Card {
  return {
    og: { url: `/og/${name}-opengraph.png?v=${CARD_VERSION}`, width: 1200, height: 630, alt, type: "image/png" },
    twitter: { url: `/og/${name}-twitter.png?v=${CARD_VERSION}`, width: 1200, height: 600, alt },
  };
}

export const ICONS_CARD = card(
  "icons",
  `OpenPixel Pixel Icons: ${ICON_COUNT.toLocaleString("en-US")} free pixel icons for games, apps and the web, in SVG, PNG, JSX and .openpixel, next to a grid of the white 32×32 pixel-art icons with a few in orange.`,
);
export const ICONS_LIBRARY_CARD = card(
  "icons-library",
  "The OpenPixel pixel icon library: recolour, resize, copy. The customizer's colour, border, shadow and size controls next to nine pixel-art icons in different colours.",
);

/** Title, description, canonical address and matching Open Graph and X fields for one page. */
export function pageMeta({
  path,
  title,
  description,
  absoluteTitle = false,
  image,
  keywords,
}: {
  path: string;
  title: string;
  description: string;
  /** Use the title as written, without " · OpenPixel" after it. */
  absoluteTitle?: boolean;
  /** The page's own preview cards; the site's card otherwise. */
  image?: Card;
  keywords?: string[];
}): Metadata {
  const full = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    ...(keywords ? { keywords } : {}),
    alternates: { canonical: path },
    openGraph: {
      title: full,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [image?.og ?? OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description,
      site: X_HANDLE,
      creator: X_HANDLE,
      images: [image?.twitter ?? TWITTER_IMAGE],
    },
  };
}

const abs = (path: string) => `${SITE_URL}${path}`;

const ORG_ID = abs("/#organization");

/** Who makes OpenPixel and where to find it. */
const organization = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: SITE_NAME,
  url: abs("/"),
  logo: abs("/icon.png"),
  sameAs: [REPO_URL, X_URL],
};

/** Structured data for the home page: the site, its publisher and the app itself. */
export function homeJsonLd(release: Release | null) {
  // Only files the newest release carries (all of them when GitHub didn't answer).
  const downloads = FILES.filter((f) => hasFile(release, f) !== false).map((f) => assetUrl(f.file));
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": abs("/#website"), name: SITE_NAME, url: abs("/"), publisher: { "@id": ORG_ID } },
      organization,
      {
        "@type": "SoftwareApplication",
        "@id": abs("/#app"),
        name: SITE_NAME,
        description:
          "Free, open-source pixel art and voxel editor for Mac, Windows and Linux with a built-in MCP server, so AI agents can draw, review and refine sprites, animations and 3D models with you.",
        applicationCategory: "DesignApplication",
        applicationSubCategory: "Pixel art and voxel editor",
        operatingSystem: "macOS 12 or later, Windows 10 or later, Linux",
        processorRequirements: "Apple silicon or Intel on macOS; 64-bit x86 on Windows and Linux",
        ...(release ? { softwareVersion: release.version } : {}),
        url: abs("/"),
        downloadUrl: downloads,
        installUrl: abs("/downloads"),
        releaseNotes: abs("/changelog"),
        image: abs("/icon.png"),
        screenshot: [abs("/editor.png"), abs("/editor-3d.png")],
        isAccessibleForFree: true,
        license: `${REPO_URL}/blob/main/LICENSE`,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        featureList: [
          "2D pixel art canvas with layers, frames, onion skin and palettes",
          "3D voxel models with isometric pixel-art previews",
          "Built-in MCP server for Claude, Codex, Cursor and other AI agents",
          "Exports to PNG, SVG, animated GIF, sprite sheets, MagicaVoxel .vox and OBJ",
        ],
      },
    ],
  };
}

/** Breadcrumbs from the home page down to this page; `trail` is [name, path] pairs after Home. */
export function breadcrumbJsonLd(trail: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["Home", "/"] as [string, string], ...trail].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: abs(path),
    })),
  };
}

const ICON_SET_ID = abs("/icons#set");

/** The icon set as a creative work, shared by both icon pages. */
function iconSet() {
  return {
    "@type": "CreativeWork",
    "@id": ICON_SET_ID,
    name: "OpenPixel Pixel Icons",
    alternateName: ["Pixel Icons", "Pixel art icons"],
    description: `${ICON_COUNT.toLocaleString("en-US")} free pixel art icons: every Lucide ${LUCIDE_VERSION} icon redrawn as 32×32 pixel art with a 2px stroke, a 1px border and a drop shadow. Download as SVG, PNG, JSX or .openpixel.`,
    url: abs("/icons"),
    image: abs(ICONS_CARD.og.url),
    genre: "Icon set",
    keywords: [
      "pixel icons",
      "pixel art icons",
      "free pixel icons",
      "8-bit icons",
      "retro icons",
      "game UI icons",
      "SVG icons",
      ...ICON_CATEGORIES.map((c) => `${c.title.toLowerCase()} icons`),
    ].join(", "),
    encodingFormat: ["image/svg+xml", "image/png"],
    isAccessibleForFree: true,
    isBasedOn: "https://lucide.dev",
    license: abs("/icons/LICENSE.txt"),
    creator: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
  };
}

/** Structured data for /icons: the page, the icon set it presents, and its questions. */
export function iconsJsonLd(faq: Faq[]) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      {
        "@type": "CollectionPage",
        "@id": abs("/icons#page"),
        url: abs("/icons"),
        name: "Free pixel icons",
        isPartOf: { "@id": abs("/#website") },
        about: { "@id": ICON_SET_ID },
        mainEntity: { "@id": ICON_SET_ID },
        primaryImageOfPage: { "@type": "ImageObject", url: abs(ICONS_CARD.og.url), width: 1200, height: 630 },
      },
      iconSet(),
      {
        "@type": "FAQPage",
        "@id": abs("/icons#faq"),
        mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
    ],
  };
}

/** Structured data for /icons/library: a free web app for browsing and exporting the set. */
export function iconLibraryJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organization,
      iconSet(),
      {
        "@type": "WebApplication",
        "@id": abs("/icons/library#app"),
        name: "Pixel icon library",
        url: abs("/icons/library"),
        description: `Search ${ICON_COUNT.toLocaleString("en-US")} free pixel art icons, recolour their stroke, border and shadow, resize them and copy or download SVG, PNG, JSX and .openpixel.`,
        applicationCategory: "DesignApplication",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        image: abs(ICONS_LIBRARY_CARD.og.url),
        about: { "@id": ICON_SET_ID },
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}
