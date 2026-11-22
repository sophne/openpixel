/* Strokes: a local preview while the pointer is down, one engine call at the end (app.js 1237–1327). */
import { errorText } from '../lib/dom';
import { call } from '../lib/host';
import { toast } from '../kit';
import { S } from '../state/ui';
import { dirty, idx, inBounds, live, target, type StrokeKind } from './core';
import { refresh } from './engine';

export function mirrored(cells: number[][]): number[][] {
  const out = new Map<number, number[]>();
  for (const [x, y, z] of cells) {
    const xs = S.mirror.x ? [x, S.sx - 1 - x] : [x], ys = S.mirror.y ? [y, S.sy - 1 - y] : [y], zs = S.mirror.z ? [z, S.sz - 1 - z] : [z];
    for (const a of xs) for (const b of ys) for (const c of zs) if (inBounds(a, b, c)) out.set(idx(a, b, c), [a, b, c]);
  }
  return [...out.values()];
}
function planeAxes(axis: number): number[] { return [0, 1, 2].filter((k) => k !== axis); }
export function squareOnPlane(cell: number[], axis: number): number[][] {
  const b = S.brush, o = Math.floor((b - 1) / 2), cells: number[][] = [];
  const [u, v] = planeAxes(axis);
  for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) {
    const p = cell.slice(); p[u] += i - o; p[v] += j - o; cells.push(p);
  }
  return cells;
}
function lineOnPlane(a: number[], b: number[], axis: number): number[][] {
  const [u, v] = planeAxes(axis);
  const du = b[u] - a[u], dv = b[v] - a[v], n = Math.max(Math.abs(du), Math.abs(dv), 1), out: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const p = a.slice(); p[u] = Math.round(a[u] + du * i / n); p[v] = Math.round(a[v] + dv * i / n);
    out.push(...squareOnPlane(p, axis));
  }
  return out;
}
function rectOnPlane(a: number[], b: number[], axis: number): number[][] {
  const [u, v] = planeAxes(axis), out: number[][] = [];
  for (let i = Math.min(a[u], b[u]); i <= Math.max(a[u], b[u]); i++)
    for (let j = Math.min(a[v], b[v]); j <= Math.max(a[v], b[v]); j++) { const p = a.slice(); p[u] = i; p[v] = j; out.push(p); }
  return out;
}

export function beginStroke(kind: StrokeKind, start: number[], axis: number): void {
  live.stroke = { kind, start, axis, last: start, cells: new Map(), baseComp: S.comp.slice(), baseAct: S.act.slice(), move: [0, 0, 0] };
}
export function strokeTo(cell: number[] | null): void {
  if (!live.stroke || !cell) return;
  const s = live.stroke;
  if (s.kind === 'rect' || s.kind === 'line') {
    s.cells.clear();
    const list = s.kind === 'rect' ? rectOnPlane(s.start, cell, s.axis) : lineOnPlane(s.start, cell, s.axis);
    for (const p of mirrored(list)) s.cells.set(idx(p[0], p[1], p[2]), p);
  } else if (s.kind === 'move') {
    s.move = [cell[0] - s.start[0], cell[1] - s.start[1], cell[2] - s.start[2]];
  } else {
    for (const p of mirrored(lineOnPlane(s.last, cell, s.axis))) {
      const i = idx(p[0], p[1], p[2]);
      if ((s.kind === 'erase' || s.kind === 'recolor') && !s.baseAct[i]) continue;
      s.cells.set(i, p);
    }
  }
  s.last = cell;
  applyStrokePreview();
}
function applyStrokePreview(): void {
  const s = live.stroke!;
  S.comp = s.baseComp.slice(); S.act = s.baseAct.slice();
  if (s.kind === 'move') {
    // Show the active layer shifted (other layers stay put).
    const [dx, dy, dz] = s.move;
    for (let i = 0; i < s.baseAct.length; i++) if (s.baseAct[i] && S.comp[i] === s.baseAct[i]) S.comp[i] = 0;
    for (let y = 0; y < S.sy; y++) for (let z = 0; z < S.sz; z++) for (let x = 0; x < S.sx; x++) {
      const v = s.baseAct[idx(x, y, z)];
      if (v && inBounds(x + dx, y + dy, z + dz)) S.comp[idx(x + dx, y + dy, z + dz)] = v;
    }
  } else {
    const v = s.kind === 'erase' ? 0 : S.fg;
    for (const i of s.cells.keys()) { S.comp[i] = v; S.act[i] = v; }
  }
  dirty.mesh = true; dirty.slice = true;
}
export async function endStroke(): Promise<void> {
  const s = live.stroke;
  if (!s) return;
  const cells = [...s.cells.values()];
  try {
    if (s.kind === 'move') {
      const [dx, dy, dz] = s.move;
      if (dx || dy || dz) await call('transform', { op: 'move', dx, dy, dz, ...target() });
    } else if (cells.length) {
      if (s.kind === 'erase') await call('erase_voxels', { voxels: cells, ...target() });
      else await call('set_voxels', { voxels: cells, color: S.fg, mode: s.kind === 'recolor' ? 'paint' : 'replace', ...target() });
    }
  } catch (e) { toast(errorText(e)); }
  live.stroke = null;
  refresh();
}
