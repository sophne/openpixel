"use client";

import { useState, type KeyboardEvent } from "react";
import Sprite from "@/components/Sprite";
import type { Art } from "@/lib/art";
import { featureArt as art } from "@/lib/feature-art";

/**
 * Tabs of examples under "Start from a sentence", drawn in the app's empty-state style like the rest of the site's
 * pixel art (web/scripts/make-feature-art.py). Sprites and voxel models are stills; only the Animation tab moves. Every picture is shown
 * at the same pixel size as the Sheets tab's frames (the coin's whole sheet as OpenPixel exports it, every frame side
 * by side), so the art reads as one set.
 */

type Item = { a: Art; label: string; frame?: number; still?: boolean };
type Tab = { id: string; label: string; items: Item[]; sheet?: Art };

const TABS: Tab[] = [
  {
    id: "sprites",
    label: "Sprites",
    items: [
      { a: art.chest, label: "Pixel-art treasure chest with an orange lock", still: true },
      { a: art.sword, label: "A sword with an orange guard", still: true },
      { a: art.person, label: "A person waving hello", still: true },
      { a: art.potion, label: "A round flask of orange potion", still: true },
      { a: art.appletree, label: "Apple tree with orange apples", still: true },
    ],
  },
  {
    id: "voxels",
    label: "Voxels",
    items: [
      { a: art.voxtree, label: "Voxel tree on a grass block", still: true },
      { a: art.house, label: "Voxel house with a stepped orange roof", still: true },
      { a: art.mushroom, label: "Voxel mushroom house", still: true },
      { a: art.crystal, label: "Orange voxel crystals on a rock", still: true },
      { a: art.chest3d, label: "The treasure chest as a voxel model", still: true },
    ],
  },
  {
    id: "animation",
    label: "Animation",
    items: [
      { a: art.slime, label: "Slime bouncing, 12 frames" },
      { a: art.heart, label: "Heart beating, 12 frames" },
      { a: art.coin, label: "Coin spinning, 8 frames" },
      { a: art.ghost, label: "Ghost floating, 12 frames" },
      { a: art.campfire, label: "Campfire flickering, 12 frames" },
    ],
  },
  {
    id: "sheets",
    label: "Sheets",
    items: [],
    sheet: art.coin,
  },
];

export default function Showcase() {
  const [tab, setTab] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === tab)!;
  // Tabs as the keyboard expects them: one stop in the Tab order, arrow keys (and Home/End) move between tabs.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length];
    setTab(t.id);
    document.getElementById(`tab-${t.id}`)?.focus();
  };
  return (
    <div className="showcase">
      <div className="seg" role="tablist" aria-label="What you can make" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="showcase-stage"
            tabIndex={t.id === tab ? 0 : -1}
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
                <Sprite art={it.a} fluid label={it.label} paused={it.still} frame={it.frame ?? 0} />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
