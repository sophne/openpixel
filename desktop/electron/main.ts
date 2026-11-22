import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, screen, session, shell, type IpcMainInvokeEvent } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import type { Host, PlatformUI } from '../host/platform';
import { createAppHost } from './host';
import { buildMenu } from './menu';

/* The editor window: a native window whose whole content is the editor page. This file is the shell of
   docs/desktop-architecture.md: it owns the window, the menus, dialogs, the clipboard and screenshots (the
   Electron half of `Platform`), and hands every other message of the page to the app's logic (desktop/host),
   which runs in this process on the core's WebAssembly build. */

// ---------------------------------------------------------------- command line

interface Args {
  file?: string;        // a model to open
  screenshot?: string;  // --screenshot out.png: open, let the page draw ~120 frames, save the window's picture, quit
  uitest?: string;      // --ui-test <folder>: the page clicks through itself; pictures and report.json land there
  record?: string;      // --record <folder>: where a demo's frames are saved
  demo?: string;        // --demo <config.json>: the page plays tests/demo.js (a recording for the website)
}

function parseArgs(argv: string[], cwd = process.cwd()): Args {
  const list = argv.slice(1);
  // Started as `electron [switches] <app folder> …`, the first plain word is this app, not a file to open.
  if (!app.isPackaged) {
    const i = list.findIndex((a) => !a.startsWith('-'));
    if (i >= 0) list.splice(i, 1);
  }
  const out: Args = {};
  const valued: Record<string, 'screenshot' | 'uitest' | 'record' | 'demo'> =
    { '--screenshot': 'screenshot', '--ui-test': 'uitest', '--record': 'record', '--demo': 'demo' };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (valued[a]) { if (i + 1 < list.length) out[valued[a]] = path.resolve(cwd, list[++i]); }
    // Everything else that starts with a dash is Chromium's or Electron's own switch.
    // Linux launchers may hand a file over as an address (file:///…).
    else if (!a.startsWith('-') && !out.file) out.file = a.startsWith('file://') ? fileURLToPath(a) : path.resolve(cwd, a);
  }
  return out;
}

const args = parseArgs(process.argv);
/** Screenshot and UI-test runs never take the focus, never show a dialog and never ask to save. */
const headless = !!(args.screenshot || args.uitest);
/** What the page is told it runs on. Tests set OPENPIXEL_PLATFORM to see another system's layout and wording. */
const platform = (['darwin', 'win32', 'linux'] as const).find((p) => p === (process.env.OPENPIXEL_PLATFORM || process.platform)) ?? 'linux';
const mac = process.platform === 'darwin';
/** Windows and Linux draw their window buttons over the page's tab bar; a pretended Mac leaves the bar alone. */
const overlay = !mac && platform !== 'darwin';

/** Height of the page's tab bar (`--tabs-h` in style.css), which doubles as the window's title bar. */
const TAB_BAR_HEIGHT = 38;
/** The dark glass the Mac window shows behind the page (`html.screenshot` in style.css paints the same colour). */
const GLASS = '#2b2b2e';

const desktopFolder = path.join(__dirname, '..');
const devURL = process.env.OPENPIXEL_DEV_URL;
/** The page as `npm run build` leaves it. */
const pageFile = path.join(desktopFolder, 'dist', 'index.html');
/** The folder the page was loaded from; the window never shows or reads anything outside it. */
let pageFolder = path.dirname(pageFile);

/** Progress notes on stderr during --screenshot and --ui-test runs. */
function trace(s: string): void {
  if (headless) process.stderr.write(`[${args.uitest ? 'ui-test' : 'screenshot'}] ${s}\n`);
}

// ---------------------------------------------------------------- before the app is ready

app.setName('OpenPixel');
// The app is dark, so its glass, dialogs and window buttons are too.
nativeTheme.themeSource = 'dark';

// Linux CI has no graphics card: Chromium's software renderer gives the page its WebGL.
if (process.env.OPENPIXEL_SOFTWARE_GL === '1') {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
}

/** Checks and tests start from the app's defaults (sidebar open, panel widths), not from what the person set, and
    run next to an open OpenPixel: their browser profile is a throwaway folder. */
