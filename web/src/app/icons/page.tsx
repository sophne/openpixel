import type { Metadata } from "next";
import Link from "next/link";
import DownloadButton from "@/components/DownloadButton";
import IconWall from "@/components/IconWall";
import JsonLd from "@/components/JsonLd";
import PixelIcon from "@/components/PixelIcon";
import { Footer, Header, Headline } from "@/components/Chrome";
import { ICONS_FAQ } from "@/lib/icons-faq";
import { masks, paths, type Paths } from "@/lib/pixel-icon-render";
import { FEATURED_ICONS, ICON_CATEGORIES, ICON_COUNT, LUCIDE_VERSION } from "@/lib/pixel-icons";
import { iconStroke } from "@/lib/pixel-icons-server";
import { ICONS_CARD, breadcrumbJsonLd, iconsJsonLd, pageMeta } from "@/lib/seo";

const count = ICON_COUNT.toLocaleString("en-US");

export const metadata: Metadata = pageMeta({
  path: "/icons",
  title: `Free pixel icons: ${count} pixel art icons in SVG and PNG`,
  description: `Download ${count} free pixel art icons for games, apps and websites: every Lucide icon redrawn as 32×32 pixel icons. Recolour, resize and copy SVG, PNG or JSX.`,
  image: ICONS_CARD,
  keywords: [
    "pixel icons",
    "pixel art icons",
    "free pixel icons",
    "pixel icon set",
    "8-bit icons",
    "retro icons",
    "game UI icons",
    "SVG pixel icons",
  ],
});

const featured: [string, Paths][] = FEATURED_ICONS.map(([name, stroke]) => [name, paths(masks(stroke))]);
const icon = (name: string) => featured.find(([n]) => n === name)?.[1] ?? paths(masks(iconStroke(name)));

/** Who the set is for: the searches people make for pixel icons, each with icons that fit it. */
const USES = [
  {
    id: "games",
    title: "Pixel icons for games",
    text: "Inventory slots, health and coins, menus and map markers that sit right in a pixel-art game. PNG at whole-number sizes for Unity, Godot, GameMaker and Phaser.",
    icons: ["swords", "shield", "heart", "coins", "gem", "backpack", "scroll", "castle"],
  },
  {
    id: "apps",
    title: "Retro icons for apps and websites",
    text: "An 8-bit look for buttons, navigation and empty states. Paste the SVG inline or the JSX into React, and it stays sharp on every screen.",
    icons: ["house", "search", "mail", "bell", "settings", "menu", "mouse-pointer-2", "wand-sparkles"],
  },
  {
    id: "design",
    title: "Pixel art icons for design",
    text: "Drop SVGs into Figma, Penpot or Sketch for mockups, slides and social posts, recoloured to your palette before you copy them.",
    icons: ["pen-tool", "layers", "palette", "frame", "layout-grid", "pencil", "image", "map"],
  },
];

/** "Recolour everything": one icon in three looks the customizer can make. */
const LOOKS = [
  { stroke: "#ffffff", outline: "#000000", shadow: "#4b4b55", border: true, drop: true },
  { stroke: "#ff4a1c", outline: "#1a0702", shadow: "#6b1f0c", border: true, drop: true },
  { stroke: "#ffc425", outline: "#000000", shadow: "#000000", border: true, drop: false },
];

const FORMATS = [
  ["SVG", "Whole pixels as paths, sharp at any zoom"],
  ["PNG", "From 32 to 256 pixels, nearest-neighbour"],
  ["JSX", "A React component, ready to paste"],
  [".openpixel", "Opens in OpenPixel to edit"],
];

