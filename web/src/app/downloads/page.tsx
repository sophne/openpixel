import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import AiIcon from "@/components/AiIcon";
import OsChoice from "@/components/OsChoice";
import Sprite from "@/components/Sprite";
import { Footer, Header } from "@/components/Chrome";
import { MAC_CURSOR_LINK, MAC_MCP_JSON, MCP_PROGRAM, mcpCommand } from "@/lib/agents";
import { art } from "@/lib/art";
import { NOTARIZED, REPO_URL, formatDate, formatSize, hasFile, latestRelease, type Release } from "@/lib/github";
import { FILES, PLATFORMS, osChoiceScript, routeOf, type DownloadFile, type Os, type Platform } from "@/lib/platforms";

export const revalidate = 600;

export const metadata: Metadata = pageMeta({
  path: "/downloads",
  title: "Download OpenPixel for Mac, Windows and Linux",
  description:
    "Download OpenPixel for macOS, Windows or Linux, free, and connect Claude, Codex, Cursor or any MCP agent to it.",
});

function SectionHead({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="dl-head">
      <div className="dl-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function Row({ label, note, children }: { label: React.ReactNode; note?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="dl-row">
      <div className="dl-row-text">
        <h4>{label}</h4>
        {note ? <p>{note}</p> : null}
      </div>
      {children ? <div className="dl-row-actions">{children}</div> : null}
    </div>
  );
}

/** A command in a box with a Copy button. `show` is what the box displays in place of a long command. */
function Code({ text, show }: { text: string; show?: string }) {
  return (
    <div className="dl-code">
      <span aria-hidden="true">$</span>
      <code title={text}>{show ?? text}</code>
      <CopyButton text={text} />
    </div>
  );
}

/** One file of a system: its name, what it is, its size, and its link, or when it comes. */
function FileRow({ f, release, main }: { f: DownloadFile; release: Release | null; main: boolean }) {
  const there = hasFile(release, f);
  const size = formatSize(release?.assets[f.file]);
  return (
    <Row label={f.file} note={[f.kind, size].filter(Boolean).join(" · ")}>
      {there === false ? (
        <span className="dl-soon">Coming with the next release</span>
      ) : (
        <a className={main ? "pill dl-main" : "pill"} href={routeOf(f)} data-download={`downloads-${f.id}`} aria-label={`Download ${f.file}`}>
          Download
        </a>
      )}
    </Row>
  );
}

/**
 * What each system needs, how it updates, and what to expect the first time the app is opened. While a system's
 * files are still to come (`soon`), only what it needs: the rest would describe something nobody can download yet.
 */
function Notes({ os, soon }: { os: Os; soon: boolean }) {
  if (soon) return <p className="dl-foot">Requires {PLATFORMS.find((p) => p.os === os)!.requires}.</p>;
  if (os === "mac")
    return (
      <>
        <p className="dl-foot">
          Requires macOS 12 or later. One universal app for Apple silicon and Intel.{" "}
          {NOTARIZED
            ? "Updates install from inside the app."
            : "When a new version is out, the app's Update button brings you back to this page."}
        </p>
        {NOTARIZED ? null : (
          <p className="dl-foot dl-first-launch">
            <strong>First launch:</strong> OpenPixel isn&apos;t notarized by Apple yet, so macOS asks you to confirm it
            once. Open the app, then go to <strong>System Settings → Privacy &amp; Security</strong> and click{" "}
            <strong>Open Anyway</strong>.
          </p>
        )}
      </>
    );
  if (os === "windows")
    return (
      <>
        <p className="dl-foot">
          Requires Windows 10 or later, 64-bit. Installs for your user account, no administrator needed. Updates
          install from inside the app.
        </p>
        <p className="dl-foot dl-first-launch">
          <strong>First launch:</strong> the installer isn&apos;t code-signed yet, so Windows SmartScreen may stop it.
          Click <strong>More info</strong>, then <strong>Run anyway</strong>.
        </p>
      </>
    );
  return (
    <>
      <p className="dl-foot">
        Requires 64-bit Linux (x64). The AppImage updates itself; with the .deb, the app&apos;s Update button brings
        you back to this page.
      </p>
      <div className="dl-foot dl-first-launch">
        <p>
          <strong>First launch:</strong> make the AppImage executable, then open it. Or install the .deb with apt.
        </p>
        <Code text="chmod +x OpenPixel.AppImage" />
        <Code text="sudo apt install ./openpixel.deb" />
      </div>
    </>
  );
}

/** One system's card: its files and notes. The stylesheet moves the visitor's own system to the top and marks it. */
function PlatformCard({ p, release }: { p: Platform; release: Release | null }) {
  const files = FILES.filter((f) => f.os === p.os);
  const any = files.some((f) => hasFile(release, f));
  const soon = files.every((f) => hasFile(release, f) === false);
  return (
    <div className="dl-card dl-os" id={p.os} data-os-card={p.os}>
      <div className="dl-card-title">
        <h3>
          {p.name}
          <span className="dl-yours">Your system</span>
        </h3>
        {release && any ? (
          <span>
            Version {release.version}, {formatDate(release.date)}
          </span>
        ) : null}
      </div>
      {files.map((f, i) => (
        <FileRow key={f.id} f={f} release={release} main={i === 0} />
      ))}
      <Notes os={p.os} soon={soon} />
    </div>
  );
}

