import type { Metadata } from "next";
import IconLibrary from "@/components/IconLibrary";
import JsonLd from "@/components/JsonLd";
import { Footer, Header, Headline } from "@/components/Chrome";
import { ICON_CATEGORIES, ICON_COUNT } from "@/lib/pixel-icons";
import { iconRows } from "@/lib/pixel-icons-server";
import { ICONS_LIBRARY_CARD, breadcrumbJsonLd, iconLibraryJsonLd, pageMeta } from "@/lib/seo";

const count = ICON_COUNT.toLocaleString("en-US");

export const metadata: Metadata = pageMeta({
  path: "/icons/library",
  title: `Pixel icon library: search ${count} free pixel art icons`,
  description: `Search ${count} free pixel art icons by name or category. Change the colour, border, shadow and size, then copy SVG, JSX or PNG, or download SVG, PNG and .openpixel files.`,
  image: ICONS_LIBRARY_CARD,
  keywords: ["pixel icons", "pixel art icons", "free pixel icons", "pixel icon library", "8-bit icons", "SVG pixel icons"],
});

/** Icons the page shows before the whole set has loaded: the first ones in the grid, so it never starts empty. */
const PREVIEW = 120;

export default function IconLibraryPage() {
  const preview = [...iconRows().values()].slice(0, PREVIEW);
  return (
    <>
      <Header />
      <JsonLd
        data={breadcrumbJsonLd([
          ["Pixel Icons", "/icons"],
          ["Library", "/icons/library"],
        ])}
      />
      <JsonLd data={iconLibraryJsonLd()} />
      <main className="icons-library">
        <section className="page-head wrap-wide">
          <Headline as="h1" lead="Pixel icon library." rest={`${count} free pixel art icons, ready to copy.`} />
        </section>
        <IconLibrary categories={ICON_CATEGORIES} total={ICON_COUNT} preview={preview} />
      </main>
      <Footer />
    </>
  );
}