export default function IconsLanding() {
  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Pixel Icons", "/icons"]])} />
      <JsonLd data={iconsJsonLd(ICONS_FAQ)} />
      <main className="icons-landing">
        <section className="hero icons-hero">
          <div className="wrap hero-inner">
            <Headline as="h1" lead={`${count} free pixel icons.`} rest="Every Lucide icon, redrawn as pixel art." />
            <p className="lead-text">
              A free pixel art icon set for games, apps and websites. Every icon sits on a 32×32 grid with a crisp 2px
              stroke, a 1px border and a drop shadow. Recolour each part, pick a size, then copy or download SVG, PNG or
              JSX.
            </p>
            <div className="row-buttons">
              <Link
                className="button primary large"
                href="/icons/library"
                data-event="icons_cta_click"
                data-event-cta="browse_library"
                data-event-location="hero"
              >
                Browse the library
              </Link>
              <a
                className="button large"
                href="/icons/openpixel-pixel-icons.zip"
                download
                data-event="icon_pack_download"
                data-event-location="landing_hero"
              >
                Download all (.zip, 3 MB)
              </a>
            </div>
            <p className="hero-note">Free for any project. MIT licence.</p>
          </div>
          <div className="wrap">
            <IconWall icons={featured} />
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <Headline lead="Made to be changed." rest="Yours in three clicks." />
            <div className="trio">
              <article className="card">
                <h3>Recolour everything</h3>
                <p>Primary colour, border and shadow each have their own colour, and the border and shadow switch off.</p>
                <div className="card-art ic-looks" aria-hidden="true">
                  {LOOKS.map((l, i) => (
                    <div
                      key={i}
                      className="ic-look"
                      data-pi-border={l.border ? undefined : "off"}
                      data-pi-drop={l.drop ? undefined : "off"}
                      style={{ "--pi-stroke": l.stroke, "--pi-outline": l.outline, "--pi-shadow": l.shadow } as React.CSSProperties}
                    >
                      <PixelIcon paths={icon("heart")} size={64} />
                    </div>
                  ))}
                </div>
              </article>
              <article className="card">
                <h3>Sharp at every size</h3>
                <p>Drawn on a 32 pixel grid and scaled by whole numbers, so every pixel stays square.</p>
                <div className="card-art ic-sizes" aria-hidden="true">
                  {[32, 64, 96].map((s) => (
                    <figure key={s}>
                      <PixelIcon paths={icon("rocket")} size={s} />
                      <figcaption>{s}px</figcaption>
                    </figure>
                  ))}
                </div>
              </article>
              <article className="card">
                <h3>Copy or download</h3>
                <p>Every icon, in the colours and size you set, one click away.</p>
                <ul className="card-art ic-formats">
                  {FORMATS.map(([f, what]) => (
                    <li key={f}>
                      <code>{f}</code>
                      <span>{what}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <Headline lead="Pixel art icons for anything." rest="Games, apps, websites and design." />
            <div className="trio">
              {USES.map((u) => (
                <article key={u.title} className="card">
                  <h3>{u.title}</h3>
                  <p>{u.text}</p>
                  <ul className="card-art ic-use" aria-label={`Icons for ${u.title.toLowerCase()}`}>
                    {u.icons.map((n) => (
                      <li key={n}>
                        <Link
                          href={`/icons/library?icon=${n}`}
                          aria-label={`${n} pixel icon`}
                          title={n}
                          data-event="icons_icon_click"
                          data-event-icon-name={n}
                          data-event-location={`use_case_${u.id}`}
                        >
                          <PixelIcon paths={icon(n)} size={64} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <Headline lead={`${ICON_CATEGORIES.length} categories.`} rest="Pixel icons from arrows to weather." />
            <ul className="ic-cats">
              {ICON_CATEGORIES.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/icons/library?category=${c.id}`}
                    title={`${c.title} pixel icons`}
                    data-event="icons_category_click"
                    data-event-category={c.id}
                  >
                    {c.title}
                    <span>{c.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="block">
          <div className="wrap ic-made">
            <div>
              <Headline lead="Drawn in OpenPixel." rest="Edit them, or draw your own." />
              <p className="lead-text">
                Each icon is a layer in an OpenPixel file. Download one as <code>.openpixel</code>, open it in the app
                and change any pixel, or ask your agent to draw the icon your set is still missing.
              </p>
              <div className="row-buttons">
                <DownloadButton place="icons" className="button primary large" />
                <Link
                  className="button large"
                  href="/explore"
                  data-event="icons_cta_click"
                  data-event-cta="explore"
                  data-event-location="made_in_openpixel"
                >
                  Explore pixel art
                </Link>
              </div>
            </div>
            <div className="ic-zoom" aria-hidden="true">
              <PixelIcon paths={icon("palette")} />
            </div>
          </div>
        </section>

        <section className="block closing">
          <div className="wrap center">
            <Headline lead="Find your pixel icon." rest={`${count} of them, all free.`} />
            <p className="lead-text">
              Free under the{" "}
              <a href="/icons/LICENSE.txt" data-event="icons_licence_click">
                MIT licence
              </a>, for personal and commercial projects.
              Redrawn from the shapes of{" "}
              <a href="https://lucide.dev" target="_blank" rel="noopener noreferrer">Lucide</a> {LUCIDE_VERSION}.
            </p>
            <div className="row-buttons center">
              <Link
                className="button primary large"
                href="/icons/library"
                data-event="icons_cta_click"
                data-event-cta="browse_library"
                data-event-location="closing"
              >
                Browse the library
              </Link>
            </div>
          </div>
        </section>
        <section className="block">
          <div className="wrap ic-faq">
            <Headline lead="Questions." rest="About the pixel icons." />
            <div className="ic-faq-list">
              {ICONS_FAQ.map((f) => (
                <details key={f.q} className="faq-item" data-event="faq_open" data-event-question={f.q} data-event-page="icons">
                  <summary>
                    <h3>{f.q}</h3>
                    <span className="faq-icon" aria-hidden="true" />
                  </summary>
                  <div className="faq-answer">
                    <p>{f.a}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