/** How to connect each agent on one system. The radio buttons above choose which system's panel shows. */
function AgentPanel({ p }: { p: Platform }) {
  const run = mcpCommand(p.os);
  return (
    <div data-agent-os={p.os}>
      <Code text={run} />
      <Row label="Claude Code">
        <CopyButton text={`claude mcp add --scope user openpixel -- ${run}`} label="Copy command" />
      </Row>
      <Row label="Codex">
        <CopyButton text={`codex mcp add openpixel -- ${run}`} label="Copy command" />
      </Row>
      {p.os === "mac" ? (
        <>
          <Row label="Cursor">
            <a className="pill" href={MAC_CURSOR_LINK}>
              Add to Cursor
            </a>
          </Row>
          <Row label="Claude" note="Paste into Settings → Developer → Edit Config.">
            <CopyButton text={MAC_MCP_JSON} label="Copy config" />
          </Row>
        </>
      ) : (
        <Row
          label="Cursor, Claude and other apps with a settings file"
          note="Open the Agents page in OpenPixel: it has the config with the full path on your computer."
        />
      )}
      <Row label="OpenClaw, Hermes and others" note="Any MCP client: run the command at the top of this card." />
      <p className="dl-foot">
        {p.os === "mac"
          ? "The Agents page in the app shows who is connected and sets each one up for you."
          : p.os === "windows"
            ? "Written for Command Prompt, where %LOCALAPPDATA% is your own app folder. The Agents page in the app shows the exact command for your computer."
            : "The app puts the program there when it starts, so open OpenPixel once first. The Agents page in the app shows the exact command for your computer."}
      </p>
    </div>
  );
}

export default async function Download() {
  const release = await latestRelease();

  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Downloads", "/downloads"]])} />
      <main className="downloads wrap">
        <h1 className="sr-only">Download OpenPixel for Mac, Windows and Linux</h1>
        <div className="dl-grid">
          {/* Left: the app */}
          <div className="dl-col">
            <section className="dl-systems">
              <SectionHead
                icon={<Image src="/dock/openpixel.png" alt="" width={128} height={128} unoptimized />}
                title="Desktop app"
                text="The full pixel and voxel editor, for Mac, Windows and Linux."
              />
              {PLATFORMS.map((p) => (
                <PlatformCard key={p.os} p={p} release={release} />
              ))}
              <div className="dl-card">
                <div className="dl-card-title">
                  <h3>Build from source</h3>
                </div>
                <Code text={`git clone ${REPO_URL}.git`} />
                <p className="dl-foot">
                  The README has the build steps for each system. Needs Node.js and Rust. MIT licensed.
                </p>
              </div>
            </section>

            <section>
              <SectionHead
                icon={<Sprite art={art.chest} scale={1.25} />}
                title="Releases"
                text="Every version and its notes, on GitHub."
              />
              <div className="dl-card">
                <Row label="What's new" note="Release notes for every version.">
                  <Link className="pill" href="/changelog">
                    Changelog
                  </Link>
                </Row>
                <Row label="All versions" note="Older builds and their release pages.">
                  <a className="pill" href={`${REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
                    Open GitHub
                  </a>
                </Row>
              </div>
            </section>
          </div>

          {/* Right: agents. One choice of system covers both sections below. */}
          <div className="dl-col dl-agents">
            <section id="agents">
              <SectionHead icon={<AiIcon />} title="Agents" text="Draw with your agent, right on your canvas." />
              <div className="dl-card">
                <div className="dl-card-title">
                  <h3 id="agents-os-title">Commands for</h3>
                  <div className="dl-seg" role="radiogroup" aria-labelledby="agents-os-title">
                    {PLATFORMS.map((p) => (
                      <label key={p.os}>
                        <input type="radio" name="agents-os" value={p.os} defaultChecked={p.os === "mac"} />
                        <span>{p.short}</span>
                      </label>
                    ))}
                  </div>
                  {/* Picks the visitor's system before first paint; OsChoice does it after a link inside the site. */}
                  <script dangerouslySetInnerHTML={{ __html: osChoiceScript("agents-os") }} />
                  <OsChoice name="agents-os" />
                </div>
                {PLATFORMS.map((p) => (
                  <AgentPanel key={p.os} p={p} />
                ))}
              </div>
            </section>

            <section>
              <SectionHead
                icon={<span className="dl-terminal">&gt;_</span>}
                title="Headless and HTTP"
                text="Pixel art from your terminal, scripts and CI."
              />
              <div className="dl-card">
                <div className="dl-card-title">
                  <h3>Run without a window</h3>
                </div>
                {PLATFORMS.map((p) => (
                  <div key={p.os} data-agent-os={p.os}>
                    <Code text={mcpCommand(p.os, "--mcp --headless")} show="openpixel --mcp --headless" />
                    <Row
                      label="ChatGPT and remote agents"
                      note={
                        <>
                          <code>--mcp-http 8765</code> serves MCP on this computer only. Add a tunnel for ChatGPT; files
                          stay in the OpenPixel folder in your Documents.
                        </>
                      }
                    >
                      <CopyButton text={mcpCommand(p.os, "--mcp-http 8765")} />
                    </Row>
                  </div>
                ))}
                <p className="dl-foot dl-agent-os-note">
                  These copy the command for{" "}
                  {PLATFORMS.map((p) => (
                    <span key={p.os} data-agent-os={p.os}>
                      {p.name}
                    </span>
                  ))}
                  , the system chosen under Agents above. The program is <code>{MCP_PROGRAM.mac.split("/").pop()}</code>{" "}
                  inside the installed app.
                </p>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
