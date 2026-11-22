/* State from the engine and what the panels show of it (app.js 233–315, 318–453, 491–504, 532–536, 620–649, 683–687,
   759–776). The old render…() functions keep their names: each fills its store in core.ts and calls changed(), and
   the panel components draw from the stores. */
import { actions } from '../app/actions';
import { $, $$, errorText } from '../lib/dom';
import { call, nativeAction } from '../lib/host';
import { batch, changed } from '../lib/store';
import { toast } from '../kit';
import { activeTabName, leftSide, S, ui } from '../state/ui';
import {
  activityView, chipsView, dirty, docView, fgView, framesView, layersView, live, paletteView, panelsView, previewView,
  sliceSize, thumbs, tool, type ActivityEntry,
} from './core';
import { stopPlay } from './controls';
import { resetCamera } from './gl';
import { setAxis, setMode } from './modes';
import { fitSlice, updateInfoChip, updateViewPanel } from './slice';

/* ---------------------------------------------------------------- state from the engine */
function b64(s: string | null | undefined): Uint8Array {
  const bin = atob(s || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexToRgb(h: string): number[] {
  if (!h || h === 'transparent') return [0, 0, 0];
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

let refreshing = false, refreshAgain = false;
const refreshWaiters: (() => void)[] = [];
export function isRefreshing(): boolean { return refreshing; }
/** Reads the open tabs and the active document's state. Resolves once the newest state is on screen. */
export async function refresh(): Promise<void> {
  if (refreshing) { refreshAgain = true; return new Promise((resolve) => { refreshWaiters.push(resolve); }); }
  refreshing = true;
  try {
    const t = await nativeAction('tabs');
    if (t && Array.isArray(t.tabs)) {
      if (t.active !== ui.active) S.revision = -1; // another file: fresh camera and canvas
      actions.applyTabs(t);
    }
    const st = await call('ui_state', { onion: S.onionOn });
    applyState(st);
    refreshActivity();
  } catch (e) { toast(errorText(e)); }
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; await refresh(); }
  refreshWaiters.splice(0).forEach((resolve) => resolve());
}

// The engine's `ui_state` answer (Engine.uiState in the core): the host-message boundary.
function applyState(st: any): void {
  const [sx, sy, sz] = st.size as number[];
  const fresh = S.revision < 0;
  const resized = sx !== S.sx || sy !== S.sy || sz !== S.sz || fresh;
  if (fresh) { previewView.src = undefined; changed(previewView); } // another file: no stale preview while the new one renders
  Object.assign(S, { sx, sy, sz });
  S.name = st.name; S.file = st.file; S.dirty = st.unsaved_changes;
  S.palette = st.palette; S.rgb = (st.palette as string[]).map(hexToRgb);
  S.comp = b64(st.composite); S.act = b64(st.active_cel);
  S.onion = ((st.onion || []) as { frame: number; data: string }[]).map((o) => ({ frame: o.frame, data: b64(o.data) }));
  S.layers = st.layers; S.frames = st.frames; S.layer = st.active_layer; S.frame = st.active_frame;
  S.celsFilled = st.cels_filled; S.undo = st.undo_steps; S.redo = st.redo_steps; S.revision = st.revision;
  if (S.fg >= S.palette.length) S.fg = Math.max(1, S.palette.length - 1);
  const sprite = sz === 1;
  const kindChanged = sprite !== S.isSprite;
  S.isSprite = sprite;
  if (resized || kindChanged) {
    resetCamera();
    if (kindChanged || fresh) {
      // 2D sprites open on the flat canvas with a front preview; 3D models open in the 3D view.
      S.previewYaw = sprite ? 0 : 45; S.previewPitch = sprite ? 0 : 30;
      setAxis('z');
      setMode(sprite ? 'slice' : '3d');
    }
    S.slice = Math.min(S.slice, sliceSize().depth - 1);
    fitSlice();
  }
  live.stroke = null;
  dirty.mesh = true; dirty.slice = true; dirty.render3d = true;
  updatePanels();
  schedulePreview();
  if (actions.chatOpened()) actions.syncChatFile();
}

/* ---------------------------------------------------------------- panels */
export function updatePanels(): void {
  batch(() => {
    renderPalette();
    renderLayers();
    renderFrames();
    updateDocHead();
    const duration = $<HTMLInputElement>('#duration');
    if (document.activeElement !== duration) duration.value = String(S.frames[S.frame] ? S.frames[S.frame].duration_ms : 100);
    panelsView.undoOff = S.undo === 0;
    panelsView.redoOff = S.redo === 0;
    panelsView.onion = S.onionOn;
    panelsView.layerDelOff = S.layers.length < 2;
    panelsView.layerMergeOff = S.layer === 0;
    panelsView.frameDelOff = S.frames.length < 2;
    changed(panelsView);
    updateViewPanel();
    updateInfoChip();
  });
}

/** The swatches are built anew (the Palette component draws paletteView; `n` makes each redraw new elements). */
function renderPalette(): void {
  paletteView.n++;
  paletteView.palette = S.palette;
  paletteView.fg = S.fg;
  changed(paletteView);
  updateFg();
}

/* Layers reorder by dragging (the top row is in front) or with ⌥↑ / ⌥↓. A line in the accent shows where the layer
   lands; dropping below the last row sends it to the back. */
export function layerDropTarget(li: number, above: boolean): number {
  // Above row `li`: right in front of that layer; below it: right behind it. Indexes as they are after the move.
  const from = live.layerDrag as number;
  const to = above ? (from < li ? li : li + 1) : (from < li ? li - 1 : li);
  return Math.max(0, Math.min(S.layers.length - 1, to));
}
export function clearLayerDrop(): void { $$('#layers .layer').forEach((r) => r.classList.remove('drop-above', 'drop-below')); $('#layers').classList.remove('drop-end'); }
export function moveLayer(from: number | null, to: number | null): void {
  if (from == null || to == null || from === to) return;
  tool('move_layer', { layer: from, to });
}
/** The rows are built anew (the Layers component draws layersView), except in the middle of a drag. */
export function renderLayers(): void {
  if (live.layerDrag != null) return; // redrawn when the drag ends
  layersView.n++;
  layersView.layers = S.layers;
  layersView.layer = S.layer;
  layersView.isSprite = S.isSprite;
  changed(layersView);
}

let thumbTimer: ReturnType<typeof setTimeout> | undefined;
/** The strip is built anew (the Strip component draws framesView). */
function renderFrames(): void {
  framesView.n++;
  framesView.frames = S.frames;
  framesView.frame = S.frame;
  changed(framesView);
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(renderThumbs, 250);
}
async function renderThumbs(): Promise<void> {
  const count = Math.min(S.frames.length, 60);
  for (let i = 0; i < count; i++) {
    try {
      const r = await call('render_view', { frame: i, scale: S.isSprite ? 2 : 2, outline: !S.isSprite });
      if (r.images && r.images[0]) {
        thumbs[i] = r.images[0];
        const img = $$<HTMLImageElement>('#strip .fr .thumb img')[i];
        if (img) img.src = thumbs[i];
      }
    } catch (e) { return; }
  }
}

export function setFg(i: number): void {
  if (!i) return;
  S.fg = i;
  paletteView.fg = i;
  changed(paletteView);
  updateFg();
}
function updateFg(): void {
  const hex = S.palette[S.fg] || '#000000';
  fgView.hex = hex;
  fgView.index = `#${S.fg}`;
  changed(fgView);
  const field = $<HTMLInputElement>('#fg-hex');
  if (document.activeElement !== field) field.value = hex;
}

export function setActive(a: { layer?: number; frame?: number }): Promise<any> { stopPlay(); return tool('set_active', a); }

/* ---------------------------------------------------------------- activity (who did what) */
async function refreshActivity(): Promise<void> {
  let act: ActivityEntry[];
  try { act = (await call('ui_activity')).activity || []; } catch (e) { return; }
  const now = Date.now() / 1000;
  activityView.n++;
  activityView.rows = act.slice().reverse().map((e) => {
    const ago = Math.max(0, Math.round(now - e.time));
    const when = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`;
    return { entry: e, when };
  });
  const agentCalls = act.filter((e) => e.source === 'agent').length;
  activityView.count = agentCalls ? `${agentCalls} agent call${agentCalls > 1 ? 's' : ''}` : '';
  const last = act[act.length - 1];
  const showing = leftSide.open && leftSide.pane === 'activity';
  if (last && last.source === 'agent' && last.time > leftSide.seen && S.lastActivity && !showing) activityView.dot = true;
  changed(activityView);
  if (showing && last) leftSide.seen = last.time;
  if (last && last.time > S.lastActivity) {
    if (last.source === 'agent' && S.lastActivity && !actions.chatBusy()) toast(`Agent: ${last.tool}`, true);
    S.lastActivity = last.time;
  }
}

/* The panel's head names the file like Figma does: the name (double-click renames it, like a layer) and, beside it,
   the chevron button with the file's menu. The name is the file's own (what its tab shows). */
export function updateDocHead(): void {
  // The DocName component leaves the text alone while it is being renamed (the old `input.rename` check).
  docView.name = activeTabName();
  changed(docView);
}

/* ---------------------------------------------------------------- pixel-art preview (rendered by the engine) */
let previewTimer: ReturnType<typeof setTimeout> | undefined;
export function schedulePreview(): void {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const r = await call('render_view', { yaw: S.previewYaw, pitch: S.previewPitch, scale: S.previewScale, frame: S.frame });
      if (r.images && r.images[0]) {
        // The Preview component sizes the picture when it has loaded (the old img.onload).
        previewView.src = r.images[0];
        changed(previewView);
      }
    } catch (e) { /* the preview is optional */ }
    const names: Record<string, string> = { '45,30': 'iso', '0,0': 'front', '90,0': 'right', '180,0': 'back', '270,0': 'left' };
    chipsView.pview = S.previewPitch === 0 && S.previewYaw % 360 === 0 ? 'front' : 'iso';
    chipsView.previewAngle = names[`${S.previewYaw % 360},${S.previewPitch}`] || `${S.previewYaw % 360}°`;
    changed(chipsView);
  }, 120);
}
