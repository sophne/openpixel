/* The slice view (2D, like a sprite): drawing, fitting and zooming (app.js 1138–1235, 1496–1526, 2969–2975), and the
   two labels that follow the view (455–462, 478–489).
   Plain drawing code, as before; the Stage component hands over its canvas with attachSlice(). */
import { batch, changed } from '../lib/store';
import { S } from '../state/ui';
import { CHECK, dirty, idx, infoView, live, ONION, PIXEL_GRID, sliceCell, sliceSize, sv, viewPanel, ZOOMS } from './core';
import { resizeCanvas } from './gl';

export let sliceCanvas: HTMLCanvasElement;
export let sctx: CanvasRenderingContext2D;

/** The #slice canvas, from its ref: `const sliceCanvas = $('#slice'); const sctx = sliceCanvas.getContext('2d')`. */
export function attachSlice(canvas: HTMLCanvasElement | null): void {
  if (!canvas || canvas === sliceCanvas) return;
  sliceCanvas = canvas;
  sctx = canvas.getContext('2d')!;
}

export function updateInfoChip(): void {
  const names = { x: 'Side', y: 'Top', z: 'Front' };
  let t;
  if (S.mode === '3d') t = `3D · ${S.ortho ? 'orthographic' : 'perspective'}`;
  else if (S.isSprite) t = `Sprite · ${Math.round(sv.zoom * 100)}%`;
  else t = `${names[S.axis]} slice ${S.slice}/${sliceSize().depth - 1} · ${Math.round(sv.zoom * 100)}%`;
  infoView.text = t;
  changed(infoView);
}
export function updateViewPanel(): void {
  const slice = S.mode === 'slice';
  viewPanel.sliceHidden = !slice || !!S.isSprite;
  viewPanel.spriteHidden = !S.isSprite;
  viewPanel.twoDHidden = !slice;
  viewPanel.ghostHidden = !!S.isSprite; // a sprite has no slice behind it
  viewPanel.threeDHidden = slice;
  viewPanel.axis = S.axis;
  viewPanel.sliceIndex = `${S.slice}/${sliceSize().depth - 1}`;
  viewPanel.zoomLabel = `${Math.round(sv.zoom * 100)}%`;
  viewPanel.ortho = S.ortho;
  changed(viewPanel);
}

export function fitSlice(): void {
  const { cols, rows } = sliceSize();
  const w = sliceCanvas.clientWidth || 800, h = sliceCanvas.clientHeight || 500;
  let z = ZOOMS[0];
  for (const l of ZOOMS) if (cols * l <= w * 0.86 && rows * l <= h * 0.86) z = l;
  cancelAnimationFrame(live.zoomAnim); clearTimeout(live.settleTimer);
  sv.zoom = z;
  sv.panX = Math.round((w - cols * z) / 2); sv.panY = Math.round((h - rows * z) / 2);
  dirty.slice = true;
  updateSliceLabel();
}
export function updateSliceLabel(): void {
  batch(() => {
    updateViewPanel();
    updateInfoChip();
  });
}

