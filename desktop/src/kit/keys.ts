/* Escape, everywhere (the Escape branch of the page's key handler, app.js 3228–3236): it closes the open dialog,
   menu and colour picker; with none of them open it leaves the New file page or the home screen.
   The rest of that handler (tools, frames, zoom…) is the editor's, and starts after this branch. */
import { actions } from '../app/actions';
import { $$ } from '../lib/dom';
import { menuModifier } from '../lib/platform';
import { ui } from '../state/ui';
import { closeMenus, openMenuList } from './menus';
import { closeModals } from './modals';

let installed = false;
export function installKeys(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as Element | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (menuModifier(e)) return; // menu shortcuts are handled by the app's menu bar
    if (e.key !== 'Escape') return;
    if (!$$('.modal-bg.open').length && !openMenuList()) { if (ui.view === 'new') actions.closeNewPage(); else if (ui.view === 'home') actions.hideHome(); }
    closeModals(); closeMenus(); actions.closePicker();
  });
}
