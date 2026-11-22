/* Which page fills the window.
   `ui.view` says it: the editor, the home screen or the New file page. Nothing sets `hidden` on #home or #newpage by
   hand any more: library/Home shows itself while ui.view is 'home', library/NewPage while it is 'new', and App puts
   the view on <body data-view>. So a function that changed pages (showHome, openNewPage, showEditor) sets ui.view
   and calls changed(ui) where the old one set `hidden` and called renderTabs().
   showHome(), hideHome(), openNewPage() and closeNewPage() belong to the library (actions.showHome, …). */
import { actions } from './actions';
import { closeMenus } from '../kit/menus';
import { changed } from '../lib/store';
import { S, ui } from '../state/ui';

export function hidePages(): void {
  // #home and #newpage hide themselves: the caller sets ui.view and calls changed(ui).
  actions.stopAgentsPolling();
  closeMenus();
}

/** Shows the active file's editor (the home screen when no file is open). */
export function showEditor(): void {
  if (ui.active == null) { actions.showHome(); return; }
  const was = ui.view;
  ui.view = 'editor'; S.home = false;
  hidePages();
  actions.redraw();
  if (was !== 'editor') requestAnimationFrame(() => { if (S.mode === 'slice') actions.fitSlice(); });
  changed(ui); // was renderTabs(): the tab bar, <body data-view> and the pages follow ui
}
