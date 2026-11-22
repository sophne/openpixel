import Image from "next/image";
import Link from "next/link";
import AiIcon from "@/components/AiIcon";
import AppWindow from "@/components/AppWindow";
import PromptBar from "@/components/PromptBar";
import Dock from "@/components/Dock";
import DownloadButton, { DownloadNote } from "@/components/DownloadButton";
import Showcase from "@/components/Showcase";
import Sprite from "@/components/Sprite";
import { Footer, Header, Headline } from "@/components/Chrome";
import { featureArt } from "@/lib/feature-art";
import { collections } from "@/lib/explore";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { NOTARIZED, REPO_URL, latestRelease } from "@/lib/github";
import { DESCRIPTION, TAGLINE, homeJsonLd, pageMeta } from "@/lib/seo";
import editorShot from "../../public/editor.png";
import editor3dShot from "../../public/editor-3d.png";

export const metadata: Metadata = pageMeta({
  path: "/",
  title: TAGLINE,
  absoluteTitle: true,
  description: DESCRIPTION,
});

/**
 * Agents as dark Dock icons (rendered on a Mac by web/scripts/dock-icons.swift). Agents without a Mac app
 * get the plain dark tile with their mark drawn on top by the browser; "Any agent" gets the AI sparkle.
 */
const AGENTS: { name: string; icon: string; mark?: string; markClass?: string; sparkle?: boolean }[] = [
  { name: "Claude", icon: "/dock/claude.png" },
  { name: "Claude Code", icon: "/dock/claudecode.png", mark: "/agents/claudecode-color.svg" },
  { name: "Grok", icon: "/dock/grok.png" },
  { name: "Codex", icon: "/dock/codex.png", mark: "/dock/codex-mark.svg", markClass: "wide" },
  { name: "Cursor", icon: "/dock/cursor.png" },
  { name: "OpenClaw", icon: "/dock/openclaw.png", mark: "/agents/openclaw-color.svg" },
  { name: "Hermes Agent", icon: "/dock/hermes.png" },
  { name: "Any agent", icon: "/dock/tile.png", sparkle: true },
];

/**
 * The "Made in OpenPixel" band: every piece on the Explore page drifting right to left across a canvas, the
 * collections interleaved. Each is shown at a whole-number zoom of its art pixels that its picture divides into
 * evenly (GIFs are exported upscaled), so pixels stay square. Heights are fixed rather than random at runtime, so
 * the server and the browser render the same thing.
 */
const BAND = 456;
const DRIFT = (() => {
  const lists = collections.map((c) => c.items);
  const mixed = Array.from({ length: Math.max(...lists.map((l) => l.length)) }, (_, i) =>
    lists.map((l) => l[i]).filter(Boolean),
  ).flat();
  return mixed.map((item, i) => {
    const pw = item.w / item.scale;
    const ph = item.h / item.scale;
    const room = item.collection === "scenes" ? 260 : 128;
    let k = 1;
    for (let z = 2; Math.max(pw, ph) * z <= room; z++) if (item.scale === 1 || item.scale % z === 0) k = z;
    const w = Math.round(pw * k);
    const h = Math.round(ph * k);
    const y = 16 + ((i * 151 + 37) % Math.max(1, BAND - 32 - h));
    return { item, w, h, y };
  });
})();

const MORE = [
  "Pencil, eraser, fill, line, rectangle and move",
  "Recolour and eyedropper",
  "500 steps of undo",
  "Colour ramps and gradients",
  "Import PNGs from any editor",
  "PNG, SVG and HTML export",
  "Turnaround renders in 8 angles",
  "Recent files with previews",
  "Headless mode for scripts and CI",
  "MCP over HTTP for ChatGPT",
  "Tells you when a new version is out",
  "One download for Apple silicon and Intel Macs",
];

/** "The pixel tools you expect": each feature with its picture, drawn in the app's empty-state style
 *  (web/scripts/make-feature-art.py). */