let throwaway: string | undefined;
if (headless) {
  throwaway = mkdtempSync(path.join(os.tmpdir(), 'openpixel-check-'));
  app.setPath('userData', path.join(throwaway, 'profile'));
} else if (!app.requestSingleInstanceLock()) {
  // OpenPixel is already open: it got our file through `second-instance`.
  app.exit(0);
}

// ---------------------------------------------------------------- state

let win: BrowserWindow | null = null;
let host: Host | null = null;
/** Files the system handed over before the app's logic was running. */
const pendingOpens: string[] = [];
let flags: { start: 'home' | 'editor'; uitest?: { folder: string }; screenshot?: boolean; demo?: unknown } = { start: 'home' };
/** True once the window may really close: everything is saved, or the person chose to lose it. */
let closing = false;

// ---------------------------------------------------------------- the page

/** Runs `window.PC.<fn>(...args)` in the page, when the page is there and has that function. */
function callPage(fn: string, args: unknown[] = []): Promise<unknown> {
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed() || !/^[A-Za-z_$][\w$]*$/.test(fn)) return Promise.resolve(undefined);
  // Arguments travel as JSON, which is JavaScript too.
  const list = args.map((a) => JSON.stringify(a) ?? 'null').join(', ');
  return wc.executeJavaScript(`window.PC && PC.${fn} ? PC.${fn}(${list}) : undefined`).catch((e) => {
    console.error(`PC.${fn} failed: ${e?.message ?? e}`);
  });
}

/** The page holds the bridge to the app, so it may only show OpenPixel's own page: no web pages, no other local
    files, no new windows. Links the page opens go through the host's `openLink`. */
function isOwnPage(url: string): boolean {
  try {
    const u = new URL(url);
    if (devURL) return u.origin === new URL(devURL).origin;
    if (u.protocol !== 'file:') return false;
    let p = fileURLToPath(u);
    try { p = realpathSync(p); } catch { /* not there: compare the name as it is */ }
    return p.startsWith(pageFolder + path.sep);
  } catch { return false; }
}

/** What the page may fetch: its own files, plus, while developing, Vite's server and the developer tools. */
function isOwnRequest(url: string): boolean {
  if (/^(data|blob|devtools|chrome-devtools):/.test(url)) return true;
  if (devURL && /^wss?:/.test(url)) return new URL(url).host === new URL(devURL).host;
  return isOwnPage(url);
}

// ---------------------------------------------------------------- the window

