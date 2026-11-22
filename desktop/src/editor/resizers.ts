/* Panels resize by dragging their edges; sizes are remembered. The handles' own listeners are on
   the .resizer elements in Editor.tsx (startResize, resetSize). */
import { $ } from '../lib/dom';
import { S } from '../state/ui';
import { dirty } from './core';
import { updateSliceLabel } from './slice';

export type Panel = 'left' | 'right' | 'bottom';
export const SIZES: Record<Panel, [number, number, number]> = { left: [180, 440, 264], right: [230, 460, 264], bottom: [72, 260, 104] };
export function setSize(which: Panel, px: number): number {
  const [min, max] = SIZES[which];
  const v = Math.round(Math.max(min, Math.min(max, px)));
  document.documentElement.style.setProperty(which === 'bottom' ? '--bottom-h' : `--${which}-w`, v + 'px');
  dirty.render3d = true; dirty.slice = true;
  return v;
}

let saved: Partial<Record<Panel, number>> = {};
export function initResizers(): void {
  try { saved = JSON.parse(localStorage.getItem('openpixel.panels') || '{}'); } catch (e) { saved = {}; }
  // The left panel opens as wide as the right one (until it is resized itself).
  for (const k of Object.keys(SIZES) as Panel[]) setSize(k, saved[k] || (k === 'left' && saved.right) || SIZES[k][2]);
}
/** mousedown on a handle: the panel follows the pointer until the button is let go. */
export function startResize(r: HTMLElement, e: { preventDefault(): void; stopPropagation(): void }): void {
  e.preventDefault(); e.stopPropagation();
  const which = r.dataset.resize as Panel;
  r.classList.add('active');
  document.body.classList.add(which === 'bottom' ? 'resizing-row' : 'resizing-col');
  const move = (ev: MouseEvent) => {
    const px = which === 'left' ? ev.clientX - $('#rail').getBoundingClientRect().right : which === 'right' ? window.innerWidth - ev.clientX : window.innerHeight - ev.clientY;
    saved[which] = setSize(which, px);
  };
  const up = () => {
    r.classList.remove('active');
    document.body.classList.remove('resizing-row', 'resizing-col');
    window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
    try { localStorage.setItem('openpixel.panels', JSON.stringify(saved)); } catch (e) { /* not saved */ }
    if (S.mode === 'slice') updateSliceLabel();
  };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}
/** Double-click on a handle: back to the panel's own size. */
export function resetSize(r: HTMLElement): void { const w = r.dataset.resize as Panel; saved[w] = setSize(w, SIZES[w][2]); }
