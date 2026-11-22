/* Tools, the 2D / 3D switch, the slice axis and index, the brush, and the two view choices that
   are remembered: the folded Frames strip and the pixel grid (463–477). */
import { $ } from '../lib/dom';
import { changed } from '../lib/store';
import { S } from '../state/ui';
import { appView, chipsView, dirty, framesBar, modeView, setCursorChip, sliceSize, toolsView, type Axis } from './core';
import { lineBuffer } from './gl';
import { fitSlice, updateInfoChip, updateSliceLabel, updateViewPanel } from './slice';

/** The toolbar's buttons are drawn by the Toolbar component once this has run (after the static markup's titles
 *  were adopted, as before: a tool keeps its title until it is first hovered). */
export function buildTools(): void {
  toolsView.built = true;
  setTool('pencil');
}
export function setTool(id: string): void {
  S.tool = id;
  toolsView.tool = id;
  changed(toolsView);
  lineBuffer('cursor', []);
  S.hover = null; dirty.render3d = true; dirty.slice = true;
}
export function setMode(m: 'slice' | '3d'): void {
  S.mode = m;
  appView.modeSlice = m === 'slice';
  modeView.mode = m;
  changed(appView, modeView);
  S.hover = null;
  setCursorChip('');
  if (m === 'slice') requestAnimationFrame(fitSlice);
  dirty.render3d = true; dirty.slice = true;
  updateViewPanel(); updateInfoChip();
}
export function setAxis(a: Axis): void {
  S.axis = a;
  const { depth } = sliceSize();
  S.slice = a === 'y' ? 0 : Math.floor(depth / 2);
  fitSlice();
}
export function stepSlice(d: number): void {
  const { depth } = sliceSize();
  S.slice = Math.max(0, Math.min(depth - 1, S.slice + d));
  dirty.slice = true; updateSliceLabel();
}
export function setBrush(b: number): void {
  S.brush = Math.max(1, Math.min(16, b));
  $<HTMLInputElement>('#brush').value = String(S.brush);
  chipsView.brush = String(S.brush);
  changed(chipsView);
}

/* The Frames strip folds down to its bar (play, onion and duration stay at hand) to give the canvas more room. */
export function setFramesOpen(open: boolean): void {
  appView.framesClosed = !open;
  framesBar.open = open;
  framesBar.title = open ? 'Hide frames (F)' : 'Show frames (F)';
  changed(appView, framesBar);
  try { localStorage.setItem('openpixel.framesClosed', open ? '0' : '1'); } catch (e) { /* not remembered */ }
  dirty.render3d = true; dirty.slice = true;
}
export function setPixelGrid(on: boolean): void {
  S.pixelGrid = on;
  chipsView.pixelGrid = on;
  changed(chipsView);
  try { localStorage.setItem('openpixel.pixelGrid', on ? 'on' : 'off'); } catch (e) { /* not remembered */ }
  dirty.slice = true;
}
