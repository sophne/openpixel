import type { Metadata } from "next";
import ExploreBrowser from "@/components/ExploreBrowser";
import JsonLd from "@/components/JsonLd";
import { Footer, Header, Headline } from "@/components/Chrome";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { collections } from "@/lib/explore";

export const metadata: Metadata = pageMeta({
  path: "/explore",
  title: "Explore pixel art",
  description:
    "Characters, scenes and game assets drawn in OpenPixel by an AI agent. Free to download as PNG, GIF, HTML or MagicaVoxel .vox.",
});

export default function Explore() {
  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Explore", "/explore"]])} />
      <main className="explore">
        <section className="page-head wrap">
          <Headline as="h1" lead="Explore." rest="Pixel art an agent drew in OpenPixel." />
        </section>
        <ExploreBrowser collections={collections} />
      </main>
      <Footer />
    </>
  );
}
