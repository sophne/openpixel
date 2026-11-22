import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import { Footer, Header, Headline } from "@/components/Chrome";
import { REPO_URL } from "@/lib/github";

export const metadata: Metadata = pageMeta({
  path: "/legal/licenses",
  title: "Licences",
  description: "OpenPixel's licence and the open-source work it builds on.",
});

const PARTS = [
  { name: "OpenPixel", what: "The app and this website", licence: "MIT", url: `${REPO_URL}/blob/main/LICENSE` },
  {
    name: "Electron",
    what: "The app's window and menus, with Chromium and Node.js inside it under their own licences",
    licence: "MIT",
    url: "https://github.com/electron/electron",
  },
  { name: "React", what: "The editor's interface in the app", licence: "MIT", url: "https://react.dev" },
  {
    name: "electron-updater",
    what: "Updates in the app",
    licence: "MIT",
    url: "https://github.com/electron-userland/electron-builder",
  },
  { name: "Lucide", what: "Interface icons in the app", licence: "ISC", url: "https://lucide.dev/license" },
  {
    name: "LobeHub Icons",
    what: "Agent logos in the app and on this site",
    licence: "MIT",
    url: "https://github.com/lobehub/lobe-icons",
  },
  {
    name: "Inter",
    what: "Typeface on this site",
    licence: "SIL Open Font License 1.1",
    url: "https://github.com/rsms/inter",
  },
  {
    name: "JetBrains Mono",
    what: "Code typeface on this site",
    licence: "SIL Open Font License 1.1",
    url: "https://github.com/JetBrains/JetBrainsMono",
  },
  { name: "Next.js and React", what: "This website", licence: "MIT", url: "https://github.com/vercel/next.js" },
  {
    name: "react-markdown",
    what: "Release notes on the changelog",
    licence: "MIT",
    url: "https://github.com/remarkjs/react-markdown",
  },
  {
    name: "potion-base-4M by MinishLab (Model2Vec)",
    what: "The embedding model behind the semantic search on the Explore page, © 2024 Thomas van Dongen",
    licence: "MIT",
    url: "https://huggingface.co/minishlab/potion-base-4M",
  },
];

// The Rust crates the app's core is built on (the Cargo.toml files under core/), with the licences their own
// packages state (`cargo metadata`). MIT or Apache 2.0, at your choice, where none is given here.
const CRATES: { name: string; what: string; licence?: string; url: string }[] = [
  { name: "serde_json", what: "Reading and writing JSON", url: "https://github.com/serde-rs/json" },
  { name: "base64", what: "Pictures in tool answers", url: "https://github.com/marshallpierce/rust-base64" },
  { name: "flate2", what: "Compression", url: "https://github.com/rust-lang/flate2-rs" },
  { name: "png", what: "PNG files", url: "https://github.com/image-rs/image-png" },
  { name: "gif", what: "Animated GIFs", url: "https://github.com/image-rs/image-gif" },
  { name: "libm", what: "Maths for the renderer", licence: "MIT", url: "https://github.com/rust-lang/compiler-builtins" },
  { name: "ureq", what: "Reading the update feed over HTTPS", url: "https://github.com/algesten/ureq" },
  { name: "dirs", what: "Finding your Documents folder", url: "https://github.com/soc/dirs-rs" },
  { name: "uuid", what: "Session ids for MCP over HTTP", url: "https://github.com/uuid-rs/uuid" },
  {
    name: "wasm-bindgen and js-sys",
    what: "Running the core inside the app as WebAssembly",
    url: "https://github.com/rustwasm/wasm-bindgen",
  },
];

const PALETTES = ["DawnBringer 16 and 32 by Richard Fhager", "PICO-8 by Lexaloffle", "Endesga 32 by Endesga"];

export default function Licenses() {
  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Licences", "/legal/licenses"]])} />
      <main>
        <section className="page-head wrap">
          <Headline as="h1" lead="Licences." rest="Built in the open, on the work of others." />
        </section>
        <article className="prose wrap">
          <h2>Software and fonts</h2>
          <ul>
            {PARTS.map((p) => (
              <li key={p.name}>
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.name}
                </a>
                : {p.what}. {p.licence}.
              </li>
            ))}
          </ul>
          <h2>The app&apos;s core</h2>
          <p>
            The core of the app (the document, every tool, rendering and file formats) is written in Rust and builds
            on these crates. Each is offered under MIT or Apache 2.0, at your choice, unless it says otherwise:
          </p>
          <ul>
            {CRATES.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.name}
                </a>
                : {c.what}.{c.licence ? ` ${c.licence}.` : ""}
              </li>
            ))}
          </ul>
          <p>
            They bring further crates with them, under MIT, Apache 2.0, BSD, ISC, Zlib, MPL 2.0, Unicode 3.0 and
            CDLA Permissive 2.0 licences. <code>core/Cargo.lock</code> in the repository names every one.
          </p>
          <h2>Palettes</h2>
          <p>The built-in palettes are well-known community palettes, credited to their authors:</p>
          <ul>
            {PALETTES.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <h2>Trademarks</h2>
          <p>
            Claude, ChatGPT, Codex, Cursor, Grok, Google Chrome, Finder, macOS, Windows, Linux, OpenClaw, Hermes
            Agent, Aseprite, Pixelorama and MagicaVoxel are trademarks of their owners. Their names and app icons appear on this site
            only to show what OpenPixel works with or to compare features; OpenPixel is not affiliated with or endorsed
            by them.
          </p>
          <p>
            The full licence texts ship with the source code. See the{" "}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              repository
            </a>
            .
          </p>
        </article>
      </main>
      <Footer />
    </>
  );
}
