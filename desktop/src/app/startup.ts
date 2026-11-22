/* Startup: what ran at the top level and at the end of app.js, in the old order (app.js 4344–4356, 3124–3270).
   main.tsx calls prepare() before the first render and start() right after it. */
import { actions, missingActions } from './actions';
import { showEditor } from './pages';
import { adoptTitles, installKit } from '../kit';
import { flags, platform, SCREENSHOT } from '../lib/host';
import { installPC } from '../lib/pc';
import { ui } from '../state/ui';
import { loadUiTest, registerKitCompat } from '../testing/compat';

/** Before anything renders: the classes on <html>, the kit's window and document listeners, window.PC. */
export function prepare(): void {
  // A --screenshot picture is of the page alone: it paints the glass's colour itself, so the picture looks like the
  // window wherever it was on screen (or behind another app).
  if (SCREENSHOT) document.documentElement.classList.add('screenshot');
  document.documentElement.dataset.platform = platform; // platform.css
  installKit();
  installPC();
  registerKitCompat();
}

/** After the first render: the areas start (in the order wire() started them), then the first refresh decides
 *  between the home screen and the editor. Resolves once the page is ready (the old stateReady). */
export async function start(): Promise<void> {
  // Give icon-only buttons their accessible names right away (titles move to data-tip on first hover anyway).
  adoptTitles();
  if (import.meta.env.DEV) {
    const missing = missingActions();
    if (missing.length) console.info(`actions not registered yet (${missing.length}): ${missing.join(', ')}`);
  }
  actions.initEditor();
  actions.initLibrary();
  actions.initChat();
  const ready = actions.refresh().then(async () => {
    if (flags.start === 'home' || ui.active == null) await actions.showHome(); else showEditor();
    actions.editorReady();
  });
  loadUiTest();
  await ready;
}
