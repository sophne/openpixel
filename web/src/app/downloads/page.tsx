import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";
import Image from "next/image";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import AiIcon from "@/components/AiIcon";
import Sprite from "@/components/Sprite";
import { Footer, Header } from "@/components/Chrome";
import { CURSOR_LINK, EXE } from "@/lib/agents";
import { art } from "@/lib/art";
import { NOTARIZED, REPO_URL, formatDate, formatSize, latestRelease } from "@/lib/github";

export const revalidate = 600;

export const metadata: Metadata = pageMeta({
  path: "/downloads",
  title: "Download OpenPixel for Mac",
  description: "Download OpenPixel for macOS, free, and connect Claude, Codex, Cursor or any MCP agent to it.",
});

const MCP_JSON = JSON.stringify({ mcpServers: { openpixel: { command: EXE, args: ["--mcp"] } } }, null, 2);

function SectionHead({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="dl-head">
      <div className="dl-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function Row({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="dl-row">
      <div className="dl-row-text">
        <h4>{label}</h4>
        {note ? <p>{note}</p> : null}
      </div>
      <div className="dl-row-actions">{children}</div>
    </div>
  );
}

export default async function Download() {
  const release = await latestRelease();
  const size = formatSize(release?.dmgSize);
  const version = release
    ? [`Version ${release.version}`, formatDate(release.date), size].filter(Boolean).join(", ")
    : null;

  return (
    <>
      <Header />
      <JsonLd data={breadcrumbJsonLd([["Downloads", "/downloads"]])} />
      <main className="downloads wrap">
        <h1 className="sr-only">Download OpenPixel for Mac</h1>
        <div className="dl-grid">
          {/* Left: the app */}
          <div className="dl-col">
            <section>
              <SectionHead
                icon={<Image src="/dock/openpixel.png" alt="" width={128} height={128} unoptimized />}
                title="Desktop app"
                text="The full pixel and voxel editor, native on your Mac."
              />
              <div className="dl-card">
                <div className="dl-card-title">
                  <h3>macOS</h3>
                  {version ? <span>{version}</span> : null}
                </div>
                <Row label="For Apple silicon Macs">
                  <a className="pill" href="/downloads/mac" data-download="downloads-apple-silicon">
                    Download
                  </a>
                </Row>
                <Row label="For Intel Macs">
                  <a className="pill" href="/downloads/mac" data-download="downloads-intel">
                    Download
                  </a>
                </Row>
                <p className="dl-foot">
                  One universal app for both. Requires macOS 13 or later. Updates install from inside the app.
                </p>
                {NOTARIZED ? null : (
                  <p className="dl-foot dl-first-launch">
                    <strong>First launch:</strong> OpenPixel isn&apos;t notarized by Apple yet, so macOS asks you to
                    confirm it once. Open the app, then go to <strong>System Settings → Privacy &amp; Security</strong>{" "}
                    and click <strong>Open Anyway</strong>.
                  </p>
                )}
              </div>
              <div className="dl-card">
                <div className="dl-card-title">
                  <h3>Build from source</h3>
                </div>
                <div className="dl-code">
                  <span aria-hidden="true">$</span>
                  <code>git clone {REPO_URL}.git && cd openpixel/app && make</code>
                  <CopyButton text={`git clone ${REPO_URL}.git && cd openpixel/app && make`} />
                </div>
                <p className="dl-foot">Needs the Xcode command line tools. MIT licensed.</p>
              </div>
            </section>

            <section>
              <SectionHead
                icon={<Sprite art={art.chest} scale={1.25} />}
                title="Releases"
                text={
                  NOTARIZED
                    ? "Every version, signed, notarized and on GitHub."
                    : "Every version and its notes, on GitHub."
                }
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

          {/* Right: agents */}
          <div className="dl-col">
            <section id="agents">
              <SectionHead icon={<AiIcon />} title="Agents" text="Draw with your agent, right on your canvas." />
              <div className="dl-card">
                <Row label="Claude Code">
                  <CopyButton text={`claude mcp add --scope user openpixel -- ${EXE} --mcp`} label="Copy command" />
                </Row>
                <Row label="Codex">
                  <CopyButton text={`codex mcp add openpixel -- ${EXE} --mcp`} label="Copy command" />
                </Row>
                <Row label="Cursor">
                  <a className="pill" href={CURSOR_LINK}>
                    Add to Cursor
                  </a>
                </Row>
                <Row label="Claude" note="Paste into Settings → Developer → Edit Config.">
                  <CopyButton text={MCP_JSON} label="Copy config" />
                </Row>
                <Row label="OpenClaw, Hermes and others" note="Any MCP client: run this command.">
                  <CopyButton text={`${EXE} --mcp`} label="Copy command" />
                </Row>
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
                <div className="dl-code">
                  <span aria-hidden="true">$</span>
                  <code>OpenPixel --mcp --headless</code>
                  <CopyButton text={`${EXE} --mcp --headless`} />
                </div>
                <Row
                  label="ChatGPT and remote agents"
                  note={
                    <>
                      <code>--mcp-http 8765</code> serves MCP on this Mac only. Add a tunnel for ChatGPT; files stay in
                      ~/Documents/OpenPixel.
                    </>
                  }
                >
                  <CopyButton text={`${EXE} --mcp-http 8765`} />
                </Row>
              </div>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
