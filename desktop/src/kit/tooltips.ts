/* Tooltips.
   The app draws its own tooltips, like the dock labels on the website (solid, not glass): a short name and the
   shortcut as key caps, above the control (below it when there is no room), the arrow pointing at the control.
   The first one waits a moment so moving across the toolbar doesn't flash labels; while one is showing, the next
   control's label appears at once and without animation. Leaving hides it at once. Titles in the markup feed it:
   write title="Undo (⌘Z)" in JSX, the Mac's way; the title becomes data-tip (no system tooltip) at startup or on
   first hover. Off the Mac the caps read Ctrl, Alt, Shift (lib/platform.ts). */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { $ } from '../lib/dom';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { isMac, shortcutKeys } from '../lib/platform';

const tipEl = document.createElement('div');
tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip');
let tipFor: HTMLElement | null = null, tipTimer: ReturnType<typeof setTimeout> | undefined, tipHiddenAt = 0;
/** When the tooltip last appeared (ms). */
export let tipShownAt = 0;

const SHORTCUT = /^[⌘⇧⌥⌃]*(\w|[[\]'+=,./↩⌫−←→↑↓-]|PgUp|PgDn|Tab|Space)$/;
const SHORTCUT_OR_BACKSLASH = /^[⌘⇧⌥⌃]*(\w|[[\]'+=,./\\↩⌫−←→↑↓-]|PgUp|PgDn|Tab|Space)$/;
export function tipParts(text: string): { label: string; keys: string[] } {
  const m = text.match(/^([\s\S]*?)\s*\(([^()]{1,14})\)$/);
  // A backslash counts as a key off the Mac only: there "Hide sidebar (⌘\)" would otherwise show the Mac's glyph as
  // text. On the Mac that one tooltip has always read as text, and stays so.
  const shortcut = m && (isMac ? SHORTCUT : SHORTCUT_OR_BACKSLASH).test(m[2]);
  if (!m || !shortcut) return { label: text, keys: [] };
  return { label: m[1], keys: shortcutKeys(m[2]) };
}
/** Moves an element's title into data-tip (no system tooltip), keeping an accessible name for icon buttons. */
export function adoptTitle(el: HTMLElement): void {
  const t = el.getAttribute('title');
  el.removeAttribute('title');
  if (!t) return;
  el.dataset.tip = t;
  if (!el.getAttribute('aria-label') && !(el.textContent || '').trim()) el.setAttribute('aria-label', tipParts(t).label);
}
/** Gives icon-only buttons their accessible names right away (titles move to data-tip on first hover anyway).
 *  Runs once after the first render, as the old page did for its static markup. */
export function adoptTitles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[title]').forEach(adoptTitle);
}
/** For a title the old code wrote on every redraw (`$('#layer-del').title = …` in renderLayers): React only writes an
 *  attribute when its value changes, so once a hover has moved the title to data-tip it would stay gone. This writes
 *  it after every render instead, as before: <button ref={useTitle(`Delete ${name} (⌘⌫)`)}> and no title prop. */
export function useTitle<T extends HTMLElement = HTMLElement>(title: string | null | undefined): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => { if (ref.current && title != null) ref.current.title = title; });
  return ref;
}
function showTip(el: HTMLElement, instant: boolean): void {
  const { label, keys } = tipParts(el.dataset.tip || '');
  if (!label) return;
  tipEl.replaceChildren();
  const l = document.createElement('span'); l.textContent = label; tipEl.appendChild(l);
  if (keys.length) {
    const k = document.createElement('span'); k.className = 'keys';
    for (const key of keys) { const c = document.createElement('kbd'); c.textContent = key; k.appendChild(c); }
    tipEl.appendChild(k);
  }
  if (!tipEl.isConnected) document.body.appendChild(tipEl);
  tipEl.classList.add('on');
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  // The tab bar counts as the window's top edge: labels below it never cover the open files.
  const bar = $('#tabbar'), ceiling = bar && !bar.contains(el) ? bar.getBoundingClientRect().bottom : 0;
  const above = r.top - h - 10 >= ceiling + 4;
  const cx = r.left + r.width / 2;
  const x = Math.max(6, Math.min(window.innerWidth - w - 6, cx - w / 2));
  const ax = Math.max(10, Math.min(w - 10, cx - x));
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(above ? r.top - h - 9 : r.bottom + 9)}px`;
  tipEl.style.setProperty('--ax', `${Math.round(ax)}px`);
  tipEl.dataset.side = above ? 'top' : 'bottom';
  tipShownAt = Date.now();
  if (!instant && tipEl.animate && !reducedMotion.matches) {
    tipEl.style.transformOrigin = `${Math.round(ax)}px ${above ? '100%' : '0%'}`;
    tipEl.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: EASE_OUT });
  }
}
export function hideTip(): void {
  clearTimeout(tipTimer);
  if (tipEl.classList.contains('on')) tipHiddenAt = Date.now();
  tipEl.classList.remove('on');
  tipFor = null;
}

let installed = false;
export function installTooltips(): void {
  if (installed) return;
  installed = true;
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[title], [data-tip]') : null;
    if (el && el.hasAttribute('title')) adoptTitle(el);
    if (!el || !el.dataset.tip || el === tipFor) return;
    const warm = tipEl.classList.contains('on') || Date.now() - tipHiddenAt < 400;
    hideTip();
    tipFor = el;
    tipTimer = setTimeout(() => { if (tipFor === el && el.isConnected) showTip(el, warm); }, warm ? 0 : 500);
  });
  document.addEventListener('pointerout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget as Node | null)) hideTip(); });
  for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, () => { clearTimeout(tipTimer); if (tipFor) { tipEl.classList.remove('on'); tipFor = null; } }, true);
  window.addEventListener('blur', hideTip);
}
