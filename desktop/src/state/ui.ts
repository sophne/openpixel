/* The stores more than one area reads or writes, with the old page's names and shapes.
   S: the open document as the engine reports it, and how it is being looked at (app.js 30–41).
   ui: which page fills the window and the open tabs (app.js 1668).
   leftSide: the editor's sidebar (app.js 654–656); the chat reads it to know whether its panel shows.
   home: the library as the app last sent it (app.js 1814); the editor's "Move to…" fills it too.
   Stores that one area alone uses (sv, cam, pk, homePrefs, chatState, agentsState, …) live with that area. */
import { store } from '../lib/store';

export interface Layer { name: string; visible: boolean; locked: boolean; [k: string]: unknown }
export interface Frame { duration_ms: number; [k: string]: unknown }
export interface Onion { frame: number; data: Uint8Array }

export interface DocState {
  sx: number; sy: number; sz: number;
  palette: string[]; rgb: number[][];
  comp: Uint8Array; act: Uint8Array; onion: Onion[];
  layers: Layer[]; frames: Frame[]; layer: number; frame: number; celsFilled: unknown[];
  name: string; file: string | null; dirty: boolean;
  undo: number; redo: number; revision: number;
  fg: number; tool: string; brush: number; mirror: { x: boolean; y: boolean; z: boolean };
  mode: 'slice' | '3d'; axis: 'x' | 'y' | 'z'; slice: number; ghost: boolean; onionOn: boolean;
  edges: boolean; grid: boolean; ortho: boolean;
  /** Lines between pixels on the 2D canvas; remembered between launches. */
  pixelGrid: boolean;
  previewYaw: number; previewPitch: number; previewScale: number;
  playing: boolean; lastActivity: number; hover: any;
  /** Set by applyState: a one-voxel-deep model is a 2D sprite. Undefined until the first state arrives. */
  isSprite?: boolean;
  /** True while the home screen or the New file page covers the editor. Undefined until a page is first shown. */
  home?: boolean;
}

export const S: DocState = store<DocState>({
  sx: 32, sy: 32, sz: 32, palette: [], rgb: [], comp: new Uint8Array(0), act: new Uint8Array(0), onion: [],
  layers: [], frames: [], layer: 0, frame: 0, celsFilled: [], name: '', file: null, dirty: false,
  undo: 0, redo: 0, revision: -1,
  fg: 1, tool: 'pencil', brush: 1, mirror: { x: false, y: false, z: false },
  mode: '3d', axis: 'z', slice: 0, ghost: true, onionOn: false,
  edges: true, grid: true, ortho: false,
  // Lines between pixels on the 2D canvas; remembered between launches.
  pixelGrid: (() => { try { return localStorage.getItem('openpixel.pixelGrid') !== 'off'; } catch (e) { return true; } })(),
  previewYaw: 45, previewPitch: 30, previewScale: 3,
  playing: false, lastActivity: 0, hover: null,
});

/** One open file, as the app's `tabs` action lists it. */
export interface Tab { id: number | string; name: string; kind?: '2d' | '3d' | string; dirty?: boolean; path?: string | null; [k: string]: unknown }
export interface UiState {
  /** What fills the window: the editor, the home screen or the New file page. */
  view: 'editor' | 'home' | 'new';
  tabs: Tab[];
  active: Tab['id'] | null;
  /** The New file page shows as a tab of its own while it is open. */
  newOpen: boolean;
}
export const ui: UiState = store<UiState>({ view: 'editor', tabs: [], active: null, newOpen: false });

/** The panel's head names the file like Figma does: the file's own name (what its tab shows). */
export const activeTabName = (): string => ((ui.tabs || []).find((t) => t.id === ui.active) || ({} as Partial<Tab>)).name || S.name;

/* The rail picks what the panel shows (Layers, Agent Chat or Activity); picking the open one again, the collapse
   button or ⌘\ hides the panel, and any rail button brings it back. Both choices are remembered. */
export interface LeftSide { pane: 'layers' | 'chat' | 'activity'; open: boolean; seen: number }
export const leftSide: LeftSide = store<LeftSide>({ pane: 'layers', open: true, seen: 0 });
try { Object.assign(leftSide, JSON.parse(localStorage.getItem('openpixel.leftSide') || '{}')); } catch (e) { /* defaults */ }
if (!['layers', 'chat', 'activity'].includes(leftSide.pane)) leftSide.pane = 'layers';

/** A file in the library (Recents, folders, the archive, the built-in samples). */
export interface LibraryFile {
  id: string; name: string; path: string; kind?: string; folder?: string | null;
  archived?: boolean; sample?: boolean; exists?: boolean; thumb?: string;
  /** [width, height, depth] in cells (Recents.listForPage). */
  size?: number[];
  [k: string]: any;
}
export interface LibraryFolder { id: string; name: string; parent?: string | null; [k: string]: any }
/** What a card, row or the doc menu's "Move to…" is about. */
export type LibraryTarget = { type: 'file'; item: LibraryFile } | { type: 'folder'; item: LibraryFolder };
export interface HomeState {
  files: LibraryFile[]; folders: LibraryFolder[];
  view: 'recents' | 'folders' | 'archive' | 'agents' | string;
  folder: string | null;
  menuFor: LibraryTarget | null;
  menuAnchor?: Element | { x: number; y: number } | null;
  [k: string]: any;
}
export const home: HomeState = store<HomeState>({ files: [], folders: [], view: 'recents', folder: null, menuFor: null });
