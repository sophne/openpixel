// Smoke test of the Electron shell alone (`npm run test:shell`): the old page from app/web in the real shell, with
// tests/fake-host.mjs standing in for the app's logic (desktop/host) and no core. It checks the shell's side of the
// contract: page → host messages, plain errors, host → page calls, the Platform's dialogs, clipboard, screenshot
// and title, the menu, the navigation lock, quitting, the --ui-test (with a video) and --screenshot runs, and
// demo recording.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { spawnSync } from 'node:child_process';
import { buildShell, desktop, fakeHost, launch, needDisplay, repo, toMp4, until } from './lib.mjs';

needDisplay();

const out = path.join(os.tmpdir(), `openpixel-shell-smoke-${process.pid}`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let failed = 0, passed = 0;
/** The size a window asked for `want` gets on this screen. Some systems keep a window inside the screen's free area
    (macOS: a CI machine's screen is 1024×768), others let it run past; both are right, so both are accepted. */
async function fitted(app, want) {
  const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workAreaSize);
  const got = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  const kept = [Math.min(want[0], area.width), Math.min(want[1], area.height)];
  return got[0] === want[0] && got[1] === want[1] ? want : kept;
}

async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok    ${name}`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${String(e && e.message ? e.message : e).split('\n').join('\n        ')}`); }
}
const exited = (app) => new Promise((resolve) => app.process().once('exit', (code) => resolve(code)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const fake = (extra = {}) => ({ OPENPIXEL_FAKE_HOST: fakeHost, ...extra });

await buildShell();

// ---------------------------------------------------------------- 1. the old page, the Mac layout
console.log('\nold page (app/web), pretending to be a Mac');
{
  const log = path.join(out, 'host-1.jsonl');
  const app = await launch({ args: ['--legacy-ui'], env: fake({ OPENPIXEL_PLATFORM: 'darwin', FAKE_HOST_LOG: log }) });
  const done = exited(app);
  const page = await app.firstWindow();
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  await page.waitForFunction(() => typeof stateReady !== 'undefined' && stateReady, null, { timeout: 30_000 });
  const post = (msg) => page.evaluate((m) => window.openpixel.post(m), msg);

  await check('the page is app/web/index.html, loaded as it is in the repository', async () => {
    assert.equal(page.url(), new URL(`file://${path.join(repo, 'app', 'web', 'index.html')}`).href);
  });
  await check('the preload exposes the contract and nothing of Node or Electron', async () => {
    const seen = await page.evaluate(() => ({
      keys: Object.keys(window.openpixel).sort(), platform: window.openpixel.platform, flags: window.openpixel.flags,
      start: window.OPENPIXEL_START, uitest: typeof window.OPENPIXEL_UITEST, screenshot: typeof window.OPENPIXEL_SCREENSHOT,
      shim: typeof window.webkit.messageHandlers.pc.postMessage, node: [typeof window.require, typeof window.process, typeof window.module, typeof window.Buffer],
      classes: document.documentElement.className,
    }));
    assert.deepEqual(seen.keys, ['flags', 'platform', 'post']);
    assert.equal(seen.platform, 'darwin');
    assert.deepEqual(seen.flags, { start: 'home' });
    assert.equal(seen.start, 'home');
    assert.equal(seen.uitest, 'undefined');
    assert.equal(seen.screenshot, 'undefined');
    assert.equal(seen.shim, 'function');
    assert.deepEqual(seen.node, ['undefined', 'undefined', 'undefined', 'undefined']);
    assert.equal(seen.classes, 'platform-darwin'); // a Mac has its glass: no `screenshot` class
  });
  await check('the host is created with the Electron platform; the page\'s own messages reach it', async () => {
    const all = await post({ kind: 'fake', do: 'log' });
    assert.deepEqual(Object.keys(all[0].created).sort(), ['core', 'mcpCommand', 'open', 'os', 'screenshot', 'uiTest']);
    assert.deepEqual({ ...all[0].created, mcpCommand: path.basename(all[0].created.mcpCommand) },
      { uiTest: null, screenshot: false, open: null, core: null, os: process.platform, mcpCommand: process.platform === 'win32' ? 'openpixel.exe' : 'openpixel' });
    const got = all.map((o) => o.handle && (o.handle.action || o.handle.name));
    for (const want of ['tabs', 'library', 'githubStars', 'version', 'ui_state']) assert.ok(got.includes(want), `${want} missing from ${got}`);
    assert.equal(await page.evaluate(() => document.querySelector('#stars-count').textContent), '1.2K');
    assert.ok((await app.evaluate(({ app }) => app.getPath('userData'))).includes('openpixel-test-profile-'), 'the test runs on its own profile');
    const p = await post({ kind: 'fake', do: 'platform' });
    assert.deepEqual(p.ui, ['alert', 'askToSave', 'copyText', 'openExternal', 'openPanel', 'page', 'reveal', 'savePanel', 'screenshot', 'setTitle', 'showUpdateDialog', 'trash']);
    assert.ok(Math.abs(p.now - Date.now() / 1000) < 5, 'now() is seconds since 1970');
  });
  await check('a failed tool rejects with a plain Error carrying the host\'s text', async () => {
    const e = await page.evaluate(() => window.webkit.messageHandlers.pc.postMessage({ kind: 'tool', name: 'nope', args: {} })
      .then(() => null, (err) => ({ isError: err instanceof Error, message: err.message })));
    assert.deepEqual(e, { isError: true, message: 'fake host: no engine (tool nope)' });
    const bad = await page.evaluate(() => window.openpixel.post('hello').then(() => null, (err) => err.message));
    assert.equal(bad, 'bad message');
  });
  await check('platform.ui.page calls PC.refresh, with any argument intact', async () => {
    await page.evaluate(() => { window.__refreshed = []; const r = PC.refresh; PC.refresh = (t) => { window.__refreshed.push(t); return r(t); }; });
    await post({ kind: 'fake', do: 'refresh', tool: 'set_voxels' });
    await until(() => page.evaluate(() => window.__refreshed.includes('set_voxels')), 'PC.refresh("set_voxels")');
    // Arguments arrive as values, whatever characters they hold.
    await page.evaluate(() => { PC.chatEvent = (e) => { window.__chat = e; }; });
    const odd = { t: 'text', d: 'quote " backslash \\ newline \n </script> \u2028 ünïcode' };
    await post({ kind: 'fake', do: 'page', fn: 'chatEvent', args: [odd] });
    assert.deepEqual(await until(() => page.evaluate(() => window.__chat), 'PC.chatEvent'), odd);
  });
  await check('platform.ui: screenshot is a PNG of the window, copyText fills the clipboard, panels answer', async () => {
    const shot = await post({ kind: 'fake', do: 'ui', method: 'screenshot' });
    const png = PNG.sync.read(Buffer.from(shot.png, 'base64'));
    assert.deepEqual([png.width, png.height], await page.evaluate(() => [innerWidth, innerHeight]));
    assert.equal(await post({ kind: 'native', action: 'copyText', text: 'openpixel smoke' }), true);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'openpixel smoke');
    assert.equal(await post({ kind: 'fake', do: 'ui', method: 'openExternal', args: ['file:///etc/passwd'] }), false);
    assert.equal(await post({ kind: 'fake', do: 'ui', method: 'reveal', args: ['/no/such/file'] }), false);
    // One savePanel round trip: the page's Save, the host's question, the system's panel (answered here), back.
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async (...a) => { globalThis.__savePanel = a[a.length - 1]; return { canceled: false, filePath: file }; };
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      dialog.showMessageBox = async (...a) => { (globalThis.__boxes ??= []).push(a[a.length - 1]); return { response: 1, checkboxChecked: false }; };
    }, path.join(out, 'Saved.openpixel'));
    assert.equal(await post({ kind: 'native', action: 'save' }), true);
    assert.deepEqual(await app.evaluate(() => globalThis.__savePanel), { defaultPath: 'Untitled.openpixel', filters: [{ name: 'OPENPIXEL', extensions: ['openpixel'] }] });
    assert.ok((await post({ kind: 'fake', do: 'log' })).some((o) => o.saved === path.join(out, 'Saved.openpixel')));
    assert.equal(await post({ kind: 'fake', do: 'ui', method: 'openPanel', args: [{ extensions: ['openpixel', 'vox'] }] }), null);
    assert.equal(await post({ kind: 'fake', do: 'ui', method: 'askToSave', args: ['Robot'] }), 'discard');
    await post({ kind: 'fake', do: 'ui', method: 'alert', args: ['Could not open', 'Not a model'] });
    await post({ kind: 'fake', do: 'ui', method: 'showUpdateDialog', args: [{ version: '2.0.0', url: 'https://openpixel.dev/download', notes: 'Faster.' }] });
    const boxes = await app.evaluate(() => globalThis.__boxes);
    assert.equal(boxes[0].message, 'Save changes to “Robot”?');
    assert.deepEqual(boxes[0].buttons, ['Save…', "Don't Save", 'Cancel']);
    assert.deepEqual([boxes[1].message, boxes[1].detail], ['Could not open', 'Not a model']);
    assert.equal(boxes[2].message, 'OpenPixel 2.0.0 is available');
    assert.ok(boxes[2].detail.endsWith('Faster.') && boxes[2].buttons[0] === 'Download…');
  });
  await check('platform.ui.setTitle sets the window\'s title', async () => {
    await post({ kind: 'fake', do: 'title', title: 'OpenPixel — Smoke •', path: null, edited: true });
    await until(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle() === 'OpenPixel — Smoke •'), 'the title');
  });
  await check('the menu: PC.command, PC.showNewDialog, file commands to the host', async () => {
    await page.evaluate(() => {
      window.__commands = []; PC.command = (c) => { window.__commands.push(c); };
      PC.showNewDialog = () => { window.__commands.push('showNewDialog'); };
    });
    const menu = await app.evaluate(({ Menu }) => {
      const flat = [];
      const walk = (m, top) => m.items.forEach((i) => { if (i.submenu) walk(i.submenu, top || i.label); else if (i.type !== 'separator') flat.push({ top: top || i.label, id: i.id, label: i.label, key: i.accelerator || null }); });
      walk(Menu.getApplicationMenu());
      return flat;
    });
    // The app menu (named after the app) comes first on a Mac only; elsewhere its items live in File and Help.
    assert.deepEqual([...new Set(menu.map((i) => i.top))],
      [...(process.platform === 'darwin' ? ['OpenPixel'] : []), 'File', 'Edit', 'View', 'Layer', 'Frame', 'Window', 'Help']);
    const keyOf = (id) => menu.find((i) => i.id === id)?.key;
    assert.equal(keyOf('command:viewSlice'), 'CmdOrCtrl+1');
    assert.equal(keyOf('command:deleteFrame'), 'CmdOrCtrl+Alt+Backspace');
    assert.equal(keyOf('export:png'), 'CmdOrCtrl+Shift+E');
    const commands = menu.filter((i) => i.id && i.id.startsWith('command:')).map((i) => i.id.slice(8));
    assert.deepEqual(commands, ['viewSlice', 'view3d', 'zoomIn', 'zoomOut', 'resetCamera', 'pixelGrid', 'frames', 'sidebar', 'review',
      'newLayer', 'duplicateLayer', 'mergeDown', 'deleteLayer', 'newFrame', 'deleteFrame', 'playStop', 'onion', 'shortcuts']);
    const click = (id) => app.evaluate(({ Menu }, id) => Menu.getApplicationMenu().getMenuItemById(id).click(), id);
    for (const c of commands) await click(`command:${c}`);
    await click('file:new');
    await until(() => page.evaluate(() => window.__commands.length >= 19), 'the menu commands');
    assert.deepEqual(await page.evaluate(() => window.__commands), [...commands, 'showNewDialog']);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' }); });
    await click('export:gif'); await click('edit:undo'); await click('app:checkUpdates');
    await until(async () => {
      const l = (await post({ kind: 'fake', do: 'log' })).map((o) => o.handle).filter(Boolean);
      return l.some((m) => m.action === 'export' && m.format === 'gif') && l.some((m) => m.kind === 'tool' && m.name === 'undo')
        && l.some((m) => m.action === 'checkUpdates');
    }, 'export, undo and checkUpdates at the host');
  });
  await check('⌘W asks the page; the page keeps the window open on the home screen', async () => {
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('file:closeTab').click());
    await sleep(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  });
  await check('the tab bar drags the window, its buttons do not; a dialog turns dragging off', async () => {
    const region = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).getPropertyValue('app-region')
      || getComputedStyle(document.querySelector(s)).getPropertyValue('-webkit-app-region'), sel);
    await until(async () => (await region('#tabbar')) === 'drag', 'the bar to drag');
    assert.equal(await region('#tab-home'), 'no-drag');
    assert.equal(await region('#tab-stars'), 'no-drag');
    await post({ kind: 'native', action: 'titlebar', holes: [[80, 112]], drag: false });
    await until(async () => (await region('#tabbar')) === 'no-drag', 'dragging to stop');
    await post({ kind: 'native', action: 'titlebar', holes: [[80, 112]], drag: true });
    await until(async () => (await region('#tabbar')) === 'drag', 'the bar to drag again');
  });
  await check('resizeWindow resizes the page; haptic answers', async () => {
    assert.equal(await post({ kind: 'resizeWindow', width: 1000, height: 700 }), true);
    assert.deepEqual(await page.evaluate(() => [innerWidth, innerHeight]), await fitted(app, [1000, 700]));
    assert.equal(await post({ kind: 'native', action: 'haptic' }), true);
  });
  await check('the window cannot leave the app\'s page, open windows or load remote content', async () => {
    const url = page.url();
    assert.equal(await page.evaluate(() => window.open('https://example.com') === null), true);
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    await page.evaluate(() => { location.href = 'file:///etc/hostname'; }).catch(() => {});
    await sleep(500);
    assert.equal(page.url(), url);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    const img = await page.evaluate(() => new Promise((resolve) => {
      const i = new Image(); i.onload = () => resolve('loaded'); i.onerror = () => resolve('blocked'); i.src = 'file:///usr/share/pixmaps/debian-logo.png';
    }));
    assert.equal(img, 'blocked');
  });
  await check('no page errors', async () => assert.deepEqual(problems, []));
  await check('closing asks host.quitting(): Cancel keeps the window, then the app quits and disposes the host', async () => {
    await post({ kind: 'fake', do: 'dirty', on: true });
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await until(() => lines(log).some((o) => o.quitting === false), 'the cancelled quit');
    await sleep(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.evaluate(({ app }) => { app.quit(); });
    assert.equal(await done, 0);
    const end = lines(log).filter((o) => 'askToSave' in o || 'quitting' in o || 'dispose' in o);
    assert.deepEqual(end, [{ askToSave: 'cancel' }, { quitting: false }, { askToSave: 'discard' }, { quitting: true }, { dispose: true }]);
  });
}

