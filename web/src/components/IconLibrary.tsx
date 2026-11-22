"use client";

import { memo, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import PixelIcon from "@/components/PixelIcon";
import { trackEvent } from "@/lib/consent";
import { copyText } from "@/lib/copy";
import {
  DEFAULT_STYLE,
  masks,
  paths,
  save,
  toJsx,
  toOpenPixel,
  toPngBlob,
  toSvg,
  zip,
  type IconStyle,
  type Masks,
  type Paths,
} from "@/lib/pixel-icon-render";

type Category = { id: string; title: string; count: number };

type Icon = {
  name: string;
  categories: number[];
  /** Name, tags and category titles, lower case, for search. */
  words: string[];
  masks: Masks;
  paths: Paths;
};

/** One icon as public/icons/pixel-icons.json stores it: name, category indexes, search words, packed stroke. */
export type IconRow = [name: string, categories: number[], tags: string, stroke: string];

type Data = { categories: [string, string][]; icons: IconRow[] };

const STORE = "openpixel.icons.style";
const SIZES = [32, 64, 96, 128, 160, 192, 224, 256];
const STROKES = ["#ffffff", "#ff4a1c", "#ffc425", "#3ddc84", "#4cc9f0", "#b388ff"];

const words = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** How well an icon matches the query: the name first, then its tags and categories. 0 is no match. */
function score(icon: Icon, q: string, qWords: string[]): number {
  if (icon.name === q) return 100;
  if (icon.name.startsWith(q)) return 80;
  if (icon.name.includes(q)) return 60;
  if (qWords.length && qWords.every((w) => icon.words.some((iw) => iw.startsWith(w)))) return 40;
  return 0;
}

function toIcon([name, cats, tags, stroke]: IconRow, titles: string[]): Icon {
  const m = masks(stroke);
  return {
    name,
    categories: cats,
    words: [...new Set([...words(name), ...words(tags), ...cats.flatMap((c) => words(titles[c] ?? ""))])],
    masks: m,
    paths: paths(m),
  };
}

/** The customizer's settings as event properties, sent with every copy and download (see trackEvent). */
function styleParams(style: IconStyle): Record<string, string> {
  const custom =
    style.stroke !== DEFAULT_STYLE.stroke ||
    style.outline !== DEFAULT_STYLE.outline ||
    style.shadow !== DEFAULT_STYLE.shadow ||
    style.border !== DEFAULT_STYLE.border ||
    style.drop !== DEFAULT_STYLE.drop;
  return {
    icon_size: String(style.size),
    icon_color: style.stroke,
    border: style.border ? "on" : "off",
    shadow: style.drop ? "on" : "off",
    custom_style: custom ? "yes" : "no",
  };
}

function readStyle(): IconStyle {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_STYLE, ...saved };
  } catch {
    // Storage can be blocked (private windows, strict settings): the defaults still work.
  }
  return DEFAULT_STYLE;
}

function readParams() {
  const p = new URLSearchParams(window.location.search);
  return { q: p.get("q") ?? "", category: p.get("category"), icon: p.get("icon") };
}

function writeParams(q: string, category: string | null, icon: string | null) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (category) p.set("category", category);
  if (icon) p.set("icon", icon);
  const s = p.toString();
  window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
}

