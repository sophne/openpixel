// Comparison pages: OpenPixel next to other pixel-art and voxel editors.
// Facts about other editors come from their own websites, stores and repositories. Keep CHECKED in step and be
// fair: list what they do better too.

export const CHECKED = "November 2026";

/** yes = supported, partial = limited or coming soon, no = unavailable. A note explains partial support. */
export type Cell = { v: "yes" | "partial" | "no"; note?: string };
export type Row = { feature: string; us: Cell; them: Cell };

/** The visuals the feature cards can show (drawn in the page from OpenPixel's own art). */
export type Visual = "import" | "palettes" | "make3d" | "animate" | "agent" | "vox" | "iso" | "voxagent";

/** Groups on the overview page. */
export type Kind = "desktop" | "web" | "voxel";
export const KINDS: { kind: Kind; title: string }[] = [
  { kind: "desktop", title: "Desktop apps" },
  { kind: "web", title: "Web apps" },
  { kind: "voxel", title: "Voxel editors" },
];

export type Competitor = {
  slug: string;
  name: string;
  kind: Kind;
  logo: string;
  /** Pixel-art logos are scaled with hard edges. */
  pixelLogo?: boolean;
  /** One line for the overview card. */
  card: string;
  tagline: string;
  intro: string;
  whySub: string;
  rows: Row[];
  bring: { title: string; sub: string; cards: { title: string; text: string; visual: Visual }[] };
  cta: { title: string; sub: string };
};

const y = (note?: string): Cell => ({ v: "yes", note });
const p = (note?: string): Cell => ({ v: "partial", note });
const n = (note?: string): Cell => ({ v: "no", note });