function createWindow(): void {
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(1440, area.width - 40),
    height: Math.min(900, area.height - 40),
    minWidth: 980,
    minHeight: 620,
    center: true,
    show: false,
    title: 'OpenPixel',
    // The page's tab bar is the title bar (like Figma): the content runs to the window's top edge.
    ...(mac ? {
      // The close, minimise and zoom buttons sit in the tab bar, centred in its height: they are 16 pt tall, so
      // 11 pt from the top puts their middle on the bar's (19 pt), the line of Home, the tabs and +. The page's
      // tab bar leaves room for them up to 80px.
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: (TAB_BAR_HEIGHT - 16) / 2 },
      // Liquid Glass: the window's chrome is one sheet of the system's translucent sidebar glass, the desktop
      // blurred through it; the page draws only the solid content sheets and floating glass on top.
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
      backgroundColor: '#00000000',
    } : {
      // No glass here: the window is opaque in the glass's colour and the page paints it too (`html.screenshot`).
      titleBarStyle: 'hidden' as const,
      ...(overlay ? { titleBarOverlay: { color: GLASS, symbolColor: '#e8e8e8', height: TAB_BAR_HEIGHT } } : {}),
      backgroundColor: GLASS,
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // Developer tools only in development; the installed app doesn't expose the page's internals.
      devTools: !app.isPackaged,
    },
  });
  const w = win, wc = w.webContents;
  showTitle();

  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-redirect'] as const) {
    wc.on(event as 'will-navigate', (e, url) => {
      if (isOwnPage(url)) return;
      console.error(`OpenPixel: blocked navigation to ${url}`);
      e.preventDefault();
    });
  }
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _permission, answer) => answer(false));
  wc.session.webRequest.onBeforeRequest((details, answer) => {
    const ok = isOwnRequest(details.url);
    if (!ok) console.error(`OpenPixel: blocked request to ${details.url}`);
    answer({ cancel: !ok });
  });

  // The title is the host's (`setTitle`), not the page's <title>.
  w.on('page-title-updated', (e) => e.preventDefault());
  // Full screen hides the window buttons, so the page's tab bar starts at the edge.
  w.on('enter-full-screen', () => callPage('fullScreen', [true]));
  w.on('leave-full-screen', () => callPage('fullScreen', [false]));
  w.on('close', (e) => { if (!closing) { e.preventDefault(); askToQuit(); } });
  w.on('closed', () => { win = null; });
  // Checks must never take the focus from what the person is doing.
  w.once('ready-to-show', () => { if (headless) w.showInactive(); else w.show(); trace('window shown'); });

  // A new document has none of the CSS added to the last one; the tab bar moves the window from the start.
  wc.on('did-start-navigation', (details) => { if (details.isMainFrame && !details.isSameDocument) titlebarCSS = undefined; });
  wc.on('dom-ready', () => setTitlebar(true));
  wc.on('did-finish-load', () => {
    if (args.uitest) runScriptInPage(wc, 'uitest.js').catch((e: Error) => finishUITest({ error: `the UI test could not be started: ${e.message}` }));
    else if (args.demo) runScriptInPage(wc, 'demo.js').catch((e: Error) => console.error(`--demo: ${e.message}`));
  });
  wc.on('render-process-gone', (_e, details) => {
    console.error(`OpenPixel: the page stopped (${details.reason})`);
    if (args.uitest) finishUITest({ error: `the page stopped (${details.reason})` });
  });

  if (args.demo && !headless) {
    // A demo recording: the size of the website's window shots, kept above other windows so it is never covered.
    w.setContentSize(1440, 855);
    w.center();
    w.setAlwaysOnTop(true, 'floating');
  }

  trace(`loading ${devURL ?? pageFile}`);
  if (devURL) wc.loadURL(devURL); else wc.loadFile(pageFile);
}

/* The UI test (tests/uitest.js: the page clicks through itself) and the demo player (tests/demo.js) are plain
   scripts that use the page's own functions and state by name. The page publishes those names on window.__OP
   (src/testing/compat.ts) and the script runs with them in scope. The page's content policy forbids it compiling
   text itself, so the shell hands the script over. Development and tests only: the scripts are in the repository,
   not in the installed app. */
async function runScriptInPage(wc: Electron.WebContents, name: 'uitest.js' | 'demo.js'): Promise<void> {
  // The shell's own test (tests/shell-smoke.mjs) has no engine to run the UI test on: it names a stand-in.
  const standIn = name === 'uitest.js' && !app.isPackaged ? process.env.OPENPIXEL_UI_TEST_SCRIPT : undefined;
  const file = standIn ? path.resolve(standIn) : path.join(desktopFolder, 'tests', name);
  if (!existsSync(file)) throw new Error(`${file} is not there (it is not part of the installed app)`);
  const text = readFileSync(file, 'utf8');
  // The page's modules have run once it has published its names and the host's calls can reach it.
  for (let i = 0; i < 200 && !(await wc.executeJavaScript('!!(window.__OP && window.PC)')); i++) await sleep(50);
  await wc.executeJavaScript(`with (window.__OP) {\n${text}\n}\n;undefined`);
  trace(`${path.basename(file)} started in the page`);
}

/* The tab bar is the window's title bar: its empty parts move the window. Chromium's app regions do it: the bar
   drags, everything in it is left to the page. The page also reports where its controls are (`titlebar`: the x
   ranges of Home, the tabs, + and the buttons on the right); each of them is one of the bar's own children, so the
   rule below covers them (the strip of tabs counts as a whole, which only takes the 4px gaps between tabs out of
   the dragging area). While a dialog covers the bar (`drag: false`) nothing drags, so a click on its backdrop still
   closes it. */
let titlebarCSS: { drag: boolean; key: Promise<string> } | undefined;
function setTitlebar(drag: boolean): void {
  const wc = win?.webContents;
  if (!wc || wc.isDestroyed() || titlebarCSS?.drag === drag) return;
  const css = drag
    ? '#tabbar { -webkit-app-region: drag; } #tabbar > *, #tabbar button, #tabbar .tab { -webkit-app-region: no-drag; }'
    : '#tabbar, #tabbar * { -webkit-app-region: no-drag; }';
  const old = titlebarCSS;
  // The new rules go in before the old ones come out, so the bar is never without either.
  titlebarCSS = { drag, key: wc.insertCSS(css) };
  titlebarCSS.key.catch(() => {});
  old?.key.then((key) => wc.removeInsertedCSS(key)).catch(() => {});
}

