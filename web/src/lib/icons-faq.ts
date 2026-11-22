import { ICON_CATEGORIES, ICON_COUNT, LUCIDE_VERSION } from "@/lib/pixel-icons";
import type { Faq } from "@/lib/faq";

const count = ICON_COUNT.toLocaleString("en-US");

/**
 * Questions people search for about pixel icons, answered on /icons. The same text feeds the page and its FAQPage
 * structured data, so they never disagree. Plain text only (the structured data can't carry markup).
 */
export const ICONS_FAQ: Faq[] = [
  {
    q: "Are these pixel icons free?",
    a: `Yes. All ${count} pixel icons are free to download and use in personal and commercial projects: games, apps, websites, videos and print. The set is MIT-licensed: keep its LICENSE.txt with the icons (it comes with every download of several icons). No sign-up, and no attribution on screen is required.`,
  },
  {
    q: "Can I use the pixel art icons in a game?",
    a: "Yes. They work well for game UI: inventories, menus, HUDs, buttons and map markers. Download PNGs at 32, 64, 128 or 256 pixels for Unity, Godot, GameMaker or Phaser, and turn off texture filtering (use nearest-neighbour or point sampling) so the pixels stay sharp.",
  },
  {
    q: "Which formats can I download?",
    a: "Each icon can be copied as SVG, JSX (a React component) or a PNG image, and downloaded as SVG, PNG or an OpenPixel file you can edit. The whole set is also one zip with every icon as PNG and SVG plus the OpenPixel source files, and the library zips any search or category as SVG or PNG.",
  },
  {
    q: "What size are the icons?",
    a: "Every icon is drawn on a 32×32 pixel grid with a 2px stroke, a 1px border and a 1px drop shadow. Scale them by whole numbers (64, 96, 128, up to 256 pixels) so each pixel stays square; the SVGs are made of whole pixels and stay crisp at any size.",
  },
  {
    q: "How do I change the colour of a pixel icon?",
    a: "Open the icon library and use the customizer: pick the primary colour, the border colour and the shadow colour, or switch the border and the shadow off. Every icon on the page updates at once, and whatever you copy or download uses your colours and size.",
  },
  {
    q: "How do I use a pixel icon in HTML, CSS or React?",
    a: "Copy the SVG and paste it into your HTML, or copy the JSX for a ready React component. For PNGs, set image-rendering: pixelated in CSS when you show them larger than their file size, so the browser doesn't blur the pixels.",
  },
  {
    q: "Can I edit the icons or draw my own pixel icons?",
    a: "Yes. Download an icon as an .openpixel file and open it in OpenPixel, the free pixel art editor for Mac, Windows and Linux. Change any pixel by hand, or ask an AI agent such as Claude, Codex or Cursor to draw a matching icon your set is still missing.",
  },
  {
    q: "How are the icons sorted?",
    a: `Into ${ICON_CATEGORIES.length} categories, from arrows, account and animals to text, time, travel and weather. Many icons are in more than one. Search finds icons by name and by related words: "home" finds house, "bin" finds trash.`,
  },
  {
    q: "Where do the icons come from?",
    a: `They are every icon of Lucide ${LUCIDE_VERSION}, the open-source icon library, redrawn as pixel art in OpenPixel. Each Lucide outline was turned into a clean 2px pixel stroke on a 32×32 grid, then given a border and a drop shadow.`,
  },
];