// ---------------------------------------------------------------- 2. as Linux really is, with a file to open
console.log('\nold page on this platform, opened with a file');
{
  const file = path.join(out, 'Some Model.openpixel');
  const log = path.join(out, 'host-2.jsonl');
  const app = await launch({ args: ['--legacy-ui', file], env: fake({ OPENPIXEL_PLATFORM: '', FAKE_HOST_LOG: log }) });
  const done = exited(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof stateReady !== 'undefined' && stateReady, null, { timeout: 30_000 });
  await check('a file on the command line reaches createHost as `open` and the page starts in the editor', async () => {
    assert.equal(lines(log)[0].created.open, file);
    assert.equal(await page.evaluate(() => window.OPENPIXEL_START), 'editor');
    assert.deepEqual(await page.evaluate(() => ui.tabs.map((t) => t.path)), [file]);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'OpenPixel — Some Model');
  });
  await check('off the Mac the page gets its platform class and paints the glass colour itself', async () => {
    const seen = await page.evaluate(() => ({ platform: window.openpixel.platform, classes: document.documentElement.className,
      background: getComputedStyle(document.documentElement).backgroundColor, shot: typeof window.OPENPIXEL_SCREENSHOT }));
    assert.equal(seen.platform, process.platform);
    assert.equal(seen.classes, `platform-${process.platform}${process.platform === 'darwin' ? '' : ' screenshot'}`);
    if (process.platform !== 'darwin') assert.equal(seen.background, 'rgb(43, 43, 46)');
    assert.equal(seen.shot, 'undefined'); // the class alone: the page must not behave as in a --screenshot run
  });
  await check('a second file from the system goes to host.openFile and the page follows', async () => {
    const other = path.join(out, 'Other.openpixel');
    await app.evaluate(({ app }, p) => { app.emit('open-file', { preventDefault() {} }, p); }, other);
    await until(() => page.evaluate((p) => ui.tabs.some((t) => t.path === p), other), 'the second tab');
  });
  await check('quitting with nothing unsaved just quits', async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await done, 0);
    assert.deepEqual(lines(log).slice(-2), [{ quitting: true }, { dispose: true }]);
  });
}