// ---------------------------------------------------------------- messages from the page

/** Everything the page posts. The shell answers only what needs the window itself; the rest is the host's. */
async function fromPage(msg: Record<string, unknown>): Promise<unknown> {
  const kind = msg?.kind;
  if (typeof kind !== 'string') throw new Error('bad message');
  if (kind === 'native' && msg.action === 'titlebar') { setTitlebar(msg.drag !== false); return true; }
  // Electron has no haptic feedback: the page's request for a trackpad tick is answered and nothing happens.
  if (kind === 'native' && msg.action === 'haptic') return true;
  switch (kind) {
    case 'snap': {
      // UI test: save a picture of the window under a name, then answer.
      const name = String(msg.name ?? 'snap').replace(/[/\\]/g, '-');
      // Previews and thumbnails arrive a moment after the change that asked for them (debounced, then drawn by the
      // core). Pictures meant to be looked at want the page at rest, so a run can ask for a pause before each one.
      const settle = Number(process.env.OPENPIXEL_SNAP_SETTLE_MS) || 0;
      if (args.uitest && settle > 0) await new Promise((r) => setTimeout(r, Math.min(settle, 2000)));
      if (args.uitest) await writeFile(path.join(args.uitest, `${name}.png`), await capture()).catch((e) => trace(`snap ${name} failed: ${e.message}`));
      return true;
    }
    case 'resizeWindow': {
      const width = typeof msg.width === 'number' ? msg.width : 1440, height = typeof msg.height === 'number' ? msg.height : 900;
      win?.setContentSize(Math.round(width), Math.round(height));
      await sleep(400);
      return true;
    }
    case 'uitestDone':
      // After this answer is on its way: the report is the last thing the run does.
      setImmediate(() => finishUITest((msg.report as Record<string, unknown>) ?? {}));
      return true;
    case 'frames':
      trace(`page drew ${msg.count ?? 0} frames`);
      if (args.screenshot) setImmediate(saveScreenshotAndQuit);
      return true;
    case 'demo':
      return demoMessage(msg);
    default:
      if (!host) throw new Error('OpenPixel engine is not connected');
      return host.handle(msg as Record<string, unknown> & { kind: string });
  }
}

function fromOurPage(e: IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const frame = e.senderFrame;
  return !!win && !!frame && e.sender === win.webContents && frame === win.webContents.mainFrame && isOwnPage(frame.url);
}

ipcMain.on('openpixel:hello', (e) => {
  if (!fromOurPage(e)) { e.returnValue = null; return; }
  const classes = [`platform-${platform}`];
  // Without the Mac's glass behind it the page paints the glass's colour itself, as it does for pictures.
  if (platform !== 'darwin') classes.push('screenshot');
  e.returnValue = { platform, flags, classes };
});

// Failures travel as a value: an error thrown here would reach the page with Electron's own words around it.
ipcMain.handle('openpixel:post', async (e, msg) => {
  if (!fromOurPage(e)) return { ok: false, error: 'not allowed' };
  try { return { ok: true, result: await fromPage(msg) }; }
  catch (err) { return { ok: false, error: String((err as Error)?.message ?? err) }; }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The window's page as a PNG, as the person sees it. */
async function quickCapture(): Promise<Buffer> {
  if (!win || win.isDestroyed()) throw new Error('window closed');
  return (await win.webContents.capturePage()).toPNG();
}

async function capture(): Promise<Buffer> {
  if (!win || win.isDestroyed()) throw new Error('window closed');
  const wc = win.webContents;
  // capturePage() hands back the last frame the compositor kept, which can be older than what the page shows now
  // (seen with software rendering: a checkpoint pictured the screen before it). Asking the page itself for a
  // screenshot draws a fresh frame first, so that is tried first.
  try {
    const mine = !wc.debugger.isAttached();
    if (mine) wc.debugger.attach('1.3');
    try {
      const shot = await wc.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }) as { data: string };
      return Buffer.from(shot.data, 'base64');
    } finally {
      if (mine) try { wc.debugger.detach(); } catch { /* already gone */ }
    }
  } catch {
    // Something else holds the page's debugger (its developer tools): the compositor's frame, after two paints.
    await Promise.race([
      wc.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))').catch(() => false),
      new Promise((r) => setTimeout(r, 500)),
    ]);
    if (!win || win.isDestroyed()) throw new Error('window closed');
    return (await wc.capturePage()).toPNG();
  }
}

