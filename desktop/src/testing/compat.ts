/* How the UI test reaches the page.
   tests/uitest.js (the app's UI test: the page clicks through itself) and tests/demo.js (the recorder for the
   website's demo) are plain scripts that call the page's functions and read its state by name: S, ui, $, call,
   refreshing, setMode, sv, … The page's modules have no globals, so each area publishes the names it owns with
   registerCompat(), as values or as getters and setters over its module variables. They are collected on
   window.__OP, and the shell runs the script inside `with (window.__OP) { … }` (runScriptInPage in
   electron/main.ts), so every free name in it finds the live value. Nothing else reads __OP.

   UITEST_NAMES below is every name of the page uitest.js uses and the area that must register it; DEMO_NAMES is
   the same for demo.js. A script that starts to use another name needs it added here and registered by its area. */
import { flags, bridge, call, nativeAction, overrides } from '../lib/host';
import { $, $$, errorText } from '../lib/dom';
import { lastInput, setLastInput } from '../lib/motion';
import { closeMenus } from '../kit/menus';
import { closeModals, openModal } from '../kit/modals';
import { toast } from '../kit/toast';
import { showEditor } from '../app/pages';
import { changed, flush } from '../lib/store';
import { activeTabName, home, leftSide, S, ui } from '../state/ui';

type Area = 'kit' | 'editor' | 'library' | 'chat';

export const UITEST_NAMES: Record<string, Area> = {
  // kit (registered below)
  $: 'kit', $$: 'kit', bridge: 'kit', call: 'kit', nativeAction: 'kit', closeMenus: 'kit', closeModals: 'kit', openModal: 'kit',
  S: 'kit', ui: 'kit', leftSide: 'kit', home: 'kit', activeTabName: 'kit',
  // editor
  refreshing: 'editor', stateReady: 'editor', render3dDirty: 'editor', ZOOMS: 'editor',
  glCanvas: 'editor', sliceCanvas: 'editor', sctx: 'editor', sv: 'editor', cam: 'editor', viewProj: 'editor', pick3d: 'editor', resetCamera: 'editor',
  setMode: 'editor', setFg: 'editor', setSize: 'editor', setFramesOpen: 'editor', setPixelGrid: 'editor',
  setLeftOpen: 'editor', applyLeftSide: 'editor', closePicker: 'editor',
  // library
  homePrefs: 'library', filterMenu: 'library', titlebarSent: 'library', setHomeLayout: 'library', setHomeSort: 'library',
  loadHome: 'library', loadAgents: 'library', closeNewPage: 'library', fileById: 'library', folderById: 'library', latestInFolder: 'library',
};
/** uitest.js assigns to these two (`nativeAction = async () => true`, `render3dDirty = true`): they need a setter. */
export const UITEST_WRITES = ['nativeAction', 'render3dDirty'];

export const DEMO_NAMES: Record<string, Area> = {
  $: 'kit', bridge: 'kit', nativeAction: 'kit', errorText: 'kit', toast: 'kit', lastInput: 'kit', S: 'kit', leftSide: 'kit', showEditor: 'kit',
  refresh: 'editor', stateReady: 'editor', setMode: 'editor', fitSlice: 'editor', resetCamera: 'editor', setSize: 'editor',
  SIZES: 'editor', applyLeftSide: 'editor',
  chatState: 'chat', readyProviders: 'chat', renderChatPickers: 'chat', renderChatThread: 'chat',
};

declare global {
  interface Window { __OP: Record<string, unknown> }
}

function names(): Record<string, unknown> {
  return window.__OP || (window.__OP = {});
}

/** Publishes names for the scripts: plain values, or getters and setters for module variables:
 *    registerCompat({ setMode, sv, get refreshing() { return refreshing; },
 *                     get render3dDirty() { return render3dDirty; }, set render3dDirty(v) { render3dDirty = v; } });
 *  A later registration of the same name replaces the earlier one. */
export function registerCompat(part: Record<string, unknown>): void {
  const target = names();
  for (const [name, d] of Object.entries(Object.getOwnPropertyDescriptors(part))) {
    Object.defineProperty(target, name, { ...d, configurable: true, enumerable: true });
  }
}

/** The names a script will not find yet, with the area that owes each: `editor: sv`. */
export function missingCompat(wanted: Record<string, Area> = UITEST_NAMES): string[] {
  const have = names();
  return Object.keys(wanted).filter((n) => !(n in have)).map((n) => `${wanted[n]}: ${n}`);
}

/** What the kit owns of both lists. */
export function registerKitCompat(): void {
  registerCompat({
    $, $$, bridge, call, closeMenus, closeModals, openModal, S, ui, leftSide, home, activeTabName,
    errorText, toast, showEditor,
    changed, flush, // for poking at stores from the console or a test
    // `const real = nativeAction; nativeAction = async () => true; …; nativeAction = real;`
    get nativeAction() { return nativeAction; },
    set nativeAction(fn: typeof nativeAction) { overrides.nativeAction = fn === nativeAction ? null : fn; },
    get lastInput() { return lastInput; },
    set lastInput(v: 'pointer' | 'key') { setLastInput(v); },
  });
}

/** In a UI-test or demo run: says in the console which names the script will look for in vain, so a missing
 *  registration shows up as one clear line instead of a ReferenceError somewhere in the middle of the run. */
export function checkCompat(): void {
  const wanted = flags.uitest ? UITEST_NAMES : flags.demo !== undefined ? DEMO_NAMES : null;
  if (!wanted) return;
  const missing = missingCompat(wanted);
  if (missing.length) console.warn(`${flags.uitest ? 'UI test' : 'demo'}: ${missing.length} names are not published: ${missing.join(', ')}`);
}
