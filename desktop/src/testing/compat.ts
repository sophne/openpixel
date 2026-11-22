/* The old UI test against the React page.
   app/web/uitest.js (59 cases) was written for app.js: one classic script whose functions and variables are globals
   of the page, which the test calls and reads by name (S, ui, $, call, refreshing, setMode, sv, …). The React page
   has no such globals, so each area publishes the names it owns with registerCompat(), as values or as getters and
   setters over its module variables. They are collected on window.__OP, and the test is run inside
   `with (window.__OP) { … }`, so every free name in it finds the live value. Nothing else reads __OP.

   UITEST_NAMES below is every app.js name uitest.js uses (worked out from the two files) and the area that must
   register it; DEMO_NAMES is the same for demo.js. */
import { flags, post, bridge, call, nativeAction, overrides } from '../lib/host';
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
  glCanvas: 'editor', sliceCanvas: 'editor', sctx: 'editor', sv: 'editor', cam: 'editor', viewProj: 'editor', resetCamera: 'editor',
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

/** Publishes names for the old scripts: plain values, or getters and setters for module variables:
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
    changed, flush, // not in the old page: for poking at stores from the console or a test
    // `const real = nativeAction; nativeAction = async () => true; …; nativeAction = real;`
    get nativeAction() { return nativeAction; },
    set nativeAction(fn: typeof nativeAction) { overrides.nativeAction = fn === nativeAction ? null : fn; },
    get lastInput() { return lastInput; },
    set lastInput(v: 'pointer' | 'key') { setLastInput(v); },
  });
}

/** Runs a classic script written for app.js (uitest.js, demo.js) with the published names in scope.
 *  The script's own 'use strict' no longer counts (it is not the first statement any more), which `with` needs.
 *  This compiles text, so the page's Content-Security-Policy must allow it (the shipped page does not: see the
 *  README for how the shell runs the test instead). */
export function runLegacyScript(text: string): void {
  // eslint-disable-next-line no-new-func
  new Function('__OP', `with (__OP) {\n${text}\n}`)(names());
}

/** Where the test's text comes from, until the shell decides: `script` (the text itself) or `url` on the uitest
 *  flag (flags.uitest, the old window.OPENPIXEL_UITEST), or window.__OP_UITEST = { text } | { url }. */
function uitestSource(): { text?: string; url?: string } | null {
  const hook = (window as unknown as { __OP_UITEST?: { text?: string; url?: string } }).__OP_UITEST;
  if (hook && (hook.text || hook.url)) return hook;
  const cfg = (flags.uitest || {}) as { script?: unknown; url?: unknown };
  if (typeof cfg.script === 'string') return { text: cfg.script };
  if (typeof cfg.url === 'string') return { url: cfg.url };
  return null;
}

/** In UI-test mode: fetches uitest.js and runs it against this page. Does nothing in normal use, and nothing when
 *  no source was given (then the shell injects the wrapped script itself). Returns true when the test was started. */
export async function loadUiTest(): Promise<boolean> {
  if (!flags.uitest) return false;
  const missing = missingCompat();
  if (missing.length) console.warn(`UI test: ${missing.length} names are not published yet: ${missing.join(', ')}`);
  const src = uitestSource();
  if (!src) return false;
  try {
    const text = src.text != null ? src.text : await (await fetch(src.url as string)).text();
    runLegacyScript(text);
    return true;
  } catch (e) {
    // Not started (the text could not be fetched or compiled): say so, or the run would wait forever.
    post({ kind: 'uitestDone', report: { crashed: `the UI test could not be started: ${errorText(e)}`, results: [] } });
    return false;
  }
}
