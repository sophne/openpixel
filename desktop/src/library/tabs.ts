/* ---------------------------------------------------------------- open files: the tab bar (app.js 1664–1794,
   2373–2386, 3286–3298)
   Like Figma: Home on the left, one tab per open file (each with its own document and undo history in the app),
   and + for the New file page, which shows as a tab of its own while it is open. `ui.view` says what fills the
   window: the editor, the home screen or the New file page.
   The drawing is library/TabBar.tsx: it shows `drawnTabs`, which renderTabs() fills when the bar may change. */
import { actions } from '../app/actions';
import { showEditor } from '../app/pages';
import { closeMenus } from '../kit';
import { $, $$ } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { changed, store, watch } from '../lib/store';
import { S, ui, type DocState, type Tab, type UiState } from '../state/ui';
import { showHome } from './home';

type TabId = Tab['id'];
const tabViews = new Map<TabId, { mode: DocState['mode']; axis: DocState['axis']; slice: number }>(); // per tab: 2D/3D mode, slice axis and position, restored when switching back

export function applyTabs(r: { tabs?: Tab[]; active?: TabId | null } | null | undefined): void {
  if (!r || !Array.isArray(r.tabs)) return;
  ui.tabs = r.tabs; ui.active = r.active == null ? null : r.active;
  for (const id of [...tabViews.keys()]) if (!ui.tabs.some((t) => t.id === id)) tabViews.delete(id);
  changed(ui); // was renderTabs(): see the watch below
}

/** What the tab bar shows: `ui` as it was when renderTabs() last drew. `gen` counts the drawings (0: the markup the
 *  page starts with); every drawing makes the tabs anew, as replaceChildren() did. */
export const drawnTabs = store({ gen: 0, tabs: [] as Tab[], active: null as TabId | null, view: 'editor' as UiState['view'], newOpen: false });

let draggingTab: TabId | null = null, tabsDrawn = '';
export function renderTabs(force?: boolean): void {
  if (force) tabsDrawn = '';
  document.body.dataset.view = ui.view; // styles that depend on the page shown (e.g. the tab bar's right padding)
  const box = $('#tabs');
  if (!box) return;
  // Redrawn only when something changed (refresh runs after every edit; hover and drags must survive it).
  const key = JSON.stringify([ui.tabs, ui.active, ui.view, ui.newOpen]);
  if (draggingTab != null || key === tabsDrawn || box.querySelector('input.rename')) return; // not mid-drag or mid-rename
  tabsDrawn = key;
  Object.assign(drawnTabs, { gen: drawnTabs.gen + 1, tabs: ui.tabs, active: ui.active, view: ui.view, newOpen: ui.newOpen });
  changed(drawnTabs); // TabBar draws, then scrolls the open tab into view and calls reportTitlebar()
}
// Where the old page called renderTabs() after changing `ui`, the code now calls changed(ui) (README, Pages).
watch(ui, () => renderTabs());

/* Tabs reorder by dragging. */
export function tabDragStart(id: TabId): void { draggingTab = id; }
export function tabDragEnd(): void { draggingTab = null; renderTabs(true); }
export function tabDragOver(id: TabId): boolean { return !(draggingTab == null || draggingTab === id); }
export async function tabDrop(id: TabId, after: boolean): Promise<void> {
  const moving = draggingTab;
  draggingTab = null;
  const from = ui.tabs.findIndex((x) => x.id === moving);
  let to = ui.tabs.findIndex((x) => x.id === id) + (after ? 1 : 0);
  if (from < to) to -= 1;
  tabsDrawn = '';
  applyTabs(await nativeAction('moveTab', { id: moving, index: to }));
}

/* The tab bar is the window's title bar: the app moves the window when its empty parts are dragged. It needs to
   know where the controls are (Home, the tabs, +); while a dialog covers the bar, the bar doesn't move the window. */
let titlebarSent = '';
export function titlebarSentNow(): string { return titlebarSent; }
export function reportTitlebar(): void {
  const tabs = $('#tabs');
  if (!tabs) return;
  const holes = [$('#tab-home'), $('#tab-add'), $('#tab-update'), $('#tab-stars'), ...$$('#tabs .tab')]
    .filter((el) => el && !el.hidden).map((el) => { const r = el.getBoundingClientRect(); return [Math.floor(r.left), Math.ceil(r.right)]; });
  const box = tabs.getBoundingClientRect();
  if (tabs.scrollWidth > tabs.clientWidth) holes.push([Math.floor(box.left), Math.ceil(box.right)]);
  const msg = { holes, drag: !$$('.modal-bg.open').length };
  const key = JSON.stringify(msg);
  if (key === titlebarSent) return;
  titlebarSent = key;
  nativeAction('titlebar', msg);
}

export function rememberTabView(): void {
  if (ui.active != null) tabViews.set(ui.active, { mode: S.mode, axis: S.axis, slice: S.slice });
}
function restoreTabView(): void {
  const v = ui.active == null ? undefined : tabViews.get(ui.active);
  if (!v) return;
  S.axis = v.axis;
  S.slice = Math.max(0, Math.min(actions.sliceSize().depth - 1, v.slice));
  actions.setMode(v.mode);
  actions.redraw(); actions.updateSliceLabel();
}
export async function switchTab(id: TabId): Promise<void> {
  closeMenus(); actions.closePicker(); actions.stopPlay();
  if (id !== ui.active) {
    rememberTabView();
    await nativeAction('switchTab', { id });
    await actions.refresh();
    restoreTabView();
  }
  showEditor();
}
export async function closeTab(id: TabId): Promise<void> {
  closeMenus(); actions.stopPlay();
  if (id === ui.active) rememberTabView();
  const r = await nativeAction('closeTab', { id });
  if (!r || r.closed === false) return;
  tabViews.delete(id);
  await actions.refresh();
  restoreTabView();
  if (ui.view === 'editor' && ui.active == null) showHome();
  else renderTabs();
}

/* The two buttons at the right end of the bar. */
export const tabExtras = store({
  /** #stars-count */
  stars: 'Star',
  /** The stars button's tooltip and name; null until the first count (or its absence) arrives. */
  starsTip: null as string | null,
  /** The update button shows. */
  update: false,
  updateSay: 'Update OpenPixel',
});

/* GitHub stars at the right end of the tab bar: the app keeps the last count and refreshes it from GitHub at most
   hourly (PC.githubStars); clicking opens the repository. */
function starsText(n: unknown): string {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return 'Star';
  const short = (v: number, unit: string) => `${(Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, '')}${unit}`;
  return n < 1000 ? String(n) : n < 1e6 ? short(n / 1000, 'K') : short(n / 1e6, 'M');
}
export function showStars(n: unknown): void {
  tabExtras.stars = starsText(n);
  tabExtras.starsTip = typeof n === 'number' ? `${n.toLocaleString()} ${n === 1 ? 'star' : 'stars'} on GitHub` : 'OpenPixel on GitHub';
  changed(tabExtras);
  requestAnimationFrame(reportTitlebar);
}

/* ---------------------------------------------------------------- updates
   The app asks on every open whether a newer version exists (in the background, nothing is downloaded).
   When there is one, a round download button with an accent dot shows in the tab bar, before the GitHub stars, on
   every page; it opens the app's install dialog. */
export function showUpdate(version: string | null | undefined): void {
  tabExtras.update = !!version;
  if (version) tabExtras.updateSay = `Update to OpenPixel ${version}`;
  changed(tabExtras);
  titlebarSent = ''; reportTitlebar(); // the bar has one more (or one less) control to click
}