export const COMPETITORS: Competitor[] = [
  {
    slug: "aseprite",
    name: "Aseprite",
    kind: "desktop",
    logo: "/compare/aseprite.png",
    card: "Agents built in, voxels included, free.",
    tagline: "Pixel art with an agent at your side",
    intro:
      "Everything you draw sprites with, plus a built-in MCP server and real 3D. Free and open source, for Mac, Windows and Linux.",
    whySub: "Agents draw with you. Sprites turn 3D. And it costs nothing.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: p("Third-party tools") },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: y() },
      { feature: "Export MagicaVoxel .vox and OBJ", us: y(), them: n() },
      { feature: "Automate from scripts", us: y("MCP, headless mode"), them: y("Lua, command line") },
      { feature: "Read files as plain JSON", us: y(), them: p("Documented binary format") },
      { feature: "Use it on Mac, Windows and Linux", us: y(), them: y() },
      { feature: "Use it for free", us: y(), them: p("Paid, or compile it yourself") },
      { feature: "Open source licence", us: y("MIT"), them: p("Source available, EULA") },
      { feature: "Draw with tilemaps", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Aseprite sprites with you",
      sub: "Export PNGs or sprite sheets from Aseprite and import them. Keep drawing by hand or hand them to an agent.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Keep your palettes", text: "DawnBringer, PICO-8 and Endesga are built in, or bring your own colours.", visual: "palettes" },
        { title: "Take it to 3D", text: "Make 3D gives any sprite depth in one click or one tool call.", visual: "make3d" },
      ],
    },
    cta: { title: "Bring your sprites into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "pixelorama",
    name: "Pixelorama",
    kind: "desktop",
    logo: "/compare/pixelorama.png",
    pixelLogo: true,
    card: "Same freedom, with agents and voxels.",
    tagline: "A free pixel editor that agents can use",
    intro:
      "Like Pixelorama, OpenPixel is free, MIT licensed and runs on Mac, Windows and Linux. It adds a built-in MCP server and full voxel models.",
    whySub: "Free and open, like Pixelorama. Plus agents and real voxel models.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: p("3D shape layers") },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: y() },
      { feature: "Automate from scripts", us: y("MCP, headless mode"), them: p("Extensions") },
      { feature: "Use it on Mac, Windows and Linux", us: y(), them: y() },
      { feature: "Use it for free", us: y(), them: y() },
      { feature: "Open source licence", us: y("MIT"), them: y("MIT") },
      { feature: "Use it in a web browser", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Pixelorama work with you",
      sub: "Export PNGs or sprite sheets and import them. Your palettes and timing habits come along.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Animate the same way", text: "Layers, frames, onion skin and per-frame timing work the way you expect.", visual: "animate" },
        { title: "Hand it to an agent", text: "Ask Claude, Codex or Cursor to draw, review and fix it with you.", visual: "agent" },
      ],
    },
    cta: { title: "Bring your pixel art into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "magicavoxel",
    name: "MagicaVoxel",
    kind: "voxel",
    logo: "/compare/magicavoxel.png",
    pixelLogo: true,
    card: "Open your .vox files and add sprites.",
    tagline: "Voxels, sprites and agents in one app",
    intro:
      "Open your .vox models, draw 2D sprites next to them, and let an agent build with you. Free and open source, for Mac, Windows and Linux.",
    whySub: "Your .vox files open as they are. Sprites and agents come with them.",
    rows: [
      { feature: "Let AI agents build over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Open and save .vox files", us: y(), them: y() },
      { feature: "Export OBJ", us: y(), them: y() },
      { feature: "Draw 2D sprites and animations", us: y(), them: n() },
      { feature: "Render isometric pixel-art sprites", us: y("8-angle sprite sheets"), them: p("Path-traced renders") },
      { feature: "Read files as plain JSON", us: y(), them: n() },
      { feature: "Use it on Mac and Windows", us: y("And Linux"), them: y() },
      { feature: "Use it for free", us: y(), them: y() },
      { feature: "Open source licence", us: y("MIT"), them: n() },
      { feature: "Build scenes from many models", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your MagicaVoxel models with you",
      sub: "Open .vox files directly and save them back. Nothing is converted away.",
      cards: [
        { title: "Open .vox files", text: "Models and palettes open as they are, up to 256 voxels a side.", visual: "vox" },
        { title: "Render to sprites", text: "Turn any model into crisp isometric sprites and 8-angle sheets.", visual: "iso" },
        { title: "Let agents build", text: "Agents place voxels, spheres and cylinders, then review every angle.", visual: "voxagent" },
      ],
    },
    cta: { title: "Bring your voxel models into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  // ---------- More desktop apps

  {
    slug: "libresprite",
    name: "LibreSprite",
    kind: "desktop",
    logo: "/compare/libresprite.png",
    pixelLogo: true,
    card: "Free and open, with agents and voxels.",
    tagline: "Free sprite editing, with agents and 3D",
    intro:
      "LibreSprite carries on the last open-source version of Aseprite. OpenPixel is free and open source too, with a built-in MCP server and voxel models, on Mac, Windows and Linux.",
    whySub: "Open source like LibreSprite. Agents and voxels built in.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: y() },
      { feature: "Automate from scripts", us: y("MCP, headless mode"), them: y("Scripting API") },
      { feature: "Read files as plain JSON", us: y(), them: p("Documented binary format") },
      { feature: "Use it for free", us: y(), them: y() },
      { feature: "Open source licence", us: y("MIT"), them: y("GPL 2.0") },
      { feature: "Use it on Mac, Windows and Linux", us: y(), them: y() },
      { feature: "Use it on Android", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your LibreSprite sprites with you",
      sub: "Export PNGs or sprite sheets from LibreSprite and import them. Keep animating, or hand them to an agent.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Animate the same way", text: "Layers, frames, onion skin and per-frame timing work the way you expect.", visual: "animate" },
        { title: "Hand it to an agent", text: "Ask Claude, Codex or Cursor to draw, review and fix it with you.", visual: "agent" },
      ],
    },
    cta: { title: "Bring your sprites into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "pyxel-edit",
    name: "Pyxel Edit",
    kind: "desktop",
    logo: "/compare/pyxel-edit.png",
    card: "Free and open source, with agents.",
    tagline: "Sprites and 3D, with an agent at your side",
    intro:
      "Pyxel Edit is loved for its tileset tools and sold as a paid beta. OpenPixel is free and open source, for Mac, Windows and Linux, with voxel models and a built-in MCP server.",
    whySub: "Free and open, with agents and 3D voxels. Tilesets stay Pyxel Edit's strength.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: y() },
      { feature: "Use it on Mac and Windows", us: y("And Linux"), them: y("Adobe AIR") },
      { feature: "Use it for free", us: y(), them: p("Paid beta, older version free") },
      { feature: "Open source licence", us: y("MIT"), them: n() },
      { feature: "Draw tilesets with linked tiles", us: n(), them: y() },
      { feature: "Export tilemaps as JSON or XML", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Pyxel Edit art with you",
      sub: "Export PNGs or sprite sheets from Pyxel Edit and import them. Then animate, go 3D or hand them to an agent.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Animate the same way", text: "Frames, onion skin and per-frame timing work the way you expect.", visual: "animate" },
        { title: "Take it to 3D", text: "Make 3D gives any sprite depth in one click or one tool call.", visual: "make3d" },
      ],
    },
    cta: { title: "Bring your pixel art into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "pro-motion-ng",
    name: "Pro Motion NG",
    kind: "desktop",
    logo: "/compare/pro-motion.png",
    card: "On Mac and Linux too, free, with agents.",
    tagline: "Pixel art and animation on Mac, Windows and Linux",
    intro:
      "Pro Motion NG is a long-standing Windows studio for pixel art, animation and tilemaps. OpenPixel runs on Mac, Windows and Linux, is free and open source, and lets AI agents draw with you.",
    whySub: "On Mac and Linux too, free, and agents built in. Retro-hardware tools stay Pro Motion's strength.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets", us: y(), them: y() },
      { feature: "Use it on Mac and Linux", us: y(), them: n("Windows only") },
      { feature: "Use it for free", us: y(), them: p("Paid, or a limited free edition") },
      { feature: "Open source licence", us: y("MIT"), them: n() },
      { feature: "Draw with tilemaps", us: n(), them: y() },
      { feature: "Match the limits of retro consoles", us: n(), them: y() },
      { feature: "Draw with pen pressure", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Pro Motion art with you",
      sub: "Export PNGs or sprite sheets from Pro Motion NG and import them, on Windows, Mac or Linux.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Keep your palettes", text: "DawnBringer, PICO-8 and Endesga are built in, or bring your own colours.", visual: "palettes" },
        { title: "Animate the same way", text: "Layers, frames, onion skin and per-frame timing work the way you expect.", visual: "animate" },
      ],
    },
    cta: { title: "Bring your pixel art into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },

  // ---------- Web apps

  {
    slug: "piskel",
    name: "Piskel",
    kind: "web",
    logo: "/compare/piskel.png",
    pixelLogo: true,
    card: "A desktop app, with agents and voxels.",
    tagline: "From browser sprites to an agentic editor",
    intro:
      "Piskel is a handy free sprite editor in the browser. OpenPixel is free and open source too, and adds a built-in MCP server, voxel models and a desktop app for Mac, Windows and Linux.",
    whySub: "Free like Piskel. Plus agents, 3D voxels and a desktop app.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: y() },
      { feature: "Desktop app for Mac, Windows and Linux", us: y(), them: p("Browser, older desktop builds") },
      { feature: "Use it for free", us: y(), them: y() },
      { feature: "Open source licence", us: y("MIT"), them: y("Apache 2.0") },
      { feature: "Use it in a web browser", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Piskel sprites with you",
      sub: "Export PNGs or sprite sheets from Piskel and import them. Keep animating, or hand them to an agent.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Animate the same way", text: "Layers, frames, onion skin and per-frame timing work the way you expect.", visual: "animate" },
        { title: "Hand it to an agent", text: "Ask Claude, Codex or Cursor to draw, review and fix it with you.", visual: "agent" },
      ],
    },
    cta: { title: "Bring your sprites into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "pixilart",
    name: "Pixilart",
    kind: "web",
    logo: "/compare/pixilart.png",
    pixelLogo: true,
    card: "No ads, no account, agents built in.",
    tagline: "A pixel editor that works with your agents",
    intro:
      "Pixilart is a friendly browser editor with a big community. OpenPixel is a desktop app for Mac, Windows and Linux with a built-in MCP server and voxel models: free, open source, and your files stay on your computer.",
    whySub: "No ads, no account, no subscription. Agents and 3D included.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Turn a sprite into a 3D model", us: y(), them: n() },
      { feature: "Animate with layers, frames and onion skin", us: y(), them: y() },
      { feature: "Export animated GIFs", us: y(), them: y() },
      { feature: "Use it without ads", us: y(), them: p("Ad-free with Pro, $4.99 a month") },
      { feature: "Use it for free", us: y(), them: y("Optional Pro plan") },
      { feature: "Open source licence", us: y("MIT"), them: n() },
      { feature: "Share art in a community gallery", us: n(), them: y() },
      { feature: "Use it in a browser or on your phone", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Pixilart drawings with you",
      sub: "Download your art from Pixilart as PNGs and import them. Your palettes come along.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Keep your palettes", text: "DawnBringer, PICO-8 and Endesga are built in, or bring your own colours.", visual: "palettes" },
        { title: "Hand it to an agent", text: "Ask Claude, Codex or Cursor to draw, review and fix it with you.", visual: "agent" },
      ],
    },
    cta: { title: "Bring your pixel art into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "pixellab",
    name: "PixelLab",
    kind: "web",
    logo: "/compare/pixellab.png",
    card: "Your own agent, drawing on your computer.",
    tagline: "Your agent draws, pixel by pixel, on your computer",
    intro:
      "PixelLab generates pixel art with its own AI models in the cloud. OpenPixel is a free, open-source editor where the agent you already use draws, reviews and fixes art pixel by pixel on your Mac, Windows or Linux computer.",
    whySub: "Use the agent you already have. No credits, no subscription, and your files stay local.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: y("Through PixelLab's generator") },
      { feature: "Agents edit pixel by pixel, in plain view", us: y(), them: p("Agents request generated images") },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Edit by hand in a pixel editor", us: y(), them: y() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Work offline, with files on your computer", us: y(), them: n("Runs on cloud GPUs") },
      { feature: "Use it for free", us: y(), them: p("Free trial, then paid plans") },
      { feature: "Open source licence", us: y("MIT"), them: n() },
      { feature: "Generate art and animation from a prompt", us: p("Your agent draws it"), them: y() },
      { feature: "Rotate characters to 4 or 8 directions", us: p("Voxel models render 8 angles"), them: y() },
      { feature: "Use it in a web browser", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your PixelLab art with you",
      sub: "Export PNGs from PixelLab and import them. Then refine them by hand or with your own agent.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Refine with your agent", text: "Ask Claude, Codex or Cursor to review and fix it, pixel by pixel.", visual: "agent" },
        { title: "Take it to 3D", text: "Make 3D gives any sprite depth in one click or one tool call.", visual: "make3d" },
      ],
    },
    cta: { title: "Let your agent draw in OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
  {
    slug: "lospec-pixel-editor",
    name: "Lospec Pixel Editor",
    kind: "web",
    logo: "/compare/lospec.png",
    card: "Still growing, with animation and agents.",
    tagline: "Keep drawing after the Lospec editor",
    intro:
      "The Lospec Pixel Editor is no longer developed. OpenPixel is a free, open-source pixel editor for Mac, Windows and Linux that keeps growing, with classic palettes, animation, voxels and a built-in MCP server.",
    whySub: "Still developed, still free. Animation, voxels and agents on top.",
    rows: [
      { feature: "Let AI agents draw over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Draw with classic palettes", us: y("PICO-8, DawnBringer, Endesga"), them: y() },
      { feature: "Animate with frames and onion skin", us: y(), them: n() },
      { feature: "Export sprite sheets and GIFs", us: y(), them: n() },
      { feature: "Model in 3D voxels", us: y(), them: n() },
      { feature: "Actively developed", us: y(), them: n("No longer developed") },
      { feature: "Use it for free", us: y(), them: y() },
      { feature: "Open source licence", us: y("MIT"), them: y("GPL 3.0") },
      { feature: "Use it on Mac, Windows and Linux", us: y("Desktop app"), them: y("In the browser") },
      { feature: "Use it in a web browser", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Lospec art with you",
      sub: "Save your drawings as PNGs and import them. Your favourite palettes are already here.",
      cards: [
        { title: "Import your PNGs", text: "Turn any PNG into a sprite or a voxel slice, snapped to your palette.", visual: "import" },
        { title: "Keep your palettes", text: "DawnBringer, PICO-8 and Endesga are built in, or bring your own colours.", visual: "palettes" },
        { title: "Start animating", text: "Layers, frames, onion skin and per-frame timing, ready when you are.", visual: "animate" },
      ],
    },
    cta: { title: "Keep drawing in OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },

  // ---------- More voxel editors

  {
    slug: "goxel",
    name: "Goxel",
    kind: "voxel",
    logo: "/compare/goxel.png",
    card: "Voxels and sprites, with agents built in.",
    tagline: "Voxels, sprites and agents in one app",
    intro:
      "Goxel is a capable open-source voxel editor. OpenPixel opens and saves the same .vox files, adds 2D sprites and isometric renders, and lets AI agents build with you.",
    whySub: "Your .vox files open as they are. Sprites and agents come with them.",
    rows: [
      { feature: "Let AI agents build over MCP", us: y(), them: n() },
      { feature: "Watch agent edits live and undo them", us: y(), them: n() },
      { feature: "Open and save MagicaVoxel .vox", us: y(), them: y() },
      { feature: "Export OBJ", us: y(), them: y() },
      { feature: "Draw 2D sprites and animations", us: y(), them: n() },
      { feature: "Render isometric pixel-art sprites", us: y("8-angle sprite sheets"), them: p("PNG renders") },
      { feature: "Read files as plain JSON", us: y(), them: n() },
      { feature: "Use it for free", us: y(), them: y("On desktop") },
      { feature: "Open source licence", us: y("MIT"), them: y("GPL 3.0") },
      { feature: "Build scenes of any size", us: p("Up to 256 voxels a side"), them: y() },
      { feature: "Ray-traced renders", us: n(), them: y() },
      { feature: "Use it on Mac, Windows and Linux", us: y(), them: y() },
      { feature: "Use it on phones", us: n(), them: y() },
    ],
    bring: {
      title: "Bring your Goxel models with you",
      sub: "Export .vox from Goxel and open it here. Then render sprites or let an agent keep building.",
      cards: [
        { title: "Open .vox files", text: "Models and palettes open as they are, up to 256 voxels a side.", visual: "vox" },
        { title: "Render to sprites", text: "Turn any model into crisp isometric sprites and 8-angle sheets.", visual: "iso" },
        { title: "Let agents build", text: "Agents place voxels, spheres and cylinders, then review every angle.", visual: "voxagent" },
      ],
    },
    cta: { title: "Bring your voxel models into OpenPixel", sub: "Download OpenPixel for Mac, Windows or Linux. Free and open source, with agents built in." },
  },
];

export const bySlug = (slug: string) => COMPETITORS.find((c) => c.slug === slug);