// ---------------------------------------------------------------- the window's half of Platform

/** What the app's logic asks of the window and the system around it (`PlatformUI` in desktop/host/platform.ts).
    Screenshot and UI-test runs never show a dialog: panels answer as if cancelled, questions as "don't save". */
const ui: PlatformUI = {
  async openPanel({ extensions }) {
    if (headless) return null;
    const o: Electron.OpenDialogOptions = { properties: ['openFile'], filters: [{ name: 'OpenPixel', extensions }, { name: 'All Files', extensions: ['*'] }] };
    const got = await (liveWindow() ? dialog.showOpenDialog(liveWindow()!, o) : dialog.showOpenDialog(o));
    return got.canceled ? null : got.filePaths[0] ?? null;
  },
  async savePanel({ name, extension }) {
    if (headless) return null;
    const o: Electron.SaveDialogOptions = {
      defaultPath: name || undefined,
      filters: extension ? [{ name: extension.toUpperCase(), extensions: [extension] }] : [],
    };
    const got = await (liveWindow() ? dialog.showSaveDialog(liveWindow()!, o) : dialog.showSaveDialog(o));
    return got.canceled ? null : got.filePath || null;
  },
  async askToSave(name) {
    if (headless) return 'discard';
    const got = await messageBox({
      type: 'warning',
      message: `Save changes to “${name}”?`,
      detail: "OpenPixel could not save them by itself. Your changes will be lost if you don't save them.",
      buttons: ['Save…', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    return (['save', 'discard', 'cancel'] as const)[got.response] ?? 'cancel';
  },
  async alert(title, text) {
    if (headless) { trace(`alert: ${title}: ${text}`); return; }
    await messageBox({ message: title || 'OpenPixel', detail: text, buttons: ['OK'] });
  },
  async showUpdateDialog({ version, url, notes }) {
    // Nothing installs by itself: the person gets the new version from the download page.
    if (headless) return;
    const got = await messageBox({
      message: `OpenPixel ${version} is available`,
      detail: [`You have ${app.getVersion()}.`, notes].filter(Boolean).join('\n\n'),
      buttons: url ? ['Download…', 'Later'] : ['OK'],
      defaultId: 0,
      cancelId: url ? 1 : 0,
    });
    if (url && got.response === 0) await ui.openExternal(url);
  },
  copyText(text) {
    clipboard.writeText(text);
  },
  async openExternal(url) {
    // The host chooses the address. Only kinds OpenPixel has a use for can open: web pages and the app links of
    // the Agents page (Cursor's install link); never a local file or another program's scheme.
    if (headless || !/^(https?|cursor):\/\//.test(url)) return false;
    return shell.openExternal(url).then(() => true, () => false);
  },
  reveal(file) {
    if (headless || !file || !existsSync(file)) return false;
    shell.showItemInFolder(file);
    return true;
  },
  // "Delete permanently" in the library: the file goes to the system's Trash (Recycle Bin). Checks delete it
  // outright, so they leave nothing behind in the person's Trash.
  async trash(file) {
    if (headless) rmSync(file, { force: true, recursive: true });
    else await shell.trashItem(file);
  },
  screenshot: () => capture(),
  setTitle(title, file, edited) {
    shown = { title, file, edited };
    showTitle();
  },
  page(fn, ...list) {
    callPage(fn, list);
  },
};

/** The title the host last set; it may come before the window exists. */
let shown: { title: string; file: string | null; edited: boolean } = { title: 'OpenPixel', file: null, edited: false };
function showTitle(): void {
  const w = liveWindow();
  if (!w) return;
  w.setTitle(shown.title);
  // The Mac's title bar knows the file (⌘-click shows where it is) and marks unsaved changes in the close button.
  if (mac) { w.setRepresentedFilename(shown.file ?? ''); w.setDocumentEdited(shown.edited); }
}

const liveWindow = (): BrowserWindow | undefined => (win && !win.isDestroyed() ? win : undefined);
const messageBox = (o: Electron.MessageBoxOptions) => (liveWindow() ? dialog.showMessageBox(liveWindow()!, o) : dialog.showMessageBox(o));

function showError(text: string): void {
  if (headless) { process.stderr.write(`OpenPixel: ${text}\n`); return; }
  messageBox({ type: 'error', message: 'OpenPixel', detail: text, buttons: ['OK'] });
}

/** Something the app cannot run without: say it and quit. */
function fatal(text: string): void {
  closing = true;
  if (headless) process.stderr.write(`OpenPixel: ${text}\n`); else dialog.showErrorBox('OpenPixel', text);
  app.exit(1);
}

// ---------------------------------------------------------------- files from the system

/** A file opened from Finder, Explorer or a second launch. */
function openFromSystem(file: string): void {
  if (!host) { pendingOpens.push(file); return; }
  host.openFile(file);
  const w = liveWindow();
  if (w && !headless) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); }
}
app.on('open-file', (e, file) => { e.preventDefault(); openFromSystem(file); });
app.on('second-instance', (_e, argv, cwd) => {
  const file = parseArgs(argv, cwd).file;
  if (file) openFromSystem(file);
  else if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

// ---------------------------------------------------------------- quitting

/** Closing the window or quitting asks the host first: it saves everything and asks the person about what it
    could not save (`askToSave`). When they cancel, the window stays as it is. */
let asking = false;
async function askToQuit(): Promise<void> {
  if (closing || asking) return;
  if (headless || !host) { reallyQuit(); return; }
  asking = true;
  let ok = true;
  // A host that fails here must not keep the app open for ever.
  try { ok = await host.quitting(); } catch (e) { console.error(`OpenPixel: could not save before quitting: ${(e as Error).message}`); }
  asking = false;
  if (ok) reallyQuit();
}

function reallyQuit(): void {
  closing = true;
  app.quit();
}

app.on('before-quit', (e) => { if (!closing) { e.preventDefault(); askToQuit(); } });
app.on('window-all-closed', () => { closing = true; app.quit(); });
app.on('will-quit', () => {
  try { host?.dispose(); } catch (e) { console.error(`OpenPixel: ${(e as Error).message}`); }
  if (throwaway) try { rmSync(throwaway, { recursive: true, force: true }); } catch { /* the system clears its temporary folder */ }
});

// ---------------------------------------------------------------- UI test and screenshot runs

/** JSON with every object's keys in order, so two reports compare line by line. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}

let uiTestDone = false;
function finishUITest(report: Record<string, unknown>): void {
  if (!args.uitest || uiTestDone) return;
  uiTestDone = true;
  try { writeFileSync(path.join(args.uitest, 'report.json'), JSON.stringify(sorted(report), null, 2) + '\n'); }
  catch (e) { process.stderr.write(`could not write the report: ${(e as Error).message}\n`); }
  trace('report written');
  reallyQuit();
}

let screenshotDone = false;
async function saveScreenshotAndQuit(): Promise<void> {
  if (!args.screenshot || screenshotDone) return;
  screenshotDone = true;
  trace('snapshot requested');
  try {
    const png = await capture();
    trace('snapshot answered');
    mkdirSync(path.dirname(args.screenshot), { recursive: true });
    writeFileSync(args.screenshot, png);
  } catch (e) {
    process.stderr.write(`could not write ${args.screenshot}: ${(e as Error).message}\n`);
    process.exitCode = 1;
  }
  reallyQuit();
}

// ---------------------------------------------------------------- demo recordings (website hero)

const record = { timer: undefined as NodeJS.Timeout | undefined, busy: false, start: 0,
  frames: [] as { n: number; ms: number }[], marks: [] as { name: string; ms: number; frame: number }[] };

/** The page's demo script asks to record at a frame rate, to mark moments, and to stop (with a final picture). */
async function demoMessage(msg: Record<string, unknown>): Promise<unknown> {
  const ms = (): number => Date.now() - record.start;
  switch (msg.action) {
    case 'record': {
      if (!args.record) return false;
      mkdirSync(args.record, { recursive: true });
      if (!record.timer) record.start = Date.now();
      clearInterval(record.timer);
      const fps = Math.max(0.2, typeof msg.fps === 'number' ? msg.fps : 10);
      record.timer = setInterval(recordFrame, 1000 / fps);
      return true;
    }
    case 'mark':
      record.marks.push({ name: String(msg.name ?? ''), ms: ms(), frame: record.frames.length });
      return true;
    case 'stop': {
      clearInterval(record.timer);
      record.timer = undefined;
      record.marks.push({ name: 'stop', ms: ms(), frame: record.frames.length });
      const folder = args.record ?? os.tmpdir();
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ frames: record.frames, marks: record.marks }, null, 2));
      const final = typeof msg.screenshot === 'string' ? msg.screenshot : path.join(folder, 'final.png');
      try { writeFileSync(final, await capture()); } catch (e) { console.error(`demo: no final picture: ${(e as Error).message}`); }
      if (msg.quit !== false) setTimeout(reallyQuit, 500);
      return true;
    }
    default:
      throw new Error('unknown demo action');
  }
}

/** One frame of the recording: the window's page at full resolution. A frame still being saved skips the next. */
async function recordFrame(): Promise<void> {
  if (record.busy || !args.record) return;
  record.busy = true;
  const n = record.frames.length;
  record.frames.push({ n, ms: Date.now() - record.start });
  // A recording takes many pictures a second: the compositor's last frame, which is quick. (capture() asks the page
  // for a fresh one, which is right for single pictures but too slow to keep up with a frame rate.)
  try { await writeFile(path.join(args.record, `f${String(n).padStart(6, '0')}.png`), await quickCapture()); }
  catch { /* the window is closing */ }
  record.busy = false;
}

// ---------------------------------------------------------------- launch

app.whenReady().then(async () => {
  trace('setting up');
  if (!devURL) {
    if (!existsSync(pageFile)) {
      fatal(`OpenPixel could not find its page (${pageFile}). Build it with \`npm run build\`.`);
      return;
    }
    pageFolder = realpathSync(pageFolder);
  }
  if (args.uitest) {
    mkdirSync(args.uitest, { recursive: true });
    // A report left by the last run would look like this run's.
    rmSync(path.join(args.uitest, 'report.json'), { force: true });
  }
  if (args.demo) {
    try { flags.demo = JSON.parse(readFileSync(args.demo, 'utf8')); }
    catch (e) { console.error(`--demo: could not read ${args.demo}: ${(e as Error).message}`); }
  }
  try {
    host = await createAppHost({ ui, uiTest: args.uitest, screenshot: !!args.screenshot, open: args.file,
      desktopFolder, packaged: app.isPackaged, resourcesPath: process.resourcesPath });
  } catch (e) {
    fatal((e as Error).message);
    return;
  }
  for (const file of pendingOpens.splice(0)) host.openFile(file);
  // The page opens on the home screen, or in the editor when a file is open already.
  flags = { ...flags, start: host.start() };
  if (args.uitest) flags.uitest = { folder: args.uitest };
  if (args.screenshot) flags.screenshot = true;
  trace('model ready');

  app.setAboutPanelOptions({ applicationName: 'OpenPixel', applicationVersion: app.getVersion(), copyright: 'Open source.', website: 'https://openpixel.dev' });
  buildMenu({
    page: (fn, ...list) => { callPage(fn, list); },
    host: (msg, quiet) => { host?.handle(msg).catch((e: Error) => { if (!quiet) showError(e.message); }); },
    // ⌘W closes the page's active tab; when the page has nothing to close (or isn't there), the window goes.
    closeTab: () => { callPage('closeActiveTab').then((closed) => { if (closed !== true) win?.close(); }); },
    closeWindow: () => win?.close(),
  });
  trace('menu ready');
  createWindow();
  trace('window built');

  if (args.uitest) setTimeout(() => finishUITest({ error: 'timed out after 300 s' }), 300_000);
  // A page that never reports its frames still gets its picture taken.
  else if (args.screenshot) setTimeout(saveScreenshotAndQuit, 20_000);
});
