/* The pointer in both views: drawing, orbiting and panning, the wheel and the trackpad (app.js 1329–1573).
   The listeners are the old ones, on the canvases and on window; initMouse() adds them once the canvases exist. */
import { toast } from '../kit';
import { S } from '../state/ui';
import { cam, dirty, idx, inBounds, live, setCursorChip, sliceCell, sliceSize, sv, target, tool, type StrokeKind } from './core';
import { setFg } from './engine';
import { boxLines, gl, glCanvas, lineBuffer, pick, planeCell, ray } from './gl';
import { settleSliceZoom, sliceCanvas, zoomSliceAt } from './slice';
import { beginStroke, endStroke, mirrored, squareOnPlane, strokeTo } from './strokes';

/** Safari's pinch events. */
interface GestureEvent extends UIEvent { scale: number; clientX: number; clientY: number }
interface Point { clientX: number; clientY: number }

/* ---------------------------------------------------------------- mouse: 3D view */
let drag: { kind: 'pan' | 'orbit'; x: number; y: number } | { kind: 'tool' } | null = null;
function stageXY(e: Point, el: Element): [number, number] { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

/* Trackpad and wheel, in both views: two fingers (or the wheel) move the picture, a pinch (or ⌘ + scroll) zooms
   around the pointer, continuously. In 3D, ⌥ + two fingers orbits. WebKit reports a pinch as gesture events and
   sometimes also as ctrl + wheel; while a gesture runs, the wheel copy is ignored. */
const wheelPx = (e: WheelEvent, el: Element): number => (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1);
const wheelZoom = (e: WheelEvent, el: Element): number => Math.exp(-e.deltaY * wheelPx(e, el) * (e.ctrlKey ? 0.01 : 0.002)); // pinch steps are small, wheel notches large
let pinch: { scale: number; at?: [number, number] } | null = null; // { scale } while a trackpad pinch (gesture events) is under way
let lastPointer: Point | null = null; // where the pointer last was, for gesture events that carry no position
const gesturePoint = (e: Point): Point => (Number.isFinite(e.clientX) && (e.clientX || e.clientY) ? e : lastPointer || e);

function zoomCamera(factor: number): void {
  cam.dist = Math.max(3, Math.min(2000, cam.dist / factor));
  dirty.render3d = true;
}
function panCamera(dx: number, dy: number): void {
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const up = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  const k = cam.dist / (glCanvas.clientHeight || 600) * 0.75;
  cam.tx += (-dx * r[0] + dy * up[0]) * k; cam.ty += (-dx * r[1] + dy * up[1]) * k; cam.tz += (-dx * r[2] + dy * up[2]) * k;
}
function updateHover3d(mx: number, my: number): void {
  if (!gl) return;
  const rect = glCanvas.getBoundingClientRect();
  if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) return;
  const p = pick(mx, my, (S.tool === 'eraser' || S.tool === 'recolor') ? S.act : S.comp);
  let cell: number[] | null = null;
  if (p) {
    if (['eraser', 'recolor', 'picker', 'fill'].includes(S.tool) && p.hit) cell = [p.hit.x, p.hit.y, p.hit.z];
    else if (p.place) cell = p.place;
  }
  const key = cell ? cell.join(',') : '';
  if (key !== (S.hover && S.hover.key)) {
    S.hover = cell ? { key, cell } : null;
    if (cell && p) {
      const axis = p.n.findIndex((v) => v !== 0);
      const cells = ['pencil', 'eraser', 'recolor'].includes(S.tool) ? squareOnPlane(cell, axis) : [cell];
      lineBuffer('cursor', cells.flatMap((c) => boxLines(c[0] - 0.01, c[1] - 0.01, c[2] - 0.01, c[0] + 1.01, c[1] + 1.01, c[2] + 1.01)));
    } else lineBuffer('cursor', []);
    dirty.render3d = true;
    setCursorChip(cell ? `x ${cell[0]}  y ${cell[1]}  z ${cell[2]}` : '');
  }
}

/* ---------------------------------------------------------------- mouse: slice view */
let sdrag: { pan: true; x: number; y: number; tool?: undefined } | { tool: true; pan?: undefined } | null = null;
interface SliceHit { c: number; r: number; inside: boolean; cell: number[] }
function sliceHit(e: Point): SliceHit {
  const [mx, my] = stageXY(e, sliceCanvas);
  const c = Math.floor((mx - sv.panX) / sv.zoom), r = Math.floor((my - sv.panY) / sv.zoom);
  const { cols, rows } = sliceSize();
  return { c, r, inside: c >= 0 && r >= 0 && c < cols && r < rows, cell: sliceCell(c, r) };
}
const sliceAxisIndex = (): number => ({ x: 0, y: 1, z: 2 }[S.axis]);

