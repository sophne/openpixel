/* window.PC: what the app calls on the page (docs/desktop-architecture.md, section 1).
   Everything it reaches for in an area goes through `actions`,
   so each area only has to fill its slots (app/actions.ts) for the app's calls to arrive. */
import { actions } from '../app/actions';
import { showEditor } from '../app/pages';
import { toast } from '../kit/toast';
import { $ } from './dom';
import type { PageCalls } from './host';
import { leftSide, S, ui } from '../state/ui';

/** Clicks a panel button for a shortcut, or says why it can't be used right now. */
export function press(sel: string, whyDisabled?: string): void {
  const b = $<HTMLButtonElement>(sel);
  if (!b) return;
  if (b.disabled) { if (whyDisabled) toast(whyDisabled); return; }
  b.click();
}

export const PC: PageCalls = {
  updateAvailable: (version) => actions.showUpdate(version),
  refresh: (toolName) => {
    // Opening or starting a model from anywhere (menu, home, an agent) leaves the home screen.
    const opened = ['open_model', 'new_model', 'new_sprite'].includes(toolName as string);
    if (opened && ui.view === 'new') ui.newOpen = false;
    actions.refresh().then(() => {
      if (opened && S.home) showEditor();
      else if (ui.view === 'editor' && ui.active == null) actions.showHome();
    });
  },
  showNewDialog: () => { actions.openNewPage(); },
  githubStars: (n) => actions.showStars(n),
  /** Full screen hides the window buttons, so the tab bar starts at the edge. */
  fullScreen(on) { document.body.classList.toggle('fullscreen', !!on); requestAnimationFrame(() => actions.reportTitlebar()); },
  showHome: (view) => actions.showHome(view),
  /** ⌘W: closes the active tab (or the New file page). False when there is nothing to close here. */
  closeActiveTab() {
    if (ui.view === 'new') { actions.closeNewPage(); return true; }
    if (ui.view === 'editor' && ui.active != null) { actions.closeTab(ui.active); return true; }
    return ui.view === 'home';
  },
  showAgentHelp: () => actions.showAgentHelp(),
  chatEvent: (e) => actions.chatEvent(e),
  chatMoved: (from, to) => actions.chatMoved(from, to),
  command(cmd) {
    if (cmd === 'shortcuts') { actions.showShortcuts(); return; }
    if (S.home) return; // editor commands do nothing over the home screen
    // While typing in a field, ⌘⌫ and friends belong to the field, not to the document.
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing && ['deleteLayer', 'deleteFrame', 'duplicateLayer'].includes(cmd)) return;
    if (cmd === 'view3d') actions.setMode('3d');
    else if (cmd === 'viewSlice') actions.setMode('slice');
    else if (cmd === 'resetCamera') { actions.resetCamera(); actions.fitSlice(); }
    else if (cmd === 'review') actions.showReview();
    else if (cmd === 'newLayer') press('#layer-add');
    else if (cmd === 'duplicateLayer') press('#layer-dup');
    else if (cmd === 'mergeDown') press('#layer-merge', 'The bottom layer has nothing to merge into');
    else if (cmd === 'deleteLayer') press('#layer-del', 'A model keeps at least one layer');
    else if (cmd === 'newFrame') press('#frame-add');
    else if (cmd === 'deleteFrame') press('#frame-del', 'An animation keeps at least one frame');
    else if (cmd === 'playStop') actions.togglePlay();
    else if (cmd === 'onion') press('#onion');
    else if (cmd === 'pixelGrid') actions.setPixelGrid(!S.pixelGrid);
    else if (cmd === 'frames') press('#frames-toggle');
    else if (cmd === 'sidebar') actions.setLeftOpen(!leftSide.open);
    else if (cmd === 'zoomIn') actions.zoomStep(1);
    else if (cmd === 'zoomOut') actions.zoomStep(-1);
  },
};

/** Publishes window.PC. Called once at startup, before the first refresh, so no call from the app is lost. */
export function installPC(): void { window.PC = PC; }