const FEATURES: { title: string; art: keyof typeof featureArt; label: string; text: string }[] = [
  { title: "Mac, Windows and Linux", art: "native", label: "A window opening with a lightning bolt", text: "One desktop app with the same tools, files and agents on all three." },
  { title: "Layers and frames", art: "layers", label: "Three stacked layers, the top one lifting", text: "Stack layers, add frames, set each frame's timing and press play." },
  { title: "Onion skin", art: "onion", label: "A bouncing ball with its two previous frames shown faintly", text: "See the frame before and after while you draw the in-betweens." },
  { title: "Mirror drawing", art: "mirror", label: "A heart drawn on one side of a mirror line, the other side following", text: "Draw one half and the other follows, across X, Y or Z." },
  { title: "Palettes", art: "palettes", label: "A palette of swatches, the selection moving between them", text: "DawnBringer, Endesga and your own. Swap a palette and every pixel follows." },
  { title: "Isometric preview", art: "iso", label: "An isometric cube floating over its shadow", text: "A live 2:1 pixel-art render of your model, sharp at every size." },
  { title: "Sprite sheets", art: "sheets", label: "A sprite sheet whose frames light up in turn", text: "Every frame and every angle in one PNG, ready for your game engine." },
  { title: "Animated GIFs", art: "gif", label: "A play button inside a looping arrow", text: "Export animations and turntables to share anywhere." },
  { title: "MagicaVoxel and OBJ", art: "vox", label: "A voxel dropping onto a stack of voxels", text: "Open and save .vox, export OBJ for Blender, Unity and Godot." },
];

/** The "Review loop" card: the angles review_model renders (the voxel tree from the front, isometric and side). */
const REVIEW_VIEWS: [string, number][] = [
  ["front", 0],
  ["iso", 1],
  ["side", 2],
];

/** The "Your subscription" card: agents in Agent Chat and whose plan each one runs on (as the app's menu shows them). */
const PLANS = [
  { name: "Claude", plan: "Claude subscription", logo: "/agents/claude-color.svg", picked: true },
  { name: "Codex", plan: "ChatGPT subscription", logo: "/agents/codex-color.svg" },
  // A one-colour mark (drawn in currentColor): shown as a mask in the light grey the app uses.
  { name: "Cursor", plan: "Cursor plan", logo: "/agents/cursor.svg", mono: true },
];

/** The "Works headless" card: what the terminal shows, one OpenPixel call per line (tool, detail, time). */
const TERM_LINES: [string, string, string][] = [
  ["new_sprite", "20×20", "0.1s"],
  ["paint_slice", "12 rows", "24s"],
  ["review_model", "score 92", "9s"],
  ["export_gif", "slime.gif", "2s"],
];