function sliceFill(h: SliceHit): void {
  // 2D bucket inside the slice, on the active layer.
  const { cols, rows } = sliceSize();
  const at = (c: number, r: number) => { const p = sliceCell(c, r); return S.act[idx(p[0], p[1], p[2])]; };
  const from = at(h.c, h.r);
  if (from === S.fg) return;
  const seen = new Uint8Array(cols * rows), stack = [[h.c, h.r]], cells: number[][] = [];
  seen[h.r * cols + h.c] = 1;
  while (stack.length) {
    const [c, r] = stack.pop()!;
    cells.push(sliceCell(c, r));
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[nr * cols + nc] || at(nc, nr) !== from) continue;
      seen[nr * cols + nc] = 1; stack.push([nc, nr]);
    }
  }
  tool('set_voxels', { voxels: mirrored(cells), color: S.fg, ...target() });
}

let installed = false;
export function initMouse(): void {
  if (installed) return;
  installed = true;

  glCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  glCanvas.addEventListener('mousedown', (e) => {
    const [mx, my] = stageXY(e, glCanvas);
    if (e.button === 2 || e.button === 1 || S.tool === 'orbit' || live.spaceDown) {
      drag = { kind: (e.button === 1 || e.shiftKey) ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    const p = pick(mx, my);
    const toolId = e.altKey ? 'picker' : S.tool;
    if (toolId === 'picker') { if (p && p.hit) setFg(S.comp[idx(p.hit.x, p.hit.y, p.hit.z)]); return; }
    if (toolId === 'fill') {
      if (p) tool('flood_fill', { at: p.hit ? [p.hit.x, p.hit.y, p.hit.z] : p.place, color: S.fg, ...target() });
      return;
    }
    if (S.layers[S.layer] && S.layers[S.layer].locked) { toast('This layer is locked'); return; }
    if (toolId === 'eraser' || toolId === 'recolor') {
      const pa = pick(mx, my, S.act);
      if (!pa || !pa.hit) { toast('Nothing of the active layer here'); return; }
      const axis = pa.n.findIndex((v) => v !== 0);
      const cell = [pa.hit.x, pa.hit.y, pa.hit.z];
      beginStroke(toolId === 'eraser' ? 'erase' : 'recolor', cell, axis);
      live.stroke!.planeValue = cell[axis];
      strokeTo(cell);
    } else if (p && p.place) {
      const axis = p.n.findIndex((v) => v !== 0);
      const kind = (toolId === 'pencil' ? 'add' : toolId) as StrokeKind;
      beginStroke(kind, p.place, axis);
      live.stroke!.planeValue = p.place[axis];
      if (kind !== 'move') strokeTo(p.place);
    } else return;
    drag = { kind: 'tool' };
  });
  window.addEventListener('mousemove', (e) => {
    if (S.mode !== '3d') return;
    const [mx, my] = stageXY(e, glCanvas);
    if (drag && (drag.kind === 'orbit' || drag.kind === 'pan')) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.kind === 'orbit') {
        cam.yaw -= dx * 0.4; cam.pitch = Math.max(-89, Math.min(89, cam.pitch + dy * 0.4));
      } else panCamera(dx, dy);
      dirty.render3d = true;
      return;
    }
    if (drag && drag.kind === 'tool' && live.stroke) {
      const cell = planeCell(ray(mx, my), live.stroke.axis, live.stroke.planeValue as number);
      if (cell && inBounds(cell[0], cell[1], cell[2])) strokeTo(cell);
    }
    updateHover3d(mx, my);
  });
  window.addEventListener('mouseup', () => {
    if (drag && drag.kind === 'tool') endStroke();
    drag = null;
  });
  window.addEventListener('mousemove', (e) => { lastPointer = { clientX: e.clientX, clientY: e.clientY }; }, { passive: true });

  glCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = wheelPx(e, glCanvas);
    if (e.ctrlKey || e.metaKey) { if (!pinch) zoomCamera(wheelZoom(e, glCanvas)); return; }
    if (e.altKey) {
      cam.yaw -= e.deltaX * px * 0.25; cam.pitch = Math.max(-89, Math.min(89, cam.pitch - e.deltaY * px * 0.25));
    } else panCamera(-e.deltaX * px, -e.deltaY * px);
    dirty.render3d = true;
  }, { passive: false });
  glCanvas.addEventListener('gesturestart', (e) => { e.preventDefault(); pinch = { scale: 1 }; });
  glCanvas.addEventListener('gesturechange', (ev) => {
    const e = ev as GestureEvent;
    e.preventDefault();
    if (!pinch) pinch = { scale: 1 };
    zoomCamera(e.scale / pinch.scale); pinch.scale = e.scale;
  });
  glCanvas.addEventListener('gestureend', (e) => { e.preventDefault(); pinch = null; });

  sliceCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
  sliceCanvas.addEventListener('mousedown', (e) => {
    if (e.button === 1 || live.spaceDown || S.tool === 'orbit') { sdrag = { pan: true, x: e.clientX, y: e.clientY }; return; }
    const h = sliceHit(e);
    if (!h.inside) return;
    // Right-click paints the background colour, which here is empty: it erases.
    const toolId = e.altKey ? 'picker' : e.button === 2 ? 'eraser' : S.tool;
    if (toolId === 'picker') { const v = S.comp[idx(h.cell[0], h.cell[1], h.cell[2])]; if (v) setFg(v); return; }
    if (S.layers[S.layer] && S.layers[S.layer].locked) { toast('This layer is locked'); return; }
    if (toolId === 'fill') { sliceFill(h); return; }
    const kind = ({ pencil: 'add', eraser: 'erase', recolor: 'recolor', rect: 'rect', line: 'line', move: 'move' } as Record<string, StrokeKind>)[toolId];
    if (!kind) return;
    beginStroke(kind, h.cell, sliceAxisIndex());
    if (kind !== 'move') strokeTo(h.cell);
    sdrag = { tool: true };
  });
  window.addEventListener('mousemove', (e) => {
    if (S.mode !== 'slice') return;
    if (sdrag && sdrag.pan) {
      sv.panX += e.clientX - sdrag.x; sv.panY += e.clientY - sdrag.y;
      sdrag.x = e.clientX; sdrag.y = e.clientY; dirty.slice = true; return;
    }
    const h = sliceHit(e);
    if (sdrag && sdrag.tool && live.stroke) {
      const { cols, rows } = sliceSize();
      const c = Math.max(0, Math.min(cols - 1, h.c)), r = Math.max(0, Math.min(rows - 1, h.r));
      strokeTo(sliceCell(c, r));
    }
    const prev = S.hover && S.hover.key;
    S.hover = h.inside ? { key: `${h.c},${h.r}`, slice: [h.c, h.r], cell: h.cell } : null;
    if ((S.hover && S.hover.key) !== prev) {
      dirty.slice = true;
      setCursorChip(!h.inside ? '' : S.isSprite ? `x ${h.c}  y ${h.r}` : `x ${h.cell[0]}  y ${h.cell[1]}  z ${h.cell[2]}`);
    }
  });
  window.addEventListener('mouseup', () => {
    if (sdrag && sdrag.tool) endStroke();
    sdrag = null;
  });
  sliceCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [mx, my] = stageXY(e, sliceCanvas);
    if (e.ctrlKey || e.metaKey) {
      if (pinch) return;
      cancelAnimationFrame(live.zoomAnim);
      zoomSliceAt(mx, my, sv.zoom * wheelZoom(e, sliceCanvas));
      settleSliceZoom(mx, my);
    } else {
      const px = wheelPx(e, sliceCanvas);
      sv.panX -= e.deltaX * px; sv.panY -= e.deltaY * px;
      dirty.slice = true;
    }
  }, { passive: false });
  sliceCanvas.addEventListener('gesturestart', (e) => { e.preventDefault(); cancelAnimationFrame(live.zoomAnim); clearTimeout(live.settleTimer); pinch = { scale: 1 }; });
  sliceCanvas.addEventListener('gesturechange', (ev) => {
    const e = ev as GestureEvent;
    e.preventDefault();
    if (!pinch) pinch = { scale: 1 };
    const [mx, my] = stageXY(gesturePoint(e), sliceCanvas);
    zoomSliceAt(mx, my, sv.zoom * e.scale / pinch.scale);
    pinch.scale = e.scale; pinch.at = [mx, my];
  });
  sliceCanvas.addEventListener('gestureend', (ev) => {
    const e = ev as GestureEvent;
    e.preventDefault();
    const at = (pinch && pinch.at) || stageXY(gesturePoint(e), sliceCanvas);
    pinch = null;
    settleSliceZoom(at[0], at[1], 0);
  });
}
