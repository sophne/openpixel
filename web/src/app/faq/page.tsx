import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import { Footer, Header, Headline } from "@/components/Chrome";
import { FAQ, faqJsonLd } from "@/lib/faq";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata: Metadata = pageMeta({
  path: "/faq",
  title: "FAQ: pixel art, sprites, voxels and AI agents",
  description:
    "Answers about OpenPixel, the free pixel art and voxel editor for Mac: sprite sizes, sprite sheets, animation, palettes, MagicaVoxel .vox, exports for Unity and Godot, and drawing with AI agents.",
});

export default function Faq() {
  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["FAQ", "/faq"]])} />
      <JsonLd data={faqJsonLd()} />
      <main>
        <section className="page-head wrap">
          <Headline as="h1" lead="Questions." rest="Pixel art, voxels and agents, answered." />
        </section>
        <div className="faq wrap">
          <nav className="faq-nav" aria-label="FAQ sections">
            {FAQ.map((g) => (
              <a key={g.id} href={`#${g.id}`}>
                {g.title}
              </a>
            ))}
          </nav>
          {FAQ.map((g) => (
            <section key={g.id} id={g.id} className="faq-group" aria-labelledby={`${g.id}-title`}>
              <h2 id={`${g.id}-title`}>{g.title}</h2>
              {g.items.map((f) => (
                <details key={f.q} className="faq-item">
                  <summary>
                    <h3>{f.q}</h3>
                    <span className="faq-icon" aria-hidden="true" />
                  </summary>
                  <div className="faq-answer">
                    <p>{f.a}</p>
                    {f.link ? (
                      <p>
                        <Link href={f.link.href}>{f.link.label}</Link>
                      </p>
                    ) : null}
                  </div>
                </details>
              ))}
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
