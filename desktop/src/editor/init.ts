/* The editor's startup, key handling and frame loop (app.js 3124–3284 minus what became handlers in JSX and what the
   kit took, and 4345–4356), and what the editor owes the other areas and the old test scripts: its `actions` slots and
   its compat names (README.md). Editor.tsx imports this module, so both are registered before the page starts. */
import { actions, registerActions } from '../app/actions';
import { $, $$ } from '../lib/dom';
import { post, SCREENSHOT } from '../lib/host';
import { menuModifier } from '../lib/platform';
import { changed } from '../lib/store';
import { S, ui } from '../state/ui';
import { registerCompat } from '../testing/compat';
import { addColor, closePicker, editColor, openPicker, pk } from './colour';
import { showReview, showShortcuts, stopPlay, togglePlay } from './controls';
import { cam, chipsView, dirty, live, sliceSize, sv, target, tool, TOOL_LIST, ZOOMS } from './core';
import { isRefreshing, refresh, setActive, setFg } from './engine';
import { draw3d, gl, glCanvas, initGL, pick, resetCamera, viewProj } from './gl';
import { buildTools, setAxis, setBrush, setFramesOpen, setMode, setPixelGrid, setTool, stepSlice } from './modes';
import { initMouse } from './mouse';
import { initResizers, setSize, SIZES } from './resizers';
import { applyLeftSide, docMenuAction, renameFile, setLeftOpen } from './sidebar';
import { drawSlice, fitSlice, sctx, sliceCanvas, updateSliceLabel, zoomStep } from './slice';

/* Thumbnails follow the frames panel height. */
function sizeThumbs(): void {
  const st = $('#strip');
  const room = st.clientHeight - 14;            // strip padding
  const label = room >= 58 ? 16 : 0;            // drop the label when it gets tight
  const t = Math.max(14, room - 10 - label);    // frame padding + border
  st.style.setProperty('--thumb', t + 'px');
  st.classList.toggle('compact', !label);
}

/** The page's own shortcuts (the rest of wire()'s key handler: its Escape branch is the kit's, kit/keys.ts). */
function onKeyDown(e: KeyboardEvent): void {
  const tag = (e.target as Element | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (menuModifier(e)) return; // menu shortcuts are handled by the app's menu bar
  if (e.key === 'Enter' && tag === 'BUTTON') return; // the focused button handles Return itself
  if (e.key === ' ') { live.spaceDown = true; e.preventDefault(); return; }
  if (e.key === 'Escape') return; // kit/keys.ts
  if (ui.view === 'home' && e.key === '/' && !$$('.modal-bg.open').length) { e.preventDefault(); $('#home-search').focus(); return; }
  if (S.home) return;
  if (e.key === 'Tab') { e.preventDefault(); setMode(S.mode === '3d' ? 'slice' : '3d'); return; }
  if (e.shiftKey && (e.key === 'X' || e.key === 'Z' || e.key === 'Y')) { $(`[data-mirror="${e.key.toLowerCase()}"]`).click(); return; }
  const t = TOOL_LIST.find((x) => x.key && x.key.toLowerCase() === e.key.toLowerCase());
  if (t && !e.shiftKey) { setTool(t.id); return; }
  if (e.key === '[') setBrush(S.brush - 1);
  else if (e.key === ']') setBrush(S.brush + 1);
  else if (e.key === ',') setActive({ frame: (S.frame - 1 + S.frames.length) % S.frames.length });
  else if (e.key === '.') setActive({ frame: (S.frame + 1) % S.frames.length });
  else if (e.key === 'Enter') togglePlay();
  else if (e.key === "'") setPixelGrid(!S.pixelGrid);
  else if (e.key === 'f' || e.key === 'F') $('#frames-toggle').click();
  else if (e.key === 'o' || e.key === 'O') $('#onion').click();
  else if (e.key === '?') showShortcuts();
  else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    // Layer above / below (the list shows the top layer first).
    e.preventDefault();
    const next = S.layer + (e.key === 'ArrowUp' ? 1 : -1);
    if (next >= 0 && next < S.layers.length) setActive({ layer: next });
  }
  else if (e.key === 'PageUp') stepSlice(1);
  else if (e.key === 'PageDown') stepSlice(-1);
  else if (e.key === '+' || e.key === '=') { if (S.mode === 'slice') zoomStep(1); }
  else if (e.key === '-') { if (S.mode === 'slice') zoomStep(-1); }
  else if (e.key.startsWith('Arrow') && S.tool === 'move') {
    e.preventDefault();
    const d = ({ ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: e.shiftKey ? [0, 1, 0] : [0, 0, -1], ArrowDown: e.shiftKey ? [0, -1, 0] : [0, 0, 1] } as Record<string, number[]>)[e.key];
    tool('transform', { op: 'move', dx: d[0], dy: d[1], dz: d[2], ...target() });
  }
}