/** A button whose label cross-fades to "Copied" (or "Saved") for a moment after its action works. */
function ActionButton({
  label,
  name,
  done = "Copied",
  action,
  onDone,
}: {
  label: string;
  /** What a screen reader hears, as "SVG" alone is ambiguous between Copy and Download. */
  name: string;
  done?: string;
  action: () => Promise<boolean | void> | boolean | void;
  /** Runs after the action worked (the analytics event). */
  onDone?: () => void;
}) {
  const [ok, setOk] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const run = async () => {
    let worked: boolean | void;
    try {
      worked = await action();
    } catch {
      worked = false;
    }
    if (worked === false) return;
    onDone?.();
    setOk(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOk(false), 1400);
  };
  return (
    <button type="button" className="il-action" onClick={run} aria-label={ok ? `${name}: ${done}` : name}>
      <span className="il-swap" aria-hidden="true">
        <span className={ok ? "swap out" : "swap"}>{label}</span>
        <span className={ok ? "swap" : "swap out"}>{done}</span>
      </span>
    </button>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="il-switch"
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

function ColorField({
  value,
  onChange,
  label,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value);
  // Follow outside changes (Reset, a swatch) unless the visitor is mid-typing a valid colour.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  return (
    <div className={disabled ? "il-color off" : "il-color"}>
      <label className="il-chip" style={{ background: value }}>
        <input
          type="color"
          value={value}
          aria-label={`${label} colour`}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <input
        className="il-hex"
        value={text}
        spellCheck={false}
        aria-label={`${label} colour as hex`}
        disabled={disabled}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          const hex = v.startsWith("#") ? v : `#${v}`;
          if (/^#[0-9a-f]{6}$/i.test(hex)) onChange(hex.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </div>
  );
}

function Customizer({ style, set }: { style: IconStyle; set: (s: Partial<IconStyle>) => void }) {
  const changed = JSON.stringify(style) !== JSON.stringify(DEFAULT_STYLE);
  const scale = style.size / 32;
  // On phones the controls fold away under their heading, so the icons come first.
  const [folded, setFolded] = useState(true);
  return (
    <section className="il-card il-custom" aria-labelledby="il-custom" data-folded={folded ? "" : undefined}>
      <div className="il-card-head">
        <h2 id="il-custom">
          <button type="button" className="il-fold" aria-expanded={!folded} onClick={() => setFolded((f) => !f)}>
            Customizer
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <span className="il-fold-label">Customizer</span>
        </h2>
        <button
          type="button"
          className="il-reset"
          onClick={() => set(DEFAULT_STYLE)}
          disabled={!changed}
          aria-label="Reset the customizer"
        >
          Reset
        </button>
      </div>

      <div className="il-custom-body">
      <div className="il-field">
        <span className="il-label">Color</span>
        <ColorField label="Primary" value={style.stroke} onChange={(stroke) => set({ stroke })} />
      </div>
      <div className="il-swatches" role="group" aria-label="Primary colour presets">
        {STROKES.map((c) => (
          <button
            key={c}
            type="button"
            className="il-swatch"
            style={{ background: c }}
            aria-label={`Primary colour ${c}`}
            aria-pressed={style.stroke === c}
            onClick={() => set({ stroke: c })}
          />
        ))}
      </div>

      <div className="il-field">
        <span className="il-label">Border</span>
        <ColorField label="Border" value={style.outline} disabled={!style.border} onChange={(outline) => set({ outline })} />
        <Switch on={style.border} label="Show the border" onChange={(border) => set({ border })} />
      </div>

      <div className="il-field">
        <span className="il-label">Shadow</span>
        <ColorField label="Shadow" value={style.shadow} disabled={!style.drop} onChange={(shadow) => set({ shadow })} />
        <Switch on={style.drop} label="Show the shadow" onChange={(drop) => set({ drop })} />
      </div>

      <div className="il-field il-size">
        <label className="il-label" htmlFor="il-size">
          Size
        </label>
        <output htmlFor="il-size">
          {style.size}px <span>{scale}×</span>
        </output>
        <input
          id="il-size"
          type="range"
          min={0}
          max={SIZES.length - 1}
          step={1}
          value={Math.max(0, SIZES.indexOf(style.size))}
          aria-valuetext={`${style.size} pixels`}
          onChange={(e) => set({ size: SIZES[Number(e.target.value)] })}
        />
      </div>
      </div>
    </section>
  );
}

/** The menu for downloading every shown icon at once, in the customizer's colours and size. */
function BulkMenu({ icons, style, label }: { icons: Icon[]; style: IconStyle; label: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const pack = async (format: "svg" | "png") => {
    setOpen(false);
    trackEvent("icon_bulk_download", { format, icon_count: String(icons.length), ...styleParams(style) });
    const enc = new TextEncoder();
    const entries = [];
    for (let i = 0; i < icons.length; i++) {
      const icon = icons[i];
      if (format === "svg") {
        entries.push({ path: `${icon.name}.svg`, data: enc.encode(toSvg(icon.paths, style)) });
      } else {
        const blob = await toPngBlob(icon.masks, style);
        entries.push({ path: `${icon.name}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        if (i % 50 === 0) setBusy(`PNG ${i + 1} of ${icons.length}`);
      }
    }
    const licence = await fetch("/icons/LICENSE.txt").then((r) => r.text(), () => "");
    if (licence) entries.push({ path: "LICENSE.txt", data: enc.encode(licence) });
    save(zip(entries), `openpixel-pixel-icons-${format}-${style.size}px.zip`);
    setBusy(null);
  };

  return (
    <div className={open ? "dl-menu open" : "dl-menu"} ref={root}>
      <button
        type="button"
        className="dl-btn il-bulk"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        disabled={busy !== null || icons.length === 0}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15V3" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
        </svg>
        <span aria-live="polite">{busy ?? label}</span>
      </button>
      <div className="dl-list" id={id} role="menu">
        <button type="button" role="menuitem" onClick={() => pack("svg")}>
          SVG files (.zip)
        </button>
        <button type="button" role="menuitem" onClick={() => pack("png")}>
          PNG files at {style.size}px (.zip)
        </button>
        <a
          role="menuitem"
          href="/icons/openpixel-pixel-icons.zip"
          download
          onClick={() => {
            trackEvent("icon_pack_download", { location: "library" });
            setOpen(false);
          }}
        >
          The whole set, original colours
        </a>
      </div>
    </div>
  );
}

function Detail({
  icon,
  style,
  categories,
  onClose,
  onCategory,
}: {
  icon: Icon | null;
  style: IconStyle;
  categories: Category[];
  onClose: () => void;
  onCategory: (id: string) => void;
}) {
  // Keep the last icon while the drawer slides away, so it doesn't empty mid-animation.
  const [last, setLast] = useState(icon);
  if (icon && icon !== last) setLast(icon);
  const shown = icon ?? last;
  const preview = Math.min(style.size, 160);

  const copied = (format: string) => () =>
    shown && trackEvent("icon_copy", { icon_name: shown.name, format, ...styleParams(style) });
  const downloaded = (format: string) => () =>
    shown && trackEvent("icon_download", { icon_name: shown.name, format, ...styleParams(style) });

  const copyPng = async () => {
    if (!shown || typeof ClipboardItem === "undefined") return false;
    // The promise goes to the clipboard straight away: Safari only allows the write inside the click.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": toPngBlob(shown.masks, style) })]);
    return true;
  };

  return (
    <aside
      className="il-drawer"
      data-open={icon ? "" : undefined}
      aria-hidden={icon ? undefined : true}
      inert={!icon}
      aria-label={shown ? `${shown.name} icon` : undefined}
    >
      {shown ? (
        <div className="il-drawer-inner">
          <div className="il-preview" style={{ ["--preview" as string]: `${preview}px` }}>
            <PixelIcon paths={shown.paths} label={`${shown.name}, pixel icon`} />
          </div>
          <div className="il-info">
            <h2>{shown.name}</h2>
            <div className="il-cats">
              {shown.categories.map((c) => (
                <button key={c} type="button" className="il-tag" onClick={() => onCategory(categories[c].id)}>
                  {categories[c].title}
                </button>
              ))}
            </div>
            <p className="il-tags">{shown.words.filter((w) => !shown.name.split("-").includes(w)).slice(0, 14).join(", ")}</p>
          </div>
          <div className="il-actions">
            <div className="il-group">
              <span>Copy</span>
              <ActionButton label="SVG" name="Copy SVG" action={() => copyText(toSvg(shown.paths, style))} onDone={copied("svg")} />
              <ActionButton
                label="JSX"
                name="Copy JSX"
                action={() => copyText(toJsx(shown.name, shown.paths, style))}
                onDone={copied("jsx")}
              />
              <ActionButton label="PNG" name="Copy PNG image" action={copyPng} onDone={copied("png")} />
              <ActionButton label="Name" name="Copy name" action={() => copyText(shown.name)} onDone={copied("name")} />
            </div>
            <div className="il-group">
              <span>Download</span>
              <ActionButton
                label="SVG"
                name="Download SVG"
                done="Saved"
                action={() => save(toSvg(shown.paths, style), `${shown.name}.svg`, "image/svg+xml")}
                onDone={downloaded("svg")}
              />
              <ActionButton
                label={`PNG ${style.size}px`}
                name={`Download PNG, ${style.size} pixels`}
                done="Saved"
                action={async () => save(await toPngBlob(shown.masks, style), `${shown.name}.png`)}
                onDone={downloaded("png")}
              />
              <ActionButton
                label=".openpixel"
                name="Download OpenPixel file"
                done="Saved"
                action={() => save(toOpenPixel(shown.name, shown.masks, style), `${shown.name}.openpixel`, "application/json")}
                onDone={downloaded("openpixel")}
              />
            </div>
          </div>
          <button type="button" className="il-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      ) : null}
    </aside>
  );
}

/** One icon in the grid. Memoised: opening an icon re-renders the two tiles whose state changed, not all of them. */
const Tile = memo(function Tile({ icon, pressed, onPick }: { icon: Icon; pressed: boolean; onPick: (name: string) => void }) {
  return (
    <button
      type="button"
      className="il-tile"
      data-name={icon.name}
      aria-pressed={pressed}
      aria-label={icon.name}
      onClick={() => onPick(icon.name)}
    >
      <PixelIcon paths={icon.paths} />
      <span className="il-name" aria-hidden="true">
        {icon.name}
      </span>
    </button>
  );
});

const GAP = 6; // px between tiles, as in .il-grid-rows
/** Tiles in normal flow before the grid's width is known: the icons the server sends with the page. */
const PREVIEW_TILES = 120;
const OVERSCAN = 3; // rows kept in the page above and below the screen
/** Space the sticky header and search bar cover at the top, and the open drawer at the bottom. */
const TOP_COVER = 140;
const BOTTOM_COVER = 260;

/**
 * Keeps only the rows on screen (and a few around them) in the page. With every icon as a tile the grid held some
 * 2,000 buttons and 13,000 elements, and switching between "All icons" and a category froze the page while the
 * browser built or removed them. The grid keeps its full height, so the scroll bar and page length stay right.
 *
 * Until the grid's width is known (the server render and the first paint), it shows the first icons in normal flow.
 */
function useIconWindow(count: number, size: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);

  const cols = width ? Math.max(1, Math.floor((width + GAP) / (size + 32 + GAP))) : 0;
  const tile = cols ? (width - GAP * (cols - 1)) / cols : 0;
  const pitch = tile + GAP;
  const rows = cols ? Math.ceil(count / cols) : 0;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A layout effect, so the first windowed render already has its rows and nothing flashes empty.
  useLayoutEffect(() => {
    if (!cols) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / pitch) - OVERSCAN);
      const last = Math.max(first, Math.min(rows, Math.ceil((window.innerHeight - top) / pitch) + OVERSCAN));
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [cols, pitch, rows]);

  /** Scrolls just enough to show the tile at `index` between the search bar and the drawer, without animating. */
  const reveal = useCallback(
    (index: number) => {
      const el = ref.current;
      if (!el || !cols) return;
      const y = el.getBoundingClientRect().top + window.scrollY + Math.floor(index / cols) * pitch;
      if (y < window.scrollY + TOP_COVER) window.scrollTo({ top: y - TOP_COVER, behavior: "instant" });
      else if (y + tile > window.scrollY + window.innerHeight - BOTTOM_COVER)
        window.scrollTo({ top: y + tile - window.innerHeight + BOTTOM_COVER, behavior: "instant" });
    },
    [cols, pitch, tile],
  );

  const first = Math.min(range[0], rows);
  const last = Math.min(range[1], rows);
  return { ref, cols, pitch, rows, first, last, reveal };
}

export default function IconLibrary({
  categories,
  total,
  preview,
}: {
  categories: Category[];
  total: number;
  /** The first icons, rendered on the server so the grid (and search engines) see icons before the set loads. */
  preview: IconRow[];
}) {
  const [loaded, setIcons] = useState<Icon[] | null>(null);
  const firstIcons = useMemo(() => {
    const titles = categories.map((c) => c.title.toLowerCase());
    return preview.map((row) => toIcon(row, titles));
  }, [preview, categories]);
  const icons = loaded ?? firstIcons;
  const [failed, setFailed] = useState(false);
  const [style, setStyle] = useState<IconStyle>(DEFAULT_STYLE);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusNext = useRef<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  /** The last settings sent to analytics (or restored from storage), so only real changes count. */
  const styleSeen = useRef<string | null>(null);
  const lastSearch = useRef("");

  // Settings, the address's ?q=, ?category= and ?icon=, then the icons themselves.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only state, read once after hydration */
    const restored = readStyle();
    setStyle(restored);
    styleSeen.current = JSON.stringify(restored);
    const p = readParams();
    setQuery(p.q);
    if (p.category && categories.some((c) => c.id === p.category)) setCategory(p.category);
    if (p.icon) setSelected(p.icon);
    /* eslint-enable react-hooks/set-state-in-effect */
    let live = true;
    fetch("/icons/pixel-icons.json")
      .then((r) => (r.ok ? (r.json() as Promise<Data>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        const titles = data.categories.map(([, t]) => t.toLowerCase());
        setIcons(data.icons.map((row) => toIcon(row, titles)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [categories]);

  const set = useCallback((s: Partial<IconStyle>) => {
    setStyle((old) => {
      const next = { ...old, ...s };
      try {
        localStorage.setItem(STORE, JSON.stringify(next));
      } catch {
        // Not saved; the page still uses it.
      }
      return next;
    });
  }, []);

  // The address follows the search, category and open icon, once they settle: each address change is a history
  // event, which analytics counts as a page view, so typing must not send one per letter.
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => writeParams(deferredQuery.trim(), category, selected), 1000);
    return () => window.clearTimeout(t);
  }, [loaded, deferredQuery, category, selected]);

  // A change to the customizer counts once it settles (dragging a colour picker would otherwise send dozens).
  useEffect(() => {
    const key = JSON.stringify(style);
    if (styleSeen.current === null || key === styleSeen.current) return;
    const t = window.setTimeout(() => {
      styleSeen.current = key;
      trackEvent("icon_customize", styleParams(style));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [style]);

  const shown = useMemo(() => {
    const catIndex = category ? categories.findIndex((c) => c.id === category) : -1;
    const inCat = catIndex >= 0 ? icons.filter((i) => i.categories.includes(catIndex)) : icons;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return inCat;
    const qWords = words(q);
    const qName = q.replace(/\s+/g, "-");
    return inCat
      .map((icon) => ({ icon, s: score(icon, qName, qWords) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s || a.icon.name.localeCompare(b.icon.name))
      .map((r) => r.icon);
  }, [icons, category, categories, deferredQuery]);

  const { ref: gridRef, cols, pitch, rows, first, last, reveal } = useIconWindow(shown.length, style.size);

  // A search counts once the visitor stops typing for a second, with how many icons it found.
  useEffect(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!loaded || q.length < 2 || q === lastSearch.current) return;
    const t = window.setTimeout(() => {
      lastSearch.current = q;
      trackEvent("icon_search", {
        search_term: q.slice(0, 100),
        search_location: "icon_library",
        results_count: String(shown.length),
        category: category ?? "all",
      });
    }, 1000);
    return () => window.clearTimeout(t);
  }, [loaded, deferredQuery, shown.length, category]);

  const current = (selected && icons.find((i) => i.name === selected)) || null;

  // "/" jumps to search; Escape closes the drawer; ← and → step through the shown icons while it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        search.current?.focus();
        return;
      }
      if (e.key === "Escape" && selected) {
        setSelected(null);
        return;
      }
      if (!selected || typing || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      const at = shown.findIndex((i) => i.name === selected);
      if (at < 0) return;
      e.preventDefault();
      const index = (at + (e.key === "ArrowRight" ? 1 : -1) + shown.length) % shown.length;
      setSelected(shown[index].name);
      // The tile may not be in the page yet: scroll its row into view, then focus it once it has rendered.
      reveal(index);
      focusNext.current = shown[index].name;
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, shown, reveal]);

  useEffect(() => {
    if (!focusNext.current) return;
    const tile = gridRef.current?.querySelector<HTMLButtonElement>(`[data-name="${focusNext.current}"]`);
    if (tile) {
      tile.focus({ preventScroll: true });
      focusNext.current = null;
    }
  });

  // Keep the chosen category in view in the categories list (a sideways row on phones).
  const side = useRef<HTMLElement>(null);
  useEffect(() => {
    side.current
      ?.querySelector<HTMLButtonElement>('[aria-current="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [category]);

  const pickCategory = (id: string | null, from = "sidebar") => {
    if (id !== category) trackEvent("icon_category_select", { category: id ?? "all", location: from });
    setCategory(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  // Opening an icon from a tile; the latest selection comes from a ref so the callback, and the tiles, stay the same.
  const selectedNow = useRef(selected);
  useEffect(() => {
    selectedNow.current = selected;
  }, [selected]);
  const pick = useCallback((name: string) => {
    const open = selectedNow.current !== name;
    if (open) trackEvent("icon_open", { icon_name: name });
    setSelected(open ? name : null);
  }, []);

  const windowed = cols > 0;
  const visible = windowed ? shown.slice(first * cols, last * cols) : shown.slice(0, PREVIEW_TILES);

  const vars = {
    "--pi-stroke": style.stroke,
    "--pi-outline": style.outline,
    "--pi-shadow": style.shadow,
    "--pi-size": `${style.size}px`,
  } as React.CSSProperties;

  const catTitle = categories.find((c) => c.id === category)?.title;
  const q = deferredQuery.trim();
  const bulkLabel = !loaded ? "Download" : shown.length === loaded.length ? "Download all" : `Download ${shown.length}`;

  return (
    <div
      className="il wrap-wide"
      style={vars}
      data-pi-border={style.border ? undefined : "off"}
      data-pi-drop={style.drop ? undefined : "off"}
      data-drawer={current ? "open" : undefined}
    >
      <aside className="il-side">
        <Customizer style={style} set={set} />
        <nav className="il-card il-categories" aria-label="Categories" ref={side}>
          <h2>Categories</h2>
          <ul>
            <li>
              <button type="button" aria-current={category === null ? "true" : undefined} onClick={() => pickCategory(null)}>
                All icons <span>{total.toLocaleString("en-US")}</span>
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={category === c.id ? "true" : undefined}
                  onClick={() => pickCategory(c.id)}
                >
                  {c.title} <span>{c.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <section className="il-main" aria-label="Icons">
        <div className="il-bar">
          <label className="x-search il-search">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m21 21-4.34-4.34" />
              <circle cx="11" cy="11" r="8" />
            </svg>
            <input
              ref={search}
              type="search"
              placeholder={`Search ${total.toLocaleString("en-US")} icons`}
              aria-label="Search icons"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd aria-hidden="true">/</kbd>
          </label>
          <BulkMenu icons={loaded ? shown : []} style={style} label={bulkLabel} />
        </div>

        <p className="il-count" aria-live="polite">
          {loaded ? (
            <>
              {shown.length.toLocaleString("en-US")} {shown.length === 1 ? "icon" : "icons"}
              {catTitle ? <> in {catTitle}</> : null}
              {q ? <> for &lsquo;{q}&rsquo;</> : null}
              {catTitle ? (
                <button type="button" className="il-clear" onClick={() => pickCategory(null, "clear")}>
                  Show all categories
                </button>
              ) : null}
            </>
          ) : failed ? (
            "The icons didn't load. Reload the page to try again."
          ) : (
            "Loading icons…"
          )}
        </p>

        {loaded && shown.length === 0 ? (
          <div className="il-none" role="status">
            <p>No icon matches &lsquo;{q}&rsquo;{catTitle ? ` in ${catTitle}` : ""}.</p>
            {catTitle ? (
              <button type="button" className="pill" onClick={() => pickCategory(null, "no_results")}>
                Search all categories
              </button>
            ) : null}
          </div>
        ) : null}

        <div
          className="il-grid"
          ref={gridRef}
          aria-busy={!loaded}
          style={windowed ? { height: Math.max(0, rows * pitch - GAP) } : undefined}
        >
          <div
            className={windowed ? "il-grid-rows windowed" : "il-grid-rows"}
            style={
              windowed
                ? {
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    transform: `translateY(${first * pitch}px)`,
                  }
                : undefined
            }
          >
            {visible.map((icon) => (
              <Tile key={icon.name} icon={icon} pressed={icon.name === selected} onPick={pick} />
            ))}
          </div>
        </div>
      </section>

      <Detail
        icon={current}
        style={style}
        categories={categories}
        onClose={() => setSelected(null)}
        onCategory={(id) => {
          setQuery("");
          pickCategory(id, "icon_details");
        }}
      />
    </div>
  );
}