// ---------------------------------------------------------------- 3. --ui-test with a video
console.log('\n--ui-test run with a video');
{
  const folder = path.join(out, 'uitest'), videos = path.join(out, 'video');
  const app = await launch({ args: ['--legacy-ui', '--ui-test', folder], env: fake({ OPENPIXEL_PLATFORM: 'darwin', FAKE_HOST_LOG: path.join(out, 'host-3.jsonl') }),
    recordVideo: { dir: videos, size: { width: 1440, height: 900 } } });
  const done = exited(app);
  const page = await app.firstWindow();
  const video = page.video();
  await page.waitForFunction(() => typeof stateReady !== 'undefined' && stateReady, null, { timeout: 30_000 });
  await check('--ui-test reaches createHost (uiTest) and the page (flags.uitest, OPENPIXEL_UITEST)', async () => {
    assert.equal(lines(path.join(out, 'host-3.jsonl'))[0].created.uiTest, folder);
    assert.deepEqual(await page.evaluate(() => [window.openpixel.flags.uitest, window.OPENPIXEL_UITEST]), [{ folder }, { folder }]);
  });
  await check('snap saves <folder>/<name>.png, a picture of the window', async () => {
    assert.equal(await page.evaluate(() => window.webkit.messageHandlers.pc.postMessage({ kind: 'snap', name: 'smoke/home' })), true);
    const png = PNG.sync.read(readFileSync(path.join(folder, 'smoke-home.png')));
    assert.deepEqual([png.width, png.height], await page.evaluate(() => [innerWidth, innerHeight]));
    // Not one flat colour: the home screen was drawn.
    const colours = new Set();
    for (let i = 0; i < png.data.length; i += 4 * 97) colours.add(png.data.readUInt32BE(i));
    assert.ok(colours.size > 8, `only ${colours.size} colours in the picture`);
  });
  await check('uitestDone writes report.json (pretty, keys sorted) and the app quits', async () => {
    await sleep(1500); // a little more to see in the video
    page.evaluate(() => window.webkit.messageHandlers.pc.postMessage({ kind: 'uitestDone', report: { passed: 1, failed: 0, results: [{ ok: true, name: 'smoke', ms: 1 }] } })).catch(() => {});
    assert.equal(await done, 0);
    const text = readFileSync(path.join(folder, 'report.json'), 'utf8');
    assert.equal(text, JSON.stringify({ failed: 0, passed: 1, results: [{ ms: 1, name: 'smoke', ok: true }] }, null, 2) + '\n');
  });
  await check('a headless run ends without asking to save; the host is still disposed', async () => {
    const l = lines(path.join(out, 'host-3.jsonl'));
    assert.ok(!l.some((o) => 'quitting' in o) && l.some((o) => o.dispose));
  });
  await check('the run is recorded as a video (MP4 where ffmpeg is installed)', async () => {
    const webm = await video.path();
    await until(() => existsSync(webm) && statSync(webm).size > 0, 'the WebM', 15_000);
    // The recording itself is Playwright's (WebM); turning it into MP4 needs the system's ffmpeg.
    if (spawnSync('ffmpeg', ['-version']).error) { console.log(`        ${webm} (no ffmpeg here: kept as WebM)`); return; }
    const mp4 = await toMp4(webm, path.join(out, 'smoke.mp4'));
    assert.ok(mp4 && statSync(mp4).size > 1000, 'no MP4');
    console.log(`        ${mp4} (${statSync(mp4).size} bytes)`);
  });
}