export default async function Home() {
  const release = await latestRelease();
  return (
    <>
      <Header />
      <JsonLd data={homeJsonLd(release)} />
      <main>
        {/* Hero */}
        <section className="hero">
          <div className="wrap hero-inner">
            <Dock />
            <Headline as="h1" lead="OpenPixel is an agentic pixel editor" rest="for sprites and voxel worlds." />
            <PromptBar />
            <DownloadButton place="home-hero" className="button primary large" />
            <DownloadNote className="hero-note" />
            <p className="hero-note">
              Free and open source.{" "}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </p>
          </div>
          <div className="wrap media">
            <AppWindow
              src={editorShot}
              alt="The OpenPixel editor with Agent Chat open: Claude has drawn a 224×165 pixel-art night scene of a two-storey house in the rain, its windows glowing orange, animated over 8 frames"
              title="Night Rain"
              priority
              video={{
                mp4: "/hero/agent-chat.mp4",
                webm: "/hero/agent-chat.webm",
                label:
                  "Screen recording: in OpenPixel's Agent Chat, Claude Opus 5.5 at high effort is asked for a rainy night house in the accent orange, then draws it on the canvas step by step, reviews it and plays the rain animation",
              }}
            />
          </div>
        </section>

        {/* What you can make */}
        <section className="block">
          <div className="wrap center">
            <Headline lead="Start from a sentence." rest="Agents draft it, you perfect every pixel." />
            <Showcase />
          </div>
        </section>

        {/* Gallery: art drifting across an OpenPixel canvas */}
        <section className="block">
          <div className="wrap">
            <Headline lead="Made in OpenPixel," rest="yours to keep." />
          </div>
          <div className="drift" aria-label="Every piece on the Explore page, made in OpenPixel" role="img">
            {/* Two identical sets: when the first has scrolled past, the second is exactly where it began. */}
            <div className="drift-track" aria-hidden="true" style={{ animationDuration: `${DRIFT.length * 7}s` }}>
              {[0, 1].map((set) =>
                DRIFT.map((d) => (
                  <span key={`${set}-${d.item.slug}`} className="drift-item" style={{ marginTop: d.y }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at an exact whole-number zoom */}
                    <img className="pixel" src={d.item.src} alt="" width={d.w} height={d.h} loading="lazy" decoding="async" />
                  </span>
                )),
              )}
            </div>
          </div>
          <div className="wrap center gallery-more">
            <Link className="button" href="/explore">
              Explore
            </Link>
          </div>
        </section>

        {/* Agents */}
        <section className="block" id="agents">
          <div className="wrap">
            <Headline lead="Draw with Claude, ChatGPT" rest="and any other agent." />
            <ul className="agent-grid">
              {AGENTS.map((a) => (
                <li key={a.name}>
                  <span className="agent-icon">
                    <Image src={a.icon} alt="" width={128} height={128} unoptimized />
                    {a.mark ? (
                      <Image
                        className={`agent-mark${a.markClass ? ` ${a.markClass}` : ""}`}
                        src={a.mark}
                        alt=""
                        width={64}
                        height={64}
                        unoptimized
                      />
                    ) : null}
                    {a.sparkle ? <AiIcon /> : null}
                  </span>
                  <span>{a.name}</span>
                </li>
              ))}
            </ul>
            <p className="lead-text agents-line">
              Connect over MCP with one command, or run OpenPixel headless from your scripts and CI.
            </p>
          </div>
        </section>

        {/* Agents on the canvas */}
        <section className="block">
          <div className="wrap">
            <Headline lead="Agents draw right on your canvas." rest="Watch every stroke, undo any of them." />
          </div>
          <div className="wrap media">
            <AppWindow
              src={editor3dShot}
              alt="The OpenPixel editor in 3D view with a voxel mushroom house, its layers listed in the sidebar"
              title="Mushroom house"
            />
          </div>
          <div className="wrap trio">
            <article className="card">
              <h3>Review loop.</h3>
              <p>Agents render their work from every angle, spot what looks off, and fix it before you ask.</p>
              <div className="card-art">
                {/* review_model, in small: the model from three angles, what it flagged (now fixed), the score. */}
                <div className="review" role="group" aria-label="A review of a voxel tree from three angles: two issues fixed, lighting fine, score from 77 to 92">
                  <div className="review-head">
                    <code>review_model</code>
                    <span className="review-score">
                      <s>77</s>
                      <span aria-hidden="true">→</span>
                      <b>92</b>
                    </span>
                  </div>
                  <div className="review-views">
                    {REVIEW_VIEWS.map(([name, frame]) => (
                      <span key={name} className="review-tile" title={`${name} view`}>
                        <Sprite art={featureArt.treeviews} fluid paused frame={frame} label={`The tree, ${name} view`} />
                      </span>
                    ))}
                  </div>
                  <p className="review-summary">
                    <span className="review-ok" aria-hidden="true">✓</span>2 issues fixed
                    <span className="review-dim">· lighting ok</span>
                  </p>
                </div>
              </div>
            </article>
            <article className="card">
              <h3>Your subscription.</h3>
              <p>Agent Chat runs the agents you already pay for: Claude, Codex, Cursor and more. No API keys.</p>
              <div className="card-art">
                {/* The app's own agent menu, in small: each agent with the plan it runs on. */}
                <ul className="plan-menu" aria-label="Agents in Agent Chat and the plans they use">
                  {PLANS.map((p) => (
                    <li key={p.name} className={p.picked ? "on" : undefined}>
                      <span className="check" aria-hidden="true" />
                      <span className="logo" aria-hidden="true">
                        {p.mono ? (
                          <span className="mask" style={{ "--m": `url(${p.logo})` } as React.CSSProperties} />
                        ) : (
                          <Image src={p.logo} alt="" width={16} height={16} unoptimized draggable={false} />
                        )}
                      </span>
                      <b>{p.name}</b>
                      <span className="plan">{p.plan}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
            <article className="card">
              <h3>Works headless.</h3>
              <p>No window needed. Agents can build, render and export from a terminal or a CI job.</p>
              <div className="card-art">
                {/* A terminal, in small: OpenPixel started headless, each line an OpenPixel call, then a fresh prompt. */}
                <div className="term" role="group" aria-label="A terminal running OpenPixel headless: it draws, reviews and exports a sprite">
                  <div className="term-bar">
                    <span className="term-lights" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="term-title">~/game — zsh</span>
                  </div>
                  <div className="term-body">
                    <p>
                      <span className="term-prompt">$</span> openpixel --mcp --headless
                    </p>
                    {TERM_LINES.map(([tool, detail, time]) => (
                      <p key={tool} className="term-step">
                        <span className="term-ok" aria-hidden="true">✓</span>
                        <span>{tool}</span>
                        <span className="term-dim">{detail}</span>
                        <span className="term-dim">{time}</span>
                      </p>
                    ))}
                    <p className="term-done">Done in 38s · wrote slime.gif</p>
                    <p>
                      <span className="term-prompt">$</span> <span className="term-caret" aria-hidden="true" />
                    </p>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        {/* Open source */}
        <section className="block">
          <div className="wrap">
            <Headline lead="Free and open source." rest="No account, no subscription, no catch." />
            <div className="quad">
              <div>
                <h3>MIT licence</h3>
                <p>Read it, fork it, build it into your own tools. The whole app is on GitHub.</p>
              </div>
              <div>
                <h3>Your files, plain JSON</h3>
                <p>An .openpixel file is readable JSON, so people, scripts and agents all understand it.</p>
              </div>
              <div>
                <h3>Nothing phones home</h3>
                <p>No sign-in, no analytics. The only request it makes is a check for updates.</p>
              </div>
              <div>
                {NOTARIZED ? (
                  <>
                    <h3>Signed and notarized</h3>
                    <p>
                      The Mac app carries a Developer ID and is notarized by Apple. Updates come straight from the
                      project&apos;s GitHub releases.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Updates from the source</h3>
                    <p>New versions come straight from the project&apos;s GitHub releases, the same place as the code.</p>
                  </>
                )}
              </div>
            </div>
            <div className="row-buttons">
              <a className="button" href={REPO_URL} target="_blank" rel="noopener noreferrer">
                Read the code
              </a>
              <a
                className="button ghost"
                href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Contribute
              </a>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="block">
          <div className="wrap">
            <Headline lead="The pixel tools you expect." rest="Feel right at home." />
            <div className="features">
              {FEATURES.map((f) => (
                <article key={f.title} className="card feature">
                  <h3>{f.title}</h3>
                  <div className="feature-art">
                    <Sprite art={featureArt[f.art]} scale={4} label={f.label} />
                  </div>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
            <ul className="more">
              {MORE.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="more-end">This list goes on and on…</p>
          </div>
        </section>

        {/* Closing */}
        <section className="block closing">
          <div className="wrap center">
            <div className="closing-sprites" aria-hidden="true">
              <Sprite art={featureArt.coin} scale={3} />
              <Sprite art={featureArt.slime} scale={3} />
              <Sprite art={featureArt.campfire} scale={3} />
            </div>
            <Headline lead="Start drawing" rest="your ideas today." />
            <p className="lead-text">Draw with agents, refine every pixel, and ship it straight to your game.</p>
            <div className="row-buttons center">
              <DownloadButton place="home-bottom" className="button primary large" />
              <Link className="button large" href="/compare">
                Compare editors
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
