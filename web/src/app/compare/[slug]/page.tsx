import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import AppWindow from "@/components/AppWindow";
import Sprite from "@/components/Sprite";
import { Footer, Header } from "@/components/Chrome";
import { art } from "@/lib/art";
import { CHECKED, COMPETITORS, bySlug, type Cell, type Visual } from "@/lib/compare";
import { REPO_URL } from "@/lib/github";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import editorShot from "../../../../public/editor.png";
import editor3dShot from "../../../../public/editor-3d.png";

export function generateStaticParams() {
  return COMPETITORS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = bySlug((await params).slug);
  if (!c) return {};
  return pageMeta({
    path: `/compare/${c.slug}`,
    title: `OpenPixel vs ${c.name}: ${c.tagline}`,
    description: c.intro,
    absoluteTitle: true,
  });
}

const DB32 =
  "000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30".split(
    " ",
  );

function Mark({ cell, us }: { cell: Cell; us?: boolean }) {
  const label = { yes: "Supported", partial: "Limited", no: "Unavailable" }[cell.v];
  return (
    <div className={`cmp-cell${us ? " us" : ""}`}>
      <svg width="20" height="20" viewBox="0 0 20 20" role="img" aria-label={label}>
        {cell.v === "yes" ? (
          <path d="M4.5 10.5l3.5 3.5 7.5-8" />
        ) : cell.v === "partial" ? (
          <path d="M5 10h10" />
        ) : (
          <path d="M6 6l8 8M14 6l-8 8" />
        )}
      </svg>
      {cell.note ? <span>{cell.note}</span> : null}
    </div>
  );
}

function CardVisual({ v }: { v: Visual }) {
  switch (v) {
    case "import":
      return <Sprite art={art.chest} scale={6} />;
    case "palettes":
      return (
        <div className="swatches big" aria-hidden="true">
          {DB32.map((c) => (
            <i key={c} style={{ background: `#${c}` }} />
          ))}
        </div>
      );
    case "make3d":
      return (
        <div className="make3d">
          <Sprite art={art.chest} scale={3} />
          <span className="arrow" aria-hidden="true" />
          <Sprite art={art.chest3d} scale={1} />
        </div>
      );
    case "animate":
      return <Sprite art={art.campfire} scale={9} />;
    case "agent":
      return <Sprite art={art.human} scale={9} />;
    case "vox":
      return <Sprite art={art.mushroom} scale={2} />;
    case "iso":
      return <Sprite art={art.tree} scale={2} />;
    case "voxagent":
      return <Sprite art={art.robot3d} scale={2} />;
  }
}

function Buttons() {
  return (
    <div className="cmp-buttons">
      <a className="cmp-btn primary" href="/downloads/mac" data-download="compare">
        Download
      </a>
      <a className="cmp-btn" href={REPO_URL} target="_blank" rel="noopener noreferrer">
        View on GitHub
      </a>
    </div>
  );
}

export default async function CompareDetail({ params }: { params: Promise<{ slug: string }> }) {
  const c = bySlug((await params).slug);
  if (!c) notFound();

  return (
    <>
      <Header />
      <JsonLd
        data={breadcrumbJsonLd([
          ["Compare", "/compare"],
          [`OpenPixel vs ${c.name}`, `/compare/${c.slug}`],
        ])}
      />
      <main className="cmp">
        {/* Hero */}
        <section className="cmp-hero detail">
          <Image className="cmp-mark" src="/dock/openpixel.png" alt="" width={128} height={128} priority unoptimized />
          <h1 className="cmp-vs">
            OpenPixel <span>vs</span> {c.name}
          </h1>
          <p className="cmp-tagline">{c.tagline}</p>
          <p className="cmp-intro">{c.intro}</p>
          <Buttons />
          <p className="cmp-note">Free for macOS 13 or later, on Apple silicon and Intel.</p>
        </section>

        <div className="cmp-wide">
          <AppWindow
            src={editorShot}
            alt="The OpenPixel editor with a pixel-art scene of a Greek temple ruin"
            title="Temple of Athena"
          />
        </div>

        {/* Comparison table */}
        <section className="cmp-why">
          <h2 className="cmp-h2">Why choose OpenPixel over {c.name}</h2>
          <p className="cmp-sub">{c.whySub}</p>
          <ul className="cmp-legend" aria-label="Legend">
            <li>
              <Mark cell={{ v: "yes" }} /> Supported
            </li>
            <li>
              <Mark cell={{ v: "partial" }} /> Limited
            </li>
            <li>
              <Mark cell={{ v: "no" }} /> Unavailable
            </li>
          </ul>
          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <caption className="sr-only">OpenPixel and {c.name} feature comparison</caption>
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col" className="us">
                    <span className="cmp-th-brand">
                      <Image src="/app-icon.svg" alt="" width={20} height={20} />
                      OpenPixel
                    </span>
                  </th>
                  <th scope="col">{c.name}</th>
                </tr>
              </thead>
              <tbody>
                {c.rows.map((r) => (
                  <tr key={r.feature}>
                    <th scope="row">{r.feature}</th>
                    <td className="us">
                      <Mark cell={r.us} us />
                    </td>
                    <td>
                      <Mark cell={r.them} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cmp-footnote">
            Details about {c.name} come from its own website and store, checked in {CHECKED}. Spotted something out of
            date?{" "}
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
              Tell us on GitHub
            </a>
            . {c.name} is a trademark of its owner.
          </p>
        </section>

        {/* Bring your work */}
        <section className="cmp-bring">
          <h2 className="cmp-h2">{c.bring.title}</h2>
          <p className="cmp-sub">{c.bring.sub}</p>
          <div className="cmp-cards tall">
            {c.bring.cards.map((card) => (
              <article key={card.title} className="cmp-feature">
                <h3>{card.title}</h3>
                <div className="cmp-feature-art">
                  <CardVisual v={card.visual} />
                </div>
                <p>{card.text}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Showcases (screenshots stand in for the videos) */}
        <section className="cmp-show">
          <h2>
            Choose how you draw
            <span>With agents, by hand, or both.</span>
          </h2>
          <AppWindow
            src={editor3dShot}
            alt="The OpenPixel editor in 3D with a voxel mushroom house"
            title="Mushroom house"
          />
        </section>

        <section className="cmp-show compact">
          <h2>
            Native and fast. <span>See an agent draw it live.</span>
          </h2>
          <AppWindow
            src={editorShot}
            alt="The OpenPixel editor with a pixel-art sprite an agent drew"
            title="Temple of Athena"
          />
        </section>

        {/* Closing */}
        <section className="cmp-cta">
          <Image className="cmp-cta-mark" src="/app-icon.svg" alt="" width={380} height={380} />
          <h2>{c.cta.title}</h2>
          <p className="cmp-sub">{c.cta.sub}</p>
          <Buttons />
        </section>
      </main>
      <Footer />
    </>
  );
}
