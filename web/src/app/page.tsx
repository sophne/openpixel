import Image from "next/image";
import Link from "next/link";
import AiIcon from "@/components/AiIcon";
import AppWindow from "@/components/AppWindow";
import PromptBar from "@/components/PromptBar";
import Dock from "@/components/Dock";
import Showcase from "@/components/Showcase";
import Sprite from "@/components/Sprite";
import { Footer, Header, Headline } from "@/components/Chrome";
import { art } from "@/lib/art";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { NOTARIZED, REPO_URL, latestRelease } from "@/lib/github";
import { homeJsonLd, pageMeta } from "@/lib/seo";
import editorShot from "../../public/editor.png";
import editor3dShot from "../../public/editor-3d.png";

export const metadata: Metadata = pageMeta({
  path: "/",
  title: "OpenPixel: the agentic pixel editor for Mac",
  absoluteTitle: true,
  description:
    "Free, open-source pixel art and voxel editor for the Mac with a built-in MCP server. Draw sprites, animations and 3D models with Claude, Codex, Cursor or any agent.",
});

/**
 * Agents as dark Dock icons (rendered from this Mac by web/scripts/dock-icons.swift). Agents without a Mac app
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
 * The "Made in OpenPixel" band: art drifting right to left across a canvas. Heights are fixed rather than
 * random at runtime, so the server and the browser render the same thing; they're spread to look scattered.
 * `y` is the distance from the top of the band in px; `scale` is the pixel size.
 */
const DRIFT = [
  { a: art.slime, scale: 6, y: 204 },
  { a: art.mushroom, scale: 1.5, y: 48 },
  { a: art.coin, scale: 5, y: 264 },
  { a: art.campfire, scale: 6, y: 108 },
  { a: art.oak, scale: 5, y: 12 },
  { a: art.tree, scale: 1.5, y: 144 },
  { a: art.human, scale: 5, y: 252 },
  { a: art.chest, scale: 3, y: 72 },
  { a: art.robot3d, scale: 1.6, y: 180 },
];

const DB32 =
  "000000 222034 45283c 663931 8f563b df7126 d9a066 eec39a fbf236 99e550 6abe30 37946e 4b692f 524b24 323c39 3f3f74 306082 5b6ee1 639bff 5fcde4 cbdbfc ffffff 9badb7 847e87 696a6a 595652 76428a ac3232 d95763 d77bba 8f974a 8a6f30".split(
    " ",
  );

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
  NOTARIZED ? "Updates itself, signed and notarized" : "Updates itself, every update verified",
  "Apple silicon and Intel",
];

