"use client";

import { useEffect, useId, useRef, useState } from "react";

export type DownloadOption = { label: string; href: string; file: string };

/** A Download button that opens a list of formats, like the Export menu in the OpenPixel app. */
export default function DownloadMenu({ title, options }: { title: string; options: DownloadOption[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  // Up and down arrows move between the formats while the menu is open.
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLAnchorElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div className={open ? "dl-menu open" : "dl-menu"} ref={root}>
      <button
        ref={button}
        type="button"
        className="dl-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Download ${title}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => root.current?.querySelector<HTMLAnchorElement>("[role=menuitem]")?.focus());
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 15V3" />
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="m7 10 5 5 5-5" />
        </svg>
        Download
      </button>
      <div className="dl-list" id={id} role="menu" aria-label={`Download ${title} as`} onKeyDown={onMenuKey}>
        {options.map((o) => (
          <a key={o.href} role="menuitem" href={o.href} download={o.file} onClick={() => setOpen(false)}>
            {o.label}
          </a>
        ))}
      </div>
    </div>
  );
}
