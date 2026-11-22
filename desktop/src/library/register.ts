/* What the library gives the other areas (app/actions.ts) and the UI test (testing/compat.ts). Imported by the
   library's components, so the slots and names are filled before the first render. */
import { registerActions } from '../app/actions';
import { nativeAction } from '../lib/host';
import { registerCompat } from '../testing/compat';
import { agentsState, loadAgents, showAgentHelp, showAgentInfo, stopAgentsPolling } from './agents';
import {
  draggingNow, fileById, folderById, hideHome, homePrefs, latestInFolder, loadHome, menus, openCardMenu, openFolder, openMoveMenu, renderHome,
  setHomeLayout, setHomeSort, showHome,
} from './homePage';
import { closeNewPage, openNewFileDialog, openNewPage, renderNewRecents } from './newpage';
import { applyTabs, closeTab, renderTabs, reportTitlebar, showStars, showUpdate, switchTab, titlebarSentNow } from './tabs';

/** Once at startup: is there an update, and how many stars has the repository? */
function initLibrary(): void {
  nativeAction('version').then((v) => { if (v && v.available) showUpdate(v.available); }).catch(() => {});
  nativeAction('githubStars').then(showStars).catch(() => {});
}

registerActions({
  initLibrary, applyTabs, renderTabs, reportTitlebar, closeTab, showHome, hideHome, loadHome, openMoveMenu, showStars,
  openNewPage, closeNewPage, showAgentHelp, showUpdate, stopAgentsPolling,
});

registerCompat({
  // what tests/uitest.js uses
  homePrefs, setHomeLayout, setHomeSort, loadHome, loadAgents, closeNewPage, fileById, folderById, latestInFolder,
  get filterMenu() { return menus.filter; },
  get titlebarSent() { return titlebarSentNow(); },
  // the rest of the library's functions, for the console and for scripts written like the UI test
  get sortMenu() { return menus.sort; },
  get dragging() { return draggingNow(); },
  agentsState, applyTabs, renderTabs, reportTitlebar, switchTab, closeTab, showHome, hideHome, renderHome, openFolder, openCardMenu, openMoveMenu,
  openNewPage, renderNewRecents, openNewFileDialog, showStars, showUpdate, showAgentInfo, showAgentHelp,
});
