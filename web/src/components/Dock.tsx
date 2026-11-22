"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * The macOS Dock with OpenPixel in the middle of the apps people use it with: a picture of one of the three
 * systems the app runs on, kept as the hero's ornament. The icons are the apps' own dark-mode Dock icons,
 * rendered from a Mac by web/scripts/dock-icons.swift; other apps' icons are their owners' trademarks and only
 * show what OpenPixel works alongside.
 *
 * Motion, like the real Dock:
 * - Icons grow with the pointer's distance (a cosine falloff over about three icons) and push their neighbours
 *   outward. Sizes follow the pointer through springs, so they settle naturally and reverse smoothly mid-motion.
 *   This animates width/height rather than transform on purpose: only layout pushes neighbours apart and
 *   widens the bar the way macOS does, and it's nine small elements.
 * - The largest an icon gets is the hero title's font size; resting size is two thirds of that.
 * - Only with a mouse or trackpad, and not when reduced motion is requested.
 * - OpenPixel bounces once on load, like an app launching.
 */

type App = { id: string; name: string; running?: boolean; mark?: string };

const APPS: App[] = [
  { id: "finder", name: "Finder", running: true },
  { id: "chrome", name: "Google Chrome", running: true },
  { id: "claude", name: "Claude", running: true },
  { id: "openpixel", name: "OpenPixel", running: true },
  { id: "codex", name: "Codex", running: true, mark: "/dock/codex-mark.svg" },
  { id: "grok", name: "Grok" },
  { id: "cursor", name: "Cursor", running: true },
];

const TRASH: App = { id: "trash", name: "Trash" };

const MAGNIFY = 1.5; // largest size ÷ resting size
const REACH = 3; // how many resting icon widths the magnification reaches on each side
const SPRING = { stiffness: 380, damping: 32 }; // quick, no overshoot: icons shouldn't wobble

function Item({ app, className }: { app: App; className?: string }) {
  return (
    <li className={`dock-item${className ? ` ${className}` : ""}`} data-dock-item>
      <span className="dock-label">{app.name}</span>
      <span className="dock-icon">
        <Image src={`/dock/${app.id}.png`} alt="" width={128} height={128} priority={app.id === "openpixel"} unoptimized draggable={false} />
        {app.mark ? <Image className="dock-mark" src={app.mark} alt="" width={96} height={96} unoptimized draggable={false} /> : null}
      </span>
      {app.running ? <i className="dock-dot" /> : null}
    </li>
  );
}

export default function Dock() {
  const dock = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const items = [...el.querySelectorAll<HTMLElement>("[data-dock-item]")];
    const state = items.map(() => ({ size: 0, velocity: 0, target: 0 }));
    let base = 0;
    let pointerX: number | null = null;
    let frame = 0;
    let last = 0;

    const measure = () => {
      // Resting size comes from CSS (two thirds of the title size).
      items.forEach((it) => {
        it.style.width = "";
        it.style.height = "";
      });
      base = items[0].getBoundingClientRect().width;
      state.forEach((s) => {
        s.size = base;
        s.velocity = 0;
        s.target = base;
      });
    };

    const targets = () => {
      items.forEach((it, i) => {
        if (pointerX === null) {
          state[i].target = base;
          return;
        }
        const r = it.getBoundingClientRect();
        const d = Math.abs(pointerX - (r.left + r.width / 2));
        const reach = base * REACH;
        const f = d < reach ? (Math.cos((Math.PI * d) / reach) + 1) / 2 : 0;
        state[i].target = base + base * (MAGNIFY - 1) * f;
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.032, (now - (last || now)) / 1000) || 1 / 60;
      last = now;
      targets();
      let moving = false;
      state.forEach((s, i) => {
        const force = SPRING.stiffness * (s.target - s.size) - SPRING.damping * s.velocity;
        s.velocity += force * dt;
        s.size += s.velocity * dt;
        if (Math.abs(s.target - s.size) > 0.05 || Math.abs(s.velocity) > 0.05) moving = true;
        else {
          s.size = s.target;
          s.velocity = 0;
        }
        const px = `${s.size.toFixed(2)}px`;
        items[i].style.width = px;
        items[i].style.height = px;
      });
      frame = moving || pointerX !== null ? requestAnimationFrame(tick) : 0;
      if (!frame) last = 0;
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const enabled = () => fine.matches && !calm.matches;

    const onMove = (e: PointerEvent) => {
      if (!enabled() || e.pointerType !== "mouse") return;
      pointerX = e.clientX;
      el.dataset.active = "true";
      start();
    };
    const onLeave = () => {
      pointerX = null;
      delete el.dataset.active;
      start();
    };
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
      pointerX = null;
      measure();
    };

    measure();
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <div className="dock-wrap">
      <ul ref={dock} className="dock" aria-label="OpenPixel in the macOS Dock, between Finder, Chrome, Claude, Codex, Grok and Cursor">
        {APPS.map((a) => (
          <Item key={a.id} app={a} className={a.id === "openpixel" ? "dock-openpixel" : undefined} />
        ))}
        <li className="dock-divider" aria-hidden="true" />
        <Item app={TRASH} />
      </ul>
    </div>
  );
}