/* ---------------------------------------------------------------- frame loop */
let frameCount = 0, stateReady = false, framesSent = false;
function loop(): void {
  if (S.mode === '3d') draw3d(); else drawSlice();
  frameCount++;
  if (SCREENSHOT && stateReady) {
    // Keep drawing so the snapshot has fresh pixels; after ~120 frames tell the app to take the picture.
    dirty.render3d = true;
    if (frameCount >= 120 && !framesSent) { framesSent = true; post({ kind: 'frames', count: frameCount }); }
  }
  requestAnimationFrame(loop);
}

/** Once, after the first render: what app.js ran at the end of the file for the editor, in the old order. */
function initEditor(): void {
  initGL();
  initMouse();
  buildTools();
  initResizers();
  // wire(): what was not a handler on an element
  setPixelGrid(S.pixelGrid);
  chipsView.pscale = S.previewScale; changed(chipsView);
  applyLeftSide();
  setFramesOpen(!(() => { try { return localStorage.getItem('openpixel.framesClosed') === '1'; } catch (e) { return false; } })());
  new ResizeObserver(sizeThumbs).observe($('#strip'));
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (e) => { if (e.key === ' ') live.spaceDown = false; });
  window.addEventListener('resize', () => { dirty.render3d = true; dirty.slice = true; });
  setAxis('z');
  setMode('slice');
  requestAnimationFrame(loop);
}
/** After the first refresh and the first page. */
function editorReady(): void {
  sizeThumbs();
  stateReady = true; frameCount = 0;
}

registerActions({
  initEditor, editorReady, refresh, setMode, fitSlice, sliceSize, updateSliceLabel,
  redraw() { dirty.render3d = true; dirty.slice = true; },
  resetCamera, zoomStep, togglePlay, stopPlay, closePicker, showReview, showShortcuts, setPixelGrid, setLeftOpen,
  renameFile, docMenuAction,
});

// The names tests/uitest.js and tests/demo.js use of the editor (testing/compat.ts lists them).
registerCompat({
  // `pick3d(x, y)`: what a click at that point of the 3D canvas lands on (gl.ts `pick`; the test has a `pick` of its own).
  ZOOMS, SIZES, sv, cam, pk, viewProj, pick3d: pick, resetCamera, setMode, setFg, setSize, setFramesOpen, setPixelGrid, setLeftOpen, applyLeftSide,
  closePicker, refresh, fitSlice,
  // Not used by the two scripts, but part of the same surface (handy from the console, and for a script that grows):
  setTool, setAxis, setBrush, stepSlice, zoomStep, togglePlay, stopPlay, showReview, showShortcuts, openPicker, addColor, editColor,
  sliceSize, updateSliceLabel, setActive, tool,
  get refreshing() { return isRefreshing(); },
  get stateReady() { return stateReady; },
  get render3dDirty() { return dirty.render3d; },
  set render3dDirty(v: boolean) { dirty.render3d = v; },
  get sliceDirty() { return dirty.slice; },
  set sliceDirty(v: boolean) { dirty.slice = v; },
  get meshDirty() { return dirty.mesh; },
  set meshDirty(v: boolean) { dirty.mesh = v; },
  // These exist once the page has rendered.
  get glCanvas() { return glCanvas; },
  get gl() { return gl; },
  get sliceCanvas() { return sliceCanvas; },
  get sctx() { return sctx; },
  // The slots between the areas, so a test can stand in for an area that is not there.
  actions,
});
