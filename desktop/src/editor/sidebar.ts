/* The left sidebar: rail, panel, file name and the file's menu.
   The rail picks what the panel shows (Layers, Agent Chat or Activity); picking the open one again, the collapse
   button or ⌘\ hides the panel, and any rail button brings it back. Both choices are remembered. */
import { actions } from '../app/actions';
import { $, $$ } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { changed } from '../lib/store';
import { closeMenus, inlineRename, placeMenu, toast } from '../kit';
import { activeTabName, home, leftSide, S, ui, type LibraryFile, type Tab } from '../state/ui';
import { activityView, appView, dirty, leftView } from './core';
import { refresh, updateDocHead } from './engine';

function saveLeftSide(): void {
  try { localStorage.setItem('openpixel.leftSide', JSON.stringify({ pane: leftSide.pane, open: leftSide.open })); } catch (e) { /* not saved */ }
}
export function applyLeftSide(): void {
  appView.leftClosed = !leftSide.open;
  // The rail's buttons and the editor's own panes follow leftView; the chat's pane (#chat-sec, the chat area's
  // component) is shown and hidden here by hand, as before.
  leftView.drawn = true; leftView.open = leftSide.open; leftView.pane = leftSide.pane;
  if (leftSide.open && leftSide.pane === 'activity') { leftSide.seen = S.lastActivity || 0; activityView.dot = false; }
  changed(appView, leftView, activityView, leftSide);
  $$('#left .pane').forEach((s) => { s.hidden = s.dataset.pane !== leftSide.pane; });
  if (leftSide.open && leftSide.pane === 'chat') { $('#chat-dot').hidden = true; actions.openChat(); }
  dirty.render3d = true; dirty.slice = true;
}
export function setLeftOpen(open: boolean): void { leftSide.open = open; applyLeftSide(); saveLeftSide(); }
export function showLeftPane(pane: 'layers' | 'chat' | 'activity'): void {
  if (leftSide.open && leftSide.pane === pane) { setLeftOpen(false); return; }
  leftSide.pane = pane; leftSide.open = true; applyLeftSide(); saveLeftSide();
}

/** Renames a file on disk (by its path, or the one open in tab `tab`), then shows the new name everywhere. */
export async function renameFile(where: { tab?: Tab['id'] | null; path?: string }, name: string): Promise<unknown> {
  const r = await nativeAction('renameFile', { ...where, name });
  if (r !== true) return r;
  await refresh();
  actions.renderTabs(true); updateDocHead();
  if (S.home) await actions.loadHome();
  return true;
}
export function renameDoc(): void {
  const id = ui.active;
  inlineRename($('#doc-name'), activeTabName(), (v) => renameFile({ tab: id }, v));
}
export async function openDocMenu(): Promise<void> {
  const m = $('#doc-menu'), anchor = $('#doc-title');
  if (m.classList.contains('open')) { closeMenus(); return; }
  closeMenus();
  m.querySelector<HTMLElement>('[data-doc="reveal"]')!.hidden = !S.file;
  m.querySelector<HTMLElement>('[data-doc="rename"]')!.hidden = ui.active == null;
  m.querySelector<HTMLElement>('[data-doc="move"]')!.hidden = !S.file;
  placeMenu(m, anchor);
}
export async function docMenuAction(act: string): Promise<void> {
  closeMenus();
  if (act === 'rename') renameDoc();
  else if (act === 'reveal') nativeAction('reveal', { path: S.file });
  else if (act === 'saveAs') nativeAction('saveAs');
  else if (act === 'close') { if (ui.active != null) actions.closeTab(ui.active); }
  else if (act === 'move') {
    const lib = (await nativeAction('library')) || {};
    home.files = lib.files || []; home.folders = lib.folders || [];
    const item = home.files.find((f: LibraryFile) => f.path === S.file);
    if (!item) { toast('This file is not in your library yet'); return; }
    actions.openMoveMenu($('#doc-title'), { type: 'file', item });
  }
}
