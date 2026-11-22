/* The editor's own state: its constants, and the variables and small objects the editor's functions share.
   S, ui, leftSide and home are in state/ui.ts; here is what only the editor uses.

   The stores below marked "drawn by …" hold what one render…()/update…() function puts on screen: the function
   fills its store and calls changed(store), and the component that reads the store draws exactly that. So a panel
   changes when its function runs, and not whenever S merely differs (a refresh in the middle of a layer drag, a tab
   switch before updateDocHead()). */
import { store } from '../lib/store';
import { errorText } from '../lib/dom';
import { call } from '../lib/host';
import { toast } from '../kit';
import { S } from '../state/ui';
import type { Frame, Layer } from '../state/ui';

// Zoom levels (the classic pixel-editor steps from 1/64 to 64×); the 2D view uses the ones >= 1.
export const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
// Canvas defaults: checkered 16x16 background in (128,128,128)/(192,192,192),
// pixel grid (200,200,200) at opacity 160, onion skin opacity 68 stepping by 28.
export const CHECK = { size: 16, c1: '#808080', c2: '#c0c0c0' };
export const PIXEL_GRID = 'rgba(200,200,200,';
export const ONION = { base: 68, step: 28 };

export const idx = (x: number, y: number, z: number): number => (y * S.sz + z) * S.sx + x;
export const inBounds = (x: number, y: number, z: number): boolean => x >= 0 && y >= 0 && z >= 0 && x < S.sx && y < S.sy && z < S.sz;

export interface ToolDef { id: string; icon: string; name: string; key: string; tip: string; sep?: undefined }
export type ToolEntry = ToolDef | { sep: true };
export const TOOLS: ToolEntry[] = [
  { id: 'pencil', icon: 'pencil', name: 'Pencil', key: 'B', tip: 'Add pixels / voxels' },
  { id: 'eraser', icon: 'eraser', name: 'Eraser', key: 'E', tip: 'Remove from the active layer' },
  { id: 'recolor', icon: 'paintbrush', name: 'Recolour', key: 'R', tip: 'Paint what is already there' },
  { id: 'fill', icon: 'paint-bucket', name: 'Fill', key: 'G', tip: 'Fill connected cells of one colour' },
  { id: 'picker', icon: 'pipette', name: 'Eyedropper', key: 'I', tip: 'Pick a colour (or Alt+click)' },
  { sep: true },
  { id: 'rect', icon: 'square', name: 'Rectangle', key: 'U', tip: 'Drag a filled rectangle' },
  { id: 'line', icon: 'slash', name: 'Line', key: 'L', tip: 'Drag a straight line' },
  { id: 'move', icon: 'move', name: 'Move', key: 'V', tip: 'Move the active layer (arrow keys too)' },
  { id: 'orbit', icon: 'rotate-3d', name: 'Orbit / pan', key: 'H', tip: 'Turn the 3D camera or pan the canvas' },
];
export const TOOL_LIST = TOOLS.filter((t): t is ToolDef => !t.sep);

/* ---------------------------------------------------------------- what the canvases need drawn again */
/** meshDirty, render3dDirty, sliceDirty: the 3D mesh must be rebuilt, the 3D view or the 2D canvas drawn again. */
export const dirty = { mesh: true, render3d: true, slice: true };

/** The 3D camera. */
export const cam = store({ yaw: 45, pitch: 30, dist: 60, tx: 16, ty: 10, tz: 16 });
/** The 2D view: screen pixels per cell and where the picture's corner is. */
export const sv = store({ zoom: 16, panX: 0, panY: 0 });

/* ---------------------------------------------------------------- a stroke in progress */
export type StrokeKind = 'add' | 'erase' | 'recolor' | 'rect' | 'line' | 'move';
export interface Stroke {
  kind: StrokeKind; start: number[]; axis: number; last: number[]; cells: Map<number, number[]>;
  baseComp: Uint8Array; baseAct: Uint8Array; move: number[]; planeValue?: number;
}
/** `stroke`, `spaceDown` and the other `let`s more than one module reads and writes. */
export const live: {
  stroke: Stroke | null;
  /** Space held: dragging pans. */
  spaceDown: boolean;
  /** A zoom gliding to its level, and the wait before a pinch settles. */
  zoomAnim: number;
  settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The row being dragged in the layer list (its layer index), or null. */
  layerDrag: number | null;
  /** The elements hot paths write to (set by their components' refs). */
  cursorChip: HTMLElement | null;
} = { stroke: null, spaceDown: false, zoomAnim: 0, settleTimer: undefined, layerDrag: null, cursorChip: null };

/** The text of the chip that follows the pointer ("x 3  y 4"). Written straight to the element: it changes on every
 *  pointer move. */
export function setCursorChip(text: string): void {
  if (live.cursorChip) live.cursorChip.textContent = text;
}