// ---------------------------------------------------------------- 4. --screenshot
console.log('\n--screenshot run');
{
  const shot = path.join(out, 'shots', 'window.png');
  const app = await launch({ args: ['--legacy-ui', '--screenshot', shot], env: fake({ OPENPIXEL_PLATFORM: 'darwin', FAKE_HOST_LOG: path.join(out, 'host-4.jsonl') }) });
  const done = exited(app);
  await check('--screenshot: the page reports its frames, the picture is saved and the app quits', async () => {
    assert.equal(await done, 0);
    const png = PNG.sync.read(readFileSync(shot));
    assert.ok(png.width >= 980 && png.height >= 620, `${png.width}×${png.height}`);
    assert.equal(lines(path.join(out, 'host-4.jsonl'))[0].created.screenshot, true);
  });
}

// ---------------------------------------------------------------- 5. the React page
console.log('\nReact page (desktop/dist)');
{
  if (!existsSync(path.join(desktop, 'dist', 'index.html'))) {
    spawnSync(process.execPath, [path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: desktop, stdio: 'ignore' });
  }
  const app = await launch({ env: fake({ OPENPIXEL_PLATFORM: 'win32' }) });
  const done = exited(app);
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await check('without --legacy-ui the built React page loads, with the same preload', async () => {
    assert.equal(page.url(), new URL(`file://${path.join(desktop, 'dist', 'index.html')}`).href);
    const seen = await page.evaluate(() => ({ keys: Object.keys(window.openpixel).sort(), platform: window.openpixel.platform,
      shim: typeof window.webkit.messageHandlers.pc.postMessage, classes: [...document.documentElement.classList].filter((c) => /^(platform-|screenshot$)/.test(c)) }));
    assert.deepEqual(seen, { keys: ['flags', 'platform', 'post'], platform: 'win32', shim: 'function', classes: ['platform-win32', 'screenshot'] });
    assert.equal((await page.evaluate(() => window.openpixel.post({ kind: 'native', action: 'version' }))).version, '0.0.0-fake');
  });
  await app.evaluate(({ app }) => { app.quit(); });
  await done;
}