let sliceImage: HTMLCanvasElement | null = null;
export function drawSlice(): void {
  if (S.mode !== 'slice') return;
  if (resizeCanvas(sliceCanvas)) dirty.slice = true;
  if (!dirty.slice) return;
  dirty.slice = false;
  const dpr = window.devicePixelRatio || 1;
  const g = sctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1e1e1e';
  g.fillRect(0, 0, sliceCanvas.clientWidth, sliceCanvas.clientHeight);
  const { cols, rows } = sliceSize();
  const z = sv.zoom, ox = Math.round(sv.panX * dpr) / dpr, oy = Math.round(sv.panY * dpr) / dpr;
  const crisp = (v: number) => (Math.round(v * dpr) + 0.5) / dpr; // the middle of the device pixel a line falls on
  // checkered background (16x16 cells, grey 128/192)
  for (let cy = 0; cy < rows; cy += CHECK.size) for (let cx = 0; cx < cols; cx += CHECK.size) {
    g.fillStyle = ((cx + cy) / CHECK.size) % 2 ? CHECK.c2 : CHECK.c1;
    g.fillRect(ox + cx * z, oy + cy * z, Math.min(CHECK.size, cols - cx) * z, Math.min(CHECK.size, rows - cy) * z);
  }
  // cells -> a small image, scaled up without smoothing
  if (!sliceImage || sliceImage.width !== cols || sliceImage.height !== rows) {
    sliceImage = document.createElement('canvas'); sliceImage.width = cols; sliceImage.height = rows;
  }
  const ig = sliceImage.getContext('2d')!;
  const data = ig.createImageData(cols, rows);
  const px = data.data;
  const behind: { grid: Uint8Array; k: number; a: number; tint: number[] | null }[] = [];
  if (S.onionOn) S.onion.forEach((o) => behind.push({ grid: o.data, k: S.slice, a: ONION.base / 255, tint: o.frame < S.frame ? [255, 120, 120] : [120, 150, 255] }));
  if (S.ghost && S.slice > 0) behind.push({ grid: S.comp, k: S.slice - 1, a: 0.22, tint: null });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = sliceCell(c, r);
    const v = S.comp[idx(cell[0], cell[1], cell[2])];
    const p = (r * cols + c) * 4;
    if (v) { const rgb = S.rgb[v]; px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255; continue; }
    for (const L of behind) {
      const gc = sliceCell(c, r, L.k);
      const gv = L.grid[idx(gc[0], gc[1], gc[2])];
      if (!gv) continue;
      let rgb = S.rgb[gv];
      const tint = L.tint;
      if (tint) rgb = rgb.map((t, i) => (t + tint[i]) / 2);
      px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = Math.round(L.a * 255);
      break;
    }
  }
  ig.putImageData(data, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(sliceImage, ox, oy, cols * z, rows * z);
  // pixel grid, fading in as you zoom in (the Grid button in the View panel turns it off)
  if (S.pixelGrid && z >= 6) {
    const a = Math.min(160, (z - 4) * 14) / 255;
    g.strokeStyle = PIXEL_GRID + a + ')'; g.lineWidth = 1 / dpr;
    g.beginPath();
    for (let c = 0; c <= cols; c++) { const x = crisp(ox + c * z); g.moveTo(x, oy); g.lineTo(x, oy + rows * z); }
    for (let r = 0; r <= rows; r++) { const y = crisp(oy + r * z); g.moveTo(ox, y); g.lineTo(ox + cols * z, y); }
    g.stroke();
  }
  g.strokeStyle = '#000'; g.lineWidth = 1;
  g.strokeRect(ox - 0.5, oy - 0.5, cols * z + 1, rows * z + 1);
  if (S.hover && S.hover.slice) {
    const [c, r] = S.hover.slice;
    const b = S.brush, o = Math.floor((b - 1) / 2);
    g.strokeStyle = '#ff4a1c'; g.lineWidth = 2;
    g.strokeRect(ox + (c - o) * z, oy + (r - o) * z, b * z, b * z);
  }
}

/* 2D zoom is continuous while pinching, with the cell under the fingers staying put. When the fingers stop it
   settles, quickly, on whole screen pixels per cell below 8× (so every pixel is the same size) or on the nearest
   zoom level when it is within 5% of one. */
export const ZOOM_MIN = ZOOMS[0], ZOOM_MAX = ZOOMS[ZOOMS.length - 1];
export function zoomSliceAt(mx: number, my: number, z: number): void {
  z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  if (z === sv.zoom) return;
  const cx = (mx - sv.panX) / sv.zoom, cy = (my - sv.panY) / sv.zoom;
  sv.zoom = z;
  sv.panX = mx - cx * z; sv.panY = my - cy * z;
  dirty.slice = true; updateSliceLabel();
}
function settledZoom(z: number): number {
  if (z < 8) return Math.max(ZOOM_MIN, Math.round(z));
  return ZOOMS.find((l) => Math.abs(z / l - 1) < 0.05) || z;
}
function animateSliceZoom(mx: number, my: number, to: number, ms: number): void {
  cancelAnimationFrame(live.zoomAnim);
  const from = sv.zoom, t0 = performance.now();
  if (to === from || matchMedia('(prefers-reduced-motion: reduce)').matches || ms <= 0) { zoomSliceAt(mx, my, to); return; }
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms), k = 1 - Math.pow(1 - t, 3); // ease-out: moves at once, lands softly
    zoomSliceAt(mx, my, t < 1 ? from * Math.pow(to / from, k) : to);
    if (t < 1) live.zoomAnim = requestAnimationFrame(step);
  };
  live.zoomAnim = requestAnimationFrame(step);
}
export function settleSliceZoom(mx: number, my: number, wait = 140): void {
  clearTimeout(live.settleTimer);
  live.settleTimer = setTimeout(() => animateSliceZoom(mx, my, settledZoom(sv.zoom), 140), wait);
}
/** The next zoom level up (1) or down (-1), around the middle of the canvas. A button glides there; keys jump. */
export function zoomStep(dir: number, animate = false): void {
  const z = sv.zoom;
  const to = dir > 0 ? (ZOOMS.find((l) => l > z * 1.001) || ZOOM_MAX) : ([...ZOOMS].reverse().find((l) => l < z / 1.001) || ZOOM_MIN);
  clearTimeout(live.settleTimer);
  animateSliceZoom(sliceCanvas.clientWidth / 2, sliceCanvas.clientHeight / 2, to, animate ? 160 : 0);
}