export default async function Home() {
  const release = await latestRelease();
  return (
    <>
      <Header />
      <JsonLd data={homeJsonLd(release?.version)} />
      <main>
        {/* Hero */}
        <section className="hero">
          <div className="wrap hero-inner">
            <Dock />
            <Headline as="h1" lead="OpenPixel is an agentic pixel editor" rest="for sprites and voxel worlds." />
            <PromptBar />
            <a className="button primary large" href="/downloads/mac">
              Download for macOS
            </a>
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
              alt="The OpenPixel editor with a 160×120 pixel-art scene: a ruined Greek temple above the sea, Athena with her owl, a hoplite and Pegasus"
              title="Temple of Athena"
              priority
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
          <div className="drift" aria-label="Sprites and voxel models made in OpenPixel" role="img">
            {/* Two identical sets: when the first has scrolled past, the second is exactly where it began. */}
            <div className="drift-track" aria-hidden="true">
              {[0, 1].map((set) =>
                DRIFT.map((d, i) => (
                  <span key={`${set}-${i}`} className="drift-item" style={{ marginTop: d.y }}>
                    <Sprite art={d.a} scale={d.scale} />
                  </span>
                )),
              )}
            </div>
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
              alt="The OpenPixel editor in 3D view with a voxel mushroom house"
              title="Mushroom house"
            />
          </div>
          <div className="wrap trio">
            <article className="card">
              <h3>Review loop.</h3>
              <p>Agents render their work from every angle, spot what looks off, and fix it before you ask.</p>
              <div className="card-art">
                <Sprite art={art.tree} scale={1} label="A voxel tree turning so every side can be checked" />
              </div>
            </article>
            <article className="card">
              <h3>Make 3D.</h3>
              <p>Turn any sprite into a voxel model with one click, or one tool call.</p>
              <div className="card-art make3d">
                <Sprite art={art.chest} scale={3} label="The flat treasure chest sprite" />
                <span className="arrow" aria-hidden="true" />
                <Sprite art={art.chest3d} scale={1} label="The same chest as a turning voxel model" />
              </div>
            </article>
            <article className="card">
              <h3>Works headless.</h3>
              <p>No window needed. Agents can build, render and export from a terminal or a CI job.</p>
              <div className="card-art">
                <pre className="mini-code">
                  <code>{`$ OpenPixel --mcp --headless
→ new_sprite   32×32
→ paint_slice  12 rows
→ export_gif   slime.gif`}</code>
                </pre>
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
                <p>No sign-in, no analytics. The only request it makes is a daily check for updates.</p>
              </div>
              <div>
                {NOTARIZED ? (
                  <>
                    <h3>Signed and notarized</h3>
                    <p>
                      Releases carry a Developer ID, are notarized by Apple, and every update is verified before it
                      installs.
                    </p>
                  </>
                ) : (
                  <>
                    <h3>Verified updates</h3>
                    <p>Every update is checked against OpenPixel&apos;s own signing key before it installs.</p>
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
              <article className="card feature">
                <h3>Native and fast</h3>
                <div className="feature-art">
                  <Sprite art={art.human} scale={6} />
                </div>
                <p>Built in Swift for the Mac. It opens in a blink and stays out of your way.</p>
              </article>
              <article className="card feature">
                <h3>Layers and frames</h3>
                <div className="feature-art">
                  <Sprite art={art.campfire} scale={6} />
                </div>
                <p>Stack layers, add frames, set each frame&apos;s timing and press play.</p>
              </article>
              <article className="card feature">
                <h3>Onion skin</h3>
                <div className="feature-art onion">
                  <Sprite art={art.slime} scale={6} paused frame={1} className="ghost" />
                  <Sprite art={art.slime} scale={6} paused frame={2} />
                </div>
                <p>See the frame before and after while you draw the in-betweens.</p>
              </article>
              <article className="card feature">
                <h3>Mirror drawing</h3>
                <div className="feature-art mirror">
                  <Sprite art={art.human} scale={6} paused />
                </div>
                <p>Draw one half and the other follows, across X, Y or Z.</p>
              </article>
              <article className="card feature">
                <h3>Palettes</h3>
                <div className="feature-art">
                  <div className="swatches" aria-hidden="true">
                    {DB32.map((c) => (
                      <i key={c} style={{ background: `#${c}` }} />
                    ))}
                  </div>
                </div>
                <p>DawnBringer, PICO-8, Endesga and your own. Swap a palette and every pixel follows.</p>
              </article>
              <article className="card feature">
                <h3>Isometric preview</h3>
                <div className="feature-art">
                  <Image src={art.mushroom.still!} alt="" width={124} height={129} className="pixel" />
                </div>
                <p>A live 2:1 pixel-art render of your model, sharp at every size.</p>
              </article>
              <article className="card feature">
                <h3>Sprite sheets</h3>
                <div className="feature-art">
                  <Image
                    src={art.coin.src}
                    alt=""
                    width={art.coin.w * art.coin.frames * 2}
                    height={art.coin.h * 2}
                    className="pixel"
                  />
                </div>
                <p>Every frame and every angle in one PNG, ready for your game engine.</p>
              </article>
              <article className="card feature">
                <h3>Animated GIFs</h3>
                <div className="feature-art">
                  <Sprite art={art.oak} scale={6} />
                </div>
                <p>Export animations and turntables to share anywhere.</p>
              </article>
              <article className="card feature">
                <h3>MagicaVoxel and OBJ</h3>
                <div className="feature-art">
                  <Sprite art={art.tree} scale={1} />
                </div>
                <p>Open and save .vox, export OBJ for Blender, Unity and Godot.</p>
              </article>
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
              <Sprite art={art.coin} scale={4} />
              <Sprite art={art.slime} scale={4} />
              <Sprite art={art.oak} scale={4} />
            </div>
            <Headline lead="Start drawing" rest="your ideas today." />
            <p className="lead-text">Draw with agents, refine every pixel, and ship it straight to your game.</p>
            <div className="row-buttons center">
              <a className="button primary large" href="/downloads/mac">
                Download for macOS
              </a>
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
