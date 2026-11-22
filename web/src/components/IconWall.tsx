"use client";

import Link from "next/link";
import { useState } from "react";
import { trackEvent } from "@/lib/consent";
import PixelIcon from "@/components/PixelIcon";
import type { Paths } from "@/lib/pixel-icon-render";

/** Colour sets the wall can switch between: the set's own look first, then a few the customizer can make. */
const THEMES = [
  { name: "Classic", stroke: "#ffffff", outline: "#000000", shadow: "#4b4b55" },
  { name: "Ember", stroke: "#ff4a1c", outline: "#1a0702", shadow: "#6b1f0c" },
  { name: "Gold", stroke: "#ffc425", outline: "#1f1400", shadow: "#6e4f00" },
  { name: "Mint", stroke: "#3ddc84", outline: "#03200f", shadow: "#145c34" },
  { name: "Sky", stroke: "#4cc9f0", outline: "#021a24", shadow: "#17546a" },
  { name: "Ink", stroke: "#111111", outline: "#f4f4f4", shadow: "#8a8a8a" },
];

/** The landing page's grid of icons, recoloured live by the swatches above it. Each icon opens in the library. */
export default function IconWall({ icons }: { icons: [name: string, paths: Paths][] }) {
  const [theme, setTheme] = useState(0);
  const t = THEMES[theme];
  return (
    <div
      className="iw"
      style={{ "--pi-stroke": t.stroke, "--pi-outline": t.outline, "--pi-shadow": t.shadow } as React.CSSProperties}
    >
      <div className="iw-themes" role="group" aria-label="Icon colours">
        {THEMES.map((th, i) => (
          <button
            key={th.name}
            type="button"
            aria-pressed={i === theme}
            onClick={() => {
              if (i !== theme) trackEvent("icons_theme_change", { theme: th.name.toLowerCase() });
              setTheme(i);
            }}
            style={{ "--sw": th.stroke, "--sw-edge": th.outline } as React.CSSProperties}
          >
            <span className="iw-dot" aria-hidden="true" />
            {th.name}
          </button>
        ))}
      </div>
      <ul className="iw-grid">
        {icons.map(([name, paths]) => (
          <li key={name}>
            <Link
              href={`/icons/library?icon=${name}`}
              aria-label={`${name} icon`}
              title={name}
              data-event="icons_icon_click"
              data-event-icon-name={name}
              data-event-location="wall"
            >
              <PixelIcon paths={paths} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
