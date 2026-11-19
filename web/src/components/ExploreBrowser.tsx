"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import DownloadMenu from "@/components/DownloadMenu";
import Sprite from "@/components/Sprite";
import type { Art } from "@/lib/art";
import type { ExploreCollection, ExploreFormat, ExploreItem } from "@/lib/explore";
import { cosine, loadEncoder, type Encoder } from "@/lib/semantic";

/** The formats in the Download menu, named as in the app's Export menu. */
const FORMATS: { id: ExploreFormat; label: (item: ExploreItem) => string }[] = [
  { id: "png", label: (item) => (item.kind === "animation" ? "Sprite sheet" : "PNG picture") },
  { id: "gif", label: (item) => (item.kind === "voxel" ? "Turntable GIF" : "Animated GIF") },
  { id: "html", label: () => "HTML page" },
  { id: "vox", label: () => "MagicaVoxel .vox" },
];

/** The art area of a card, in CSS pixels: pictures are shown at the largest whole-number zoom that fits it. */
const BOX = { small: [208, 176], wide: [520, 292] } as const;

function zoomed(item: ExploreItem, box: readonly [number, number]) {
  const pw = item.w / item.scale;
  const ph = item.h / item.scale;
  const k = Math.max(1, Math.floor(Math.min(box[0] / pw, box[1] / ph)));
  return { width: Math.round(pw * k), height: Math.round(ph * k) };
}

function Card({ item, wide }: { item: ExploreItem; wide: boolean }) {
  const size = zoomed(item, wide ? BOX.wide : BOX.small);
  const what = item.kind === "voxel" ? "3D voxel model" : item.kind === "animation" ? "animation" : "sprite";
  return (
    <article className="x-card" id={item.slug}>
      <a
        className="x-art"
        href={item.downloads.html}
        target="_blank"
        rel="noopener"
        aria-label={`Open ${item.title} (${what}) in a new tab`}
      >
        <Image
          className="pixel"
          src={item.src}
          alt={`${item.title}, pixel-art ${what}`}
          width={size.width}
          height={size.height}
          unoptimized
        />
      </a>
      <div className="x-foot">
        <h3>{item.title}</h3>
        <DownloadMenu
          title={item.title}
          options={FORMATS.filter((f) => item.downloads[f.id]).map((f) => ({
            label: f.label(item),
            href: item.downloads[f.id]!,
            file: `${item.slug}.${f.id}`,
          }))}
        />
      </div>
    </article>
  );
}

const SINGULAR = { characters: "character", scenes: "scene", assets: "game asset" } as const;

const FORM = { sprite: "pixel art sprite", animation: "animated pixel art", voxel: "3D voxel model" } as const;

const describe = (item: ExploreItem) =>
  `${item.title}. ${item.keywords}. ${FORM[item.kind]}, ${SINGULAR[item.collection]}`;

const tokens = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/** Share of the query's words that begin a word of the item: catches half-typed words the model can't read yet. */
function lexical(query: string[], item: ExploreItem) {
  if (query.length === 0) return 0;
  const words = tokens(`${describe(item)} ${item.slug}`);
  return query.filter((q) => words.some((w) => w.startsWith(q))).length / query.length;
}

/** The "nothing found" slime sweeping a magnifying glass, drawn by web/scripts/explore/search_buddy.py. */
const SEARCHER: Art = { src: "/explore/search/buddy.png", w: 32, h: 32, frames: 6, ms: 160, axis: "x", box: [4, 11, 24, 18] };

/** Below this similarity, and below half of the best match's score, an item doesn't count as a match. */
const FLOOR = 0.22;

export default function ExploreBrowser({ collections }: { collections: ExploreCollection[] }) {
  const [query, setQuery] = useState("");
  const [encoder, setEncoder] = useState<Encoder | null>(null);
  const all = useMemo(() => collections.flatMap((c) => c.items), [collections]);

  // The model loads when someone shows interest in searching, not with the page.
  const warm = () => {
    // The encoder is a function, so it's wrapped: React would call a bare function as a state updater.
    if (!encoder) loadEncoder().then((enc) => setEncoder(() => enc), () => {});
  };

  const vectors = useMemo(
    () => (encoder ? new Map(all.map((item) => [item.slug, encoder(describe(item))])) : null),
    [encoder, all],
  );

  const scores = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const words = tokens(q);
    const qv = encoder?.(q) ?? null;
    const raw = new Map<string, number>();
    for (const item of all) {
      const lex = lexical(words, item);
      const iv = vectors?.get(item.slug);
      // Without the model (still loading, or it failed), only items whose words begin with every query word match.
      const score = qv && iv ? cosine(qv, iv) + 0.35 * lex : lex === 1 ? 1 : 0;
      raw.set(item.slug, score);
    }
    const best = Math.max(0, ...raw.values());
    const cut = Math.max(FLOOR, best * 0.5);
    return new Map([...raw].filter(([, s]) => s >= cut));
  }, [query, encoder, vectors, all]);

  useEffect(() => {
    if (query) warm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const shown = collections
    .map((c) => ({
      ...c,
      items: scores
        ? c.items.filter((i) => scores.has(i.slug)).sort((a, b) => scores.get(b.slug)! - scores.get(a.slug)!)
        : c.items,
    }))
    .filter((c) => c.items.length > 0);

  return (
    <>
      <div className="x-bar wrap">
        <nav className="x-tabs" aria-label="Collections">
          {shown.map((c) => (
            <a key={c.id} href={`#${c.id}`}>
              {c.title}
              <span>{c.items.length}</span>
            </a>
          ))}
        </nav>
        <label className="x-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21 21-4.34-4.34" />
            <circle cx="11" cy="11" r="8" />
          </svg>
          <input
            type="search"
            placeholder="Search"
            aria-label="Search pixel art"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={warm}
            onPointerEnter={warm}
          />
        </label>
      </div>

      {shown.length === 0 && scores ? (
        <div className="x-none wrap" role="status">
          <Sprite art={SEARCHER} scale={5} />
          <p>
            Oops, we could not find anything with &lsquo;{query.trim()}&rsquo;.
          </p>
        </div>
      ) : null}

      {shown.map((c) => (
        <section key={c.id} id={c.id} className="x-collection wrap" aria-labelledby={`${c.id}-title`}>
          <h2 id={`${c.id}-title`}>{c.title}</h2>
          <div className={c.id === "scenes" ? "x-grid wide" : "x-grid"}>
            {c.items.map((item) => (
              <Card key={item.slug} item={item} wide={c.id === "scenes"} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
