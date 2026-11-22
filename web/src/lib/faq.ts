/**
 * The FAQ page (/faq): questions people search for about pixel art, sprite editors, voxel art and AI pixel art,
 * answered for OpenPixel. The same text feeds the page and its FAQPage structured data, so they never disagree.
 * Keep answers plain text (the structured data can't carry markup); `link` adds a "Read more" link on the page.
 */

export type Faq = { q: string; a: string; link?: { href: string; label: string } };
export type FaqGroup = { id: string; title: string; items: Faq[] };

export const FAQ: FaqGroup[] = [
  {
    id: "basics",
    title: "The basics",
    items: [
      {
        q: "What is OpenPixel?",
        a: "OpenPixel is a free pixel art and voxel editor for Mac, Windows and Linux. You draw sprites, animations and 3D voxel models by hand, or ask an AI agent such as Claude, Codex or Cursor to draw them with you. It has a built-in MCP server, so agents work on the same canvas you see, and you can refine every pixel they place.",
      },
      {
        q: "Is OpenPixel free?",
        a: "Yes. OpenPixel is free and open source under the MIT licence. There's no account, no subscription, no ads and no paid tier, and the source code is on GitHub.",
      },
      {
        q: "What is the best free pixel art editor for Mac, Windows or Linux?",
        a: "It depends on how you work. OpenPixel is a free desktop app for all three, with layers, frames, onion skin, palettes, voxel models and AI agents built in. Other free options include Pixelorama, Piskel and LibreSprite; Aseprite is a popular paid choice. Our comparison pages put them side by side.",
        link: { href: "/compare", label: "Compare pixel art editors" },
      },
      {
        q: "What are the system requirements?",
        a: "macOS 12 Monterey or later on Apple silicon or Intel, Windows 10 or later (64-bit), or 64-bit Linux (x64), as an AppImage or a .deb package.",
        link: { href: "/downloads", label: "Download OpenPixel" },
      },
      {
        q: "Is OpenPixel available for Windows or Linux?",
        a: "Yes. OpenPixel is one desktop app for macOS, Windows and Linux: a disk image for the Mac, an installer for Windows, and an AppImage or a .deb package for Linux. Files, tools and agents work the same on all three. There is no phone, tablet or browser version; the HTML exports open in any browser.",
        link: { href: "/downloads", label: "All downloads" },
      },
    ],
  },
  {
    id: "pixel-art",
    title: "Pixel art and sprites",
    items: [
      {
        q: "What size should pixel art sprites be?",
        a: "Most game sprites are 16×16, 32×32 or 64×64 pixels. Pick a size that matches your game's tile size and screen resolution, and draw at the final size rather than scaling down later. OpenPixel canvases go up to 256×256 pixels and export at any whole-number zoom, so pixels stay sharp.",
      },
      {
        q: "What is a sprite sheet, and how do I make one?",
        a: "A sprite sheet is one image that holds every frame of an animation (or every angle of a model) in a grid, so a game engine can load them all at once. In OpenPixel, draw your frames and export a sprite sheet: you get a PNG with every frame in order, ready for Unity, Godot, GameMaker or Phaser.",
      },
      {
        q: "How do I animate pixel art?",
        a: "Add frames, change a little on each one and set how long each frame shows. Onion skin shows the frames before and after while you draw the in-betweens, and you can press play to check the loop. A walk cycle usually takes 4 to 8 frames. Export the result as an animated GIF or a sprite sheet.",
      },
      {
        q: "Which colour palettes are included?",
        a: "OpenPixel includes classic pixel-art palettes such as DawnBringer, PICO-8 and Endesga, and you can make your own with up to 256 colours. Colour ramps build shades that shift in hue, and when you swap a palette every pixel follows.",
      },
      {
        q: "Can I import PNGs from Aseprite or other editors?",
        a: "Yes. Export PNGs or sprite sheets from Aseprite, Piskel, Pixelorama or any other editor and import them into OpenPixel, where they're snapped to your palette. Then keep drawing by hand or hand the sprite to an agent.",
      },
      {
        q: "Does OpenPixel have layers, mirror drawing and undo?",
        a: "Yes: layers you can stack, hide and merge, mirror drawing across X, Y or Z, and 500 steps of undo. You also get pencil, eraser, fill, line, rectangle, move, recolour and an eyedropper.",
      },
    ],
  },
  {
    id: "voxels",
    title: "Voxels and 3D",
    items: [
      {
        q: "What is voxel art?",
        a: "Voxel art is pixel art in three dimensions: models built from small cubes (voxels) instead of flat pixels. It's used for games like Minecraft-style worlds and for 3D models that render back to crisp isometric sprites.",
      },
      {
        q: "Can OpenPixel open MagicaVoxel .vox files?",
        a: "Yes. OpenPixel opens and saves MagicaVoxel .vox files, models and palettes as they are, up to 256 voxels a side. It works well as a MagicaVoxel alternative on Mac, Windows and Linux, with layers, frames and AI agents on top.",
        link: { href: "/compare/magicavoxel", label: "OpenPixel vs MagicaVoxel" },
      },
      {
        q: "How do I use voxel models in Unity, Godot or Blender?",
        a: "Export the model as OBJ to bring it into Blender, Unity or Godot, or keep the .vox file for engines and plugins that import MagicaVoxel models directly. If your game is 2D, render the model to sprites instead.",
      },
      {
        q: "Can I turn a 2D sprite into a 3D model?",
        a: "Yes. Make 3D gives any sprite depth in one click (or one tool call for an agent), turning it into a voxel model you can keep shaping.",
      },
      {
        q: "How do I make isometric pixel art from a 3D model?",
        a: "OpenPixel shows a live 2:1 isometric pixel-art preview of your voxel model while you build it. Export it as a PNG, as a turnaround in 8 angles, or as a sprite sheet of every angle for your game.",
      },
    ],
  },
  {
    id: "ai",
    title: "AI agents",
    items: [
      {
        q: "Can AI make pixel art?",
        a: "Yes, and in OpenPixel it makes real pixel art rather than a filtered image. Agents place pixels on an exact grid with a limited palette, review their work from every angle, and fix what looks off. You can edit every pixel afterwards, by hand or by asking again.",
      },
      {
        q: "Which AI agents work with OpenPixel?",
        a: "Claude, Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, opencode, Goose, Kiro, Cline, Hermes Agent and any other app that speaks MCP. ChatGPT can connect through MCP over HTTP.",
        link: { href: "/downloads#agents", label: "Set up an agent" },
      },
      {
        q: "What is Agent Chat, and do I need an API key?",
        a: "Agent Chat is a chat panel inside the editor. It runs the agents you already have, on the subscription you already pay for (for example a Claude or ChatGPT plan), so you don't need an API key. Pick the agent, model and effort, describe what you want and watch it draw.",
      },
      {
        q: "What is an MCP server, and why does a pixel editor have one?",
        a: "MCP (Model Context Protocol) is an open standard that lets AI agents use tools. OpenPixel's MCP server gives agents more than 60 tools: drawing pixels and voxels, colour ramps, layers and frames, reviewing a model from several angles, and every export. That's how an agent can draw, check and fix art instead of only generating an image.",
      },
      {
        q: "Is my art sent anywhere or used to train AI?",
        a: "OpenPixel has no account, analytics or tracking, and your files stay on your computer. When you use an agent, what it sees and sends to its provider is covered by that provider's terms, the same as when you use the agent anywhere else.",
        link: { href: "/legal/privacy", label: "Privacy" },
      },
      {
        q: "Can I run OpenPixel headless in scripts or CI?",
        a: "Yes. Start the openpixel program inside the app with --mcp --headless and it runs without a window, so agents and scripts can draw, review and export pixel art from a terminal or a CI job.",
      },
    ],
  },
  {
    id: "export",
    title: "Export and games",
    items: [
      {
        q: "Which formats can OpenPixel export?",
        a: "PNG, SVG, animated GIF, sprite sheets, a self-contained HTML page, MagicaVoxel .vox and OBJ. Exports scale by whole numbers, so pixel art stays sharp at any size.",
      },
      {
        q: "Can I use art made in OpenPixel in commercial games?",
        a: "Yes. Everything you make with OpenPixel belongs to you, and you can use it for any purpose, including games you sell.",
        link: { href: "/legal/terms", label: "Terms" },
      },
      {
        q: "Where can I find free pixel art to start from?",
        a: "The Explore page has characters, game assets, scenes and voxel models drawn in OpenPixel, free to download as PNG, GIF, HTML or MagicaVoxel .vox, with search by meaning.",
        link: { href: "/explore", label: "Explore pixel art" },
      },
    ],
  },
];

/** FAQPage structured data for search engines, from the same questions the page shows. */
export function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.flatMap((g) => g.items).map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