/* ---------------------------------------------------------------- what the old render functions drew */
/** #app's classes: frames-closed (setFramesOpen), left-closed (applyLeftSide), mode-slice (setMode). */
export const appView = store({ framesClosed: false, leftClosed: false, modeSlice: false });
/** Drawn by buildTools() and setTool(): the toolbar exists, and which tool is on. */
export const toolsView = store<{ built: boolean; tool: string | null }>({ built: false, tool: null });
/** Drawn by setMode(): which of 2D / 3D is on (null until the first setMode). */
export const modeView = store<{ mode: string | null }>({ mode: null });
/** Drawn by renderPalette() (n counts the redraws: each one builds the swatches anew) and setFg(). */
export const paletteView = store<{ n: number; palette: string[]; fg: number }>({ n: 0, palette: [], fg: 0 });
/** Drawn by updateFg(): the current colour's swatches and index. */
export const fgView = store<{ hex: string | null; index: string }>({ hex: null, index: '' });
/** Drawn by renderLayers() (n counts the redraws). */
export const layersView = store<{ n: number; layers: Layer[]; layer: number; isSprite: boolean | undefined }>({ n: 0, layers: [], layer: 0, isSprite: undefined });
/** Drawn by renderFrames() (n counts the redraws). */
export const framesView = store<{ n: number; frames: Frame[]; frame: number }>({ n: 0, frames: [], frame: 0 });
/** Frame previews by frame index, as the engine rendered them. */
export const thumbs: Record<number, string> = {};
/** Drawn by the rest of updatePanels(): which buttons are off, and the onion chip. */
export const panelsView = store({ undoOff: false, redoOff: false, onion: false, layerDelOff: false, layerMergeOff: false, frameDelOff: false });
/** Drawn by updateViewPanel(). Starts as the static markup had it. */
export const viewPanel = store<{
  sliceHidden: boolean; spriteHidden: boolean; twoDHidden: boolean; ghostHidden: boolean; threeDHidden: boolean;
  axis: string | null; sliceIndex: string; zoomLabel: string; ortho: boolean | null;
}>({ sliceHidden: false, spriteHidden: false, twoDHidden: false, ghostHidden: false, threeDHidden: false, axis: null, sliceIndex: '0', zoomLabel: '', ortho: null });
/** Drawn by updateInfoChip(). */
export const infoView = store({ text: '' });
/** The chips and segments a click turns on and off by itself (wire()): they start as the static markup had them. */
export const chipsView = store<{
  pixelGrid: boolean; ghost: boolean; edges: boolean; grid: boolean; mirror: { x: boolean; y: boolean; z: boolean };
  pview: string | null; pscale: number | null; previewAngle: string; brush: string;
}>({ pixelGrid: true, ghost: true, edges: true, grid: true, mirror: { x: false, y: false, z: false }, pview: null, pscale: null, previewAngle: 'iso', brush: '1' });
/** Drawn by setFramesOpen(): the fold button of the Frames bar. */
export const framesBar = store({ open: true, title: 'Hide frames (F)' });
/** Drawn by togglePlay() and stopPlay(): the play button. */
export const playView = store({ playing: false });
/** Drawn by schedulePreview() and applyState(): the engine's picture in the Preview panel. */
export const previewView = store<{ src: string | undefined }>({ src: undefined });
/** Drawn by updateDocHead(): the file's name in the panel head. */
export const docView = store({ name: '' });
/** Drawn by applyLeftSide(): the rail's open button and the pane that shows. Starts as the static markup had it. */
export const leftView = store<{ drawn: boolean; open: boolean; pane: string }>({ drawn: false, open: true, pane: 'layers' });
export interface ActivityEntry { tool: string; source: string; ok: boolean; time: number; note?: string }
/** Drawn by refreshActivity() (n counts the redraws) and applyLeftSide() (the dot). */
export const activityView = store<{ n: number; rows: { entry: ActivityEntry; when: string }[]; count: string; dot: boolean }>({ n: 0, rows: [], count: '', dot: false });

/* ---------------------------------------------------------------- tools */
export async function tool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  try { return await call(name, args); } catch (e) { toast(errorText(e)); return null; }
}
export function target(): { layer: number; frame: number } { return { layer: S.layer, frame: S.frame }; }

/* ---------------------------------------------------------------- the slice shown in the 2D view */
export type Axis = 'x' | 'y' | 'z';
export function sliceSize(axis: Axis = S.axis): { cols: number; rows: number; depth: number } {
  if (axis === 'y') return { cols: S.sx, rows: S.sz, depth: S.sy };
  if (axis === 'x') return { cols: S.sz, rows: S.sy, depth: S.sx };
  return { cols: S.sx, rows: S.sy, depth: S.sz };
}
export function sliceCell(col: number, row: number, k: number = S.slice, axis: Axis = S.axis): number[] {
  if (axis === 'y') return [col, k, row];
  if (axis === 'x') return [k, S.sy - 1 - row, col];
  return [col, S.sy - 1 - row, k];
}