// ---------------------------------------------------------------- 6. --record / --demo
console.log('\ndemo recording');
{
  const folder = path.join(out, 'record'), config = path.join(out, 'demo.json');
  writeFileSync(config, JSON.stringify({ name: 'Smoke', width: 16, height: 16 }));
  const app = await launch({ args: ['--legacy-ui', '--record', folder, '--demo', config], env: fake({ OPENPIXEL_PLATFORM: 'darwin' }) });
  const done = exited(app);
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof stateReady !== 'undefined' && stateReady, null, { timeout: 30_000 });
  let shown = [0, 0, 1];
  const demo = (action, extra = {}) => page.evaluate((m) => window.openpixel.post(m), { kind: 'demo', action, ...extra });
  await check('--demo hands its config to the page and sizes the window for the website\'s shots', async () => {
    assert.deepEqual(await page.evaluate(() => [window.openpixel.flags.demo, window.OPENPIXEL_DEMO]), Array(2).fill({ name: 'Smoke', width: 16, height: 16 }));
    shown = await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]);
    assert.deepEqual(shown.slice(0, 2), await fitted(app, [1440, 855]));
  });
  await check('demo record / mark / stop: frames, manifest.json and the final picture, then the app quits', async () => {
    assert.equal(await demo('record', { fps: 10 }), true);
    // Frames keep coming while it records. How many a second depends on the machine (a CI Mac without a graphics
    // card takes far longer per picture than a person's): wait for three rather than for a time.
    const frameFiles = () => readdirSync(folder).filter((f) => /^f\d{6}\.png$/.test(f)).length;
    await until(() => frameFiles() >= 3, 'three recorded frames', 15_000);
    assert.equal(await demo('mark', { name: 'sent' }), true);
    await sleep(300);
    demo('stop').catch(() => {});
    assert.equal(await done, 0);
    const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
    assert.ok(manifest.frames.length >= 3, `${manifest.frames.length} frames`);
    assert.deepEqual(manifest.marks.map((m) => m.name), ['sent', 'stop']);
    for (const f of manifest.frames.slice(0, -1)) assert.ok(existsSync(path.join(folder, `f${String(f.n).padStart(6, '0')}.png`)), `frame ${f.n} missing`);
    const png = PNG.sync.read(readFileSync(path.join(folder, 'final.png')));
    // The final picture is the window's page at its pixel density.
    assert.deepEqual([png.width, png.height], [Math.round(shown[0] * shown[2]), Math.round(shown[1] * shown[2])]);
  });
}

console.log(`\n${passed} passed, ${failed} failed   (files in ${out})`);
process.exit(failed ? 1 : 0);
