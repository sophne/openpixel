"use client";

import { useState, type CSSProperties } from "react";
import Sprite from "@/components/Sprite";
import { art, type Art } from "@/lib/art";

/**
 * Tabs of examples under "Start from a sentence". Sprites and voxel models are stills (voxel models at their
 * isometric angle, frame 1 of the 8-angle turnaround); only the Animation tab moves. Every example sits in an
 * equal square and is sized by what's drawn, so a 16-pixel coin and a voxel house look the same size. Sprite
 * sheets shows the coin's whole sheet as OpenPixel exports it, every frame side by side.
 */

type Item = { a: Art; label: string; frame?: number; still?: boolean };
type Tab = { id: string; label: string; items: Item[]; sheet?: Art };

const TABS: Tab[] = [
  {
    id: "sprites",
    label: "Sprites",
    items: [
      { a: art.chest, label: "Pixel-art treasure chest", still: true },
      { a: art.human, label: "A person waving hello", still: true },
      { a: art.oak, label: "Apple tree", still: true },
    ],
  },
  {
    id: "voxels",
    label: "Voxel models",
    items: [
      { a: art.tree, label: "Voxel tree on a grass island", still: true, frame: 1 },
      { a: art.mushroom, label: "Voxel mushroom house", still: true, frame: 1 },
      { a: art.chest3d, label: "The treasure chest as a voxel model", still: true, frame: 1 },
    ],
  },
  {
    id: "animation",
    label: "Animation",
    items: [
      { a: art.slime, label: "Slime bouncing, 6 frames" },
      { a: art.coin, label: "Coin spinning, 8 frames" },
      { a: art.campfire, label: "Campfire flickering, 4 frames" },
    ],
  },
  {
    id: "sheets",
    label: "Sprite sheets",
    items: [],
    sheet: art.coin,
  },
];

/** How much of its square an example fills: the longer side of what's drawn spans this share of the square. */
const FILL = 0.86;

/**
 * Places a picture so that what's drawn (ignoring empty canvas around it) fills the same share of the square for
 * every example, centred. Percentages of the square, so it scales with the page.
 */
function fit(a: Art, still: boolean, frame: number): CSSProperties {
  // A still is measured by the frame it shows; an animation by all its frames, so nothing leaves the square.
  const [x, y, w, h] = (still && a.boxes?.[frame]) || a.box;
  const k = FILL / Math.max(w, h); // squares per pixel
  const pct = (v: number) => `${v * 100}%`;
  return { width: pct(a.w * k), left: pct(0.5 - (x + w / 2) * k), top: pct(0.5 - (y + h / 2) * k) };
}

export default function Showcase() {
  const [tab, setTab] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="showcase">
      <div className="seg" role="tablist" aria-label="What you can make">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="showcase-stage"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="stage" id="showcase-stage" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {current.sheet ? (
          <div className="stage-sheet" key={tab}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a pixel-art strip shown at its exact proportions */}
            <img
              className="pixel"
              src={current.sheet.src}
              alt={`Sprite sheet: all ${current.sheet.frames} frames of the spinning coin in one row`}
              width={current.sheet.w * current.sheet.frames}
              height={current.sheet.h}
            />
          </div>
        ) : (
          <div className="stage-row" key={tab}>
            {current.items.map((it) => (
              <span key={it.label} className="stage-item">
                <span className="stage-fit" style={fit(it.a, !!it.still, it.frame ?? 0)}>
                  <Sprite art={it.a} fluid label={it.label} paused={it.still} frame={it.frame ?? 0} />
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
