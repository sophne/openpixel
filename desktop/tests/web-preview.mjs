// `npm run test:web`: the browser preview (web/, built into web/dist by `npm run build:web`) in Chromium.
//
// It checks, through the page's own `window.openpixel.post`, that the wasm-bindgen package from core-pkg/ started
// in a browser and that a session works there (documents, drawing, undo, exports, reviews, autosave, the library,
// tabs), and then runs the very same messages against the same package in Node, on the Node Platform Electron
// uses, and compares every answer as JSON text. One set of bindings, two places.
//
//   node tests/web-preview.mjs [--no-build] [--headed]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(desktop, 'web', 'dist');
const flags = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the pass/fail list

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return !!ok;
}
const note = (text) => console.log(`note  ${text}`);

// ---------------------------------------------------------------- the session both sides get

/** Every message of the session, in order. `{FILES}` is the files folder of whoever runs it; `wait` is a pause
    before the message (the autosave delay is 1.5 s). */
const SESSION = [
  { id: 'version', msg: { kind: 'native', action: 'version' } },
  { id: 'tabs at start', msg: { kind: 'native', action: 'tabs' } },
  { id: 'library at start', msg: { kind: 'native', action: 'library' } },
  { id: 'newDocument', msg: { kind: 'native', action: 'newDocument', tool: 'new_sprite', args: { width: 16, height: 16, name: 'Preview' } } },
  { id: 'set_pixels', msg: { kind: 'tool', name: 'set_pixels', args: { pixels: [[1, 1, '#d04648'], [2, 2, '#6daa2c'], [3, 3, '#597dce'], [4, 4, '#d04648']] } } },
  { id: 'fill_box', msg: { kind: 'tool', name: 'fill_box', args: { from: [6, 2, 0], to: [10, 5, 0], color: '#dad45e' } } },
  { id: 'draw_line', msg: { kind: 'tool', name: 'draw_line', args: { from: [0, 15, 0], to: [15, 8, 0], color: '#597dce' } } },
  { id: 'flood_fill', msg: { kind: 'tool', name: 'flood_fill', args: { at: [15, 0, 0], color: '#346524' } } },
  { id: 'ui_state drawn', msg: { kind: 'tool', name: 'ui_state', args: {} } },
  { id: 'get_model_info', msg: { kind: 'tool', name: 'get_model_info', args: {} } },
  { id: 'undo', msg: { kind: 'tool', name: 'undo', args: {} } },
  { id: 'ui_state undone', msg: { kind: 'tool', name: 'ui_state', args: {} } },
  { id: 'redo', msg: { kind: 'tool', name: 'redo', args: {} } },
  { id: 'ui_state redone', msg: { kind: 'tool', name: 'ui_state', args: {} } },
  { id: 'get_history', msg: { kind: 'tool', name: 'get_history', args: {} } },
  { id: 'a tool that fails', msg: { kind: 'tool', name: 'set_pixels', args: {} } },
  { id: 'a tool that is not there', msg: { kind: 'tool', name: 'no_such_tool', args: {} } },
  { id: 'export_png', msg: { kind: 'tool', name: 'export_png', args: { path: '{FILES}/exports/preview.png', scale: 4 } } },
  { id: 'review_model 2D', msg: { kind: 'tool', name: 'review_model', args: {} } },
  { id: 'tabs before autosave', msg: { kind: 'native', action: 'tabs' } },
  { id: 'tabs after autosave', wait: 2200, msg: { kind: 'native', action: 'tabs' } },
  { id: 'library after autosave', msg: { kind: 'native', action: 'library' } },
  { id: 'sample3d', msg: { kind: 'native', action: 'sample3d' } },
  { id: 'tabs with the island', msg: { kind: 'native', action: 'tabs' } },
  { id: 'get_model_info island', msg: { kind: 'tool', name: 'get_model_info', args: {} } },
  { id: 'review_model 3D', msg: { kind: 'tool', name: 'review_model', args: {} } },
  { id: 'switchTab', msg: { kind: 'native', action: 'switchTab', id: 1 } },
  { id: 'renameFile', msg: { kind: 'native', action: 'renameFile', tab: 1, name: 'Preview two' } },
  { id: 'library after rename', msg: { kind: 'native', action: 'library' } },
  { id: 'closeTab', msg: { kind: 'native', action: 'closeTab', id: 2 } },
  { id: 'openPath', msg: { kind: 'native', action: 'openPath', path: '{FILES}/Preview two.openpixel' } },
  { id: 'openPath of nothing', msg: { kind: 'native', action: 'openPath', path: '{FILES}/missing.openpixel' } },
  { id: 'an unknown message', msg: { kind: 'nonsense' } },
];

const withFiles = (msg, files) => JSON.parse(JSON.stringify(msg).replaceAll('{FILES}', files));

/** Runs the session. `post(msg)` answers `{ ok, json }` (the answer as JSON text) or `{ ok: false, error, plain }`. */
async function runSession(post, files) {
  const answers = [];
  for (const step of SESSION) {
    if (step.wait) await sleep(step.wait);
    answers.push({ id: step.id, ...(await post(withFiles(step.msg, files))) });
  }
  return answers;
}

// ---------------------------------------------------------------- the browser's side

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.map': 'application/json' };

function serve(folder) {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(folder, path.normalize(name === '/' ? '/index.html' : name));
    if (!file.startsWith(folder) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

async function startBrowser() {
  const { chromium } = await import('playwright');
  const options = {
    headless: !flags.includes('--headed'),
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  };
  try {
    return await chromium.launch(options);
  } catch (e) {
    // This Playwright's own browser is not installed; the machine has one.
    const own = process.env.OPENPIXEL_CHROMIUM ?? '/opt/pw-browsers/chromium';
    if (!existsSync(own)) throw e;
    return chromium.launch({ ...options, executablePath: own });
  }
}

/** In the page: posts one message and answers what `runSession` wants. */
const pagePost = (page) => (msg) => page.evaluate(async (m) => {
  try {
    return { ok: true, json: JSON.stringify(await window.openpixel.post(m)) };
  } catch (e) {
    return { ok: false, error: String(e?.message), plain: e instanceof Error && Object.getPrototypeOf(e) === Error.prototype };
  }
}, msg);

// ---------------------------------------------------------------- Node's side (what Electron's main process runs)

/** desktop/host, the Node Platform and the core's glue in one module, as scripts/build-electron.mjs bundles them. */
async function nodeSide(folder) {
  const out = path.join(folder, 'node-side.mjs');
  await build({
    stdin: {
      contents: "export { createHost } from './host/index';\nexport { nodePlatform } from './host/node/platform-node';\nexport * as core from './core-pkg/openpixel_wasm.js';\n",
      resolveDir: desktop, loader: 'ts', sourcefile: 'node-side.ts',
    },
    outfile: out, bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning',
  });
  const { createHost, nodePlatform, core } = await import(pathToFileURL(out).href);
  core.initSync({ module: readFileSync(path.join(desktop, 'core-pkg', 'openpixel_wasm_bg.wasm')) });
  // Real files in a temporary folder, laid out like the preview's memory (home/data, home/files), so the only
  // difference between the two sides' paths is the temporary folder in front. No dialogs, and no network either
  // (the preview has none), which is how a screenshot or UI-test run of Electron answers too.
  const home = path.join(folder, 'OpenPixel');
  const half = nodePlatform({ home, env: {} });
  const pages = [];
  const ui = {
    openPanel: async () => null, savePanel: async () => null, askToSave: async () => 'discard',
    alert: async () => {}, showUpdateDialog: async () => {}, copyText: () => {}, openExternal: async () => false,
    reveal: () => false, screenshot: () => Promise.reject(new Error('no window')), setTitle: () => {},
    page: (fn, ...args) => { pages.push([fn, ...args]); },
  };
  const platform = {
    os: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    ...half,
    paths: { ...half.paths, home, data: path.join(home, 'data'), files: path.join(home, 'files') },
    fetchText: async () => null,
    ui,
    desktop: { mcpCommand: path.join(folder, 'openpixel'), socketPath: path.join(folder, 'op.sock') },
  };
  const host = createHost({ platform, core });
  const post = async (msg) => {
    try {
      return { ok: true, json: JSON.stringify(await host.handle(msg)) };
    } catch (e) {
      return { ok: false, error: String(e?.message), plain: true };
    }
  };
  return { host, post, files: platform.paths.files, version: core.version() };
}

// ---------------------------------------------------------------- comparing

/** What may differ between two runs of one session: when a file was touched. */
const withoutTimes = (text) => text.replace(/"(touched|created)":[0-9.e+-]+/g, '"$1":0');

function pngSize(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
const isPngUrl = (s) => typeof s === 'string' && s.startsWith('data:image/png;base64,') && pngSize(Buffer.from(s.slice(22), 'base64')) !== null;

// ---------------------------------------------------------------- the run

async function main() {
  if (!existsSync(path.join(desktop, 'core-pkg', 'openpixel_wasm_bg.wasm'))) {
    console.error('core-pkg/ is not there: run `npm run build:core` first.');
    process.exit(2);
  }
  if (!flags.includes('--no-build')) {
    const vite = path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js');
    const r = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.web.config.ts', '--logLevel', 'warn'], { cwd: desktop, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), 'openpixel-web-preview-'));
  const server = await serve(site);
  const browser = await startBrowser();
  let node = null;
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleLines = [];
    const pageErrors = [];
    page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e)));
    // Notes the order in which `window.openpixel` (ours) and `window.PC` (the page's first act) appear.
    await page.addInitScript(() => {
      const order = [];
      window.__order = order;
      for (const name of ['openpixel', 'PC']) {
        let value;
        Object.defineProperty(window, name, { configurable: true, get: () => value, set: (v) => { value = v; order.push(name); } });
      }
    });
    const address = `http://127.0.0.1:${server.address().port}/?test`;
    await page.goto(address);
    const started = await page.waitForFunction(() => window.openpixel && window.__openpixelTest, null, { timeout: 30_000 }).then(() => true, () => false);
    if (!check('the preview starts: window.openpixel is there', started, started ? '' : [...pageErrors, ...consoleLines].join(' | '))) return;
    await page.waitForFunction(() => window.__order.includes('PC'), null, { timeout: 10_000 }).catch(() => {});
    const order = await page.evaluate(() => window.__order);
    check('window.openpixel existed before the page\'s script ran', order[0] === 'openpixel' && order.indexOf('PC') > 0, `order: ${order.join(', ')}`);
    check('the console says where files live', consoleLines.some((l) => l.includes('OpenPixel browser preview: files live in memory and are gone when the tab closes.')));
    // Let the page finish its own first questions before the session begins.
    await sleep(500);
    const post = pagePost(page);
    const hook = (fn, ...args) => page.evaluate(([f, a]) => window.__openpixelTest[f](...a), [fn, args]);
    const paths = await page.evaluate(() => window.__openpixelTest.paths);

    // 1–3: the session, in the browser.
    const web = await runSession(post, paths.files);
    const answer = (id) => {
      const a = web.find((x) => x.id === id);
      return a?.ok ? JSON.parse(a.json) : null;
    };
    node = await nodeSide(temp);
    const version = answer('version');
    check('1. the wasm package started in the browser: `native version` answers the core\'s version', version?.version === node.version && /^\d+\.\d+\.\d+/.test(node.version), `version ${version?.version}`);

    const made = answer('newDocument');
    check('2. newDocument opens a 16×16 2D file in a tab', made?.tabs?.length === 1 && made.tabs[0].kind === '2d' && made.active === made.tabs[0].id && answer('get_model_info')?.size?.join('x') === '16x16x1',
      `size ${answer('get_model_info')?.size}`);
    const changed = ['set_pixels', 'fill_box', 'draw_line', 'flood_fill'].map((id) => answer(id)?.changed);
    check('2. the drawing tools draw', changed.every((n) => Number.isInteger(n) && n > 0), `changed ${changed.join(', ')}`);
    // The picture of the active layer, as the canvas gets it.
    const [drawn, undone, redone] = ['ui_state drawn', 'ui_state undone', 'ui_state redone'].map((id) => answer(id)?.active_cel);
    check('2. ui_state shows the drawing; undo takes the last step back, redo brings it again',
      typeof drawn === 'string' && typeof undone === 'string' && drawn !== undone && drawn === redone && answer('undo')?.undone?.length === 1 && answer('redo')?.redone?.length === 1,
      `undo: ${JSON.stringify(answer('undo')?.undone)}`);
    const failed = web.find((x) => x.id === 'a tool that fails');
    check('2. a failed tool rejects with a plain Error carrying the tool\'s text', failed && !failed.ok && failed.plain && failed.error === 'missing pixels', `"${failed?.error}"`);
    const exported = answer('export_png');
    const size = exported && (await hook('exists', exported.saved)) ? pngSize(await hook('read', exported.saved)) : null;
    check('2. export_png writes a PNG of the right size into the memory files', size?.join('x') === '64x64' && exported.width === 64 && exported.height === 64, `${exported?.saved}: ${size?.join('×')}`);
    const reviews = [answer('review_model 2D'), answer('review_model 3D')];
    check('2. review_model returns its pictures as data:image/png;base64,…', reviews.every((r) => r?.images?.length > 0 && r.images.every(isPngUrl)),
      `${reviews.map((r) => r?.images?.length ?? 0).join(' + ')} pictures`);

    const before = answer('tabs before autosave');
    const after = answer('tabs after autosave');
    const library = answer('library after autosave');
    const file = library?.files?.find((f) => f.path === after?.tabs?.[0]?.path);
    // The file itself, where it is by now (the session renames it later on).
    const kept = answer('library after rename')?.files?.find((f) => f.name === 'Preview two');
    const bytes = kept && (await hook('exists', kept.path)) ? (await hook('read', kept.path)).length : 0;
    check('3. after the autosave delay the file is saved and shows in `native library`',
      before?.tabs?.[0]?.dirty === true && after?.tabs?.[0]?.dirty === false && file?.exists === true && file.kind === '2d' && isPngUrl(file.thumb) && bytes > 0,
      `${file?.path}, now ${kept?.path}: ${bytes} bytes`);
    const island = answer('tabs with the island');
    check('3. sample3d opens the island in a second tab', island?.tabs?.length === 2 && island.tabs[1].kind === '3d' && island.active === island.tabs[1].id && /island/i.test(island.tabs[1].name),
      `tabs: ${island?.tabs?.map((t) => `${t.name} (${t.kind})`).join(', ')}`);

    // 4: the same session against the same package in Node.
    const nodeAnswers = await runSession(node.post, node.files);
    let same = 0;
    let normalised = 0;
    const different = [];
    for (const [i, w] of web.entries()) {
      const n = nodeAnswers[i];
      // Node's paths have the temporary folder in front of what the preview calls /OpenPixel.
      const nodeText = n.ok ? n.json.replaceAll(JSON.stringify(temp).slice(1, -1), '') : n.error.replaceAll(temp, '');
      const webText = w.ok ? w.json : w.error;
      const raw = n.ok ? n.json : n.error;
      if (w.ok === n.ok && withoutTimes(webText) === withoutTimes(nodeText)) {
        same += 1;
        if (raw !== webText) normalised += 1;
      } else {
        different.push(`${w.id}: browser ${webText.slice(0, 300)} ≠ Node ${nodeText.slice(0, 300)}`);
      }
    }
    check(`4. the browser and Node (Electron's side) answer the same: ${same} of ${web.length} answers equal as JSON text`, different.length === 0,
      different.length ? different.join(' | ') : `${same - normalised} as they came, ${normalised} after taking the temporary folder and the times out`);

    // What only the browser has to get right.
    const shell = await Promise.all([{ kind: 'native', action: 'titlebar', drag: false }, { kind: 'native', action: 'haptic' }, { kind: 'snap', name: 'x' },
      { kind: 'resizeWindow', width: 800, height: 600 }, { kind: 'frames', count: 3 }, { kind: 'uitestDone', report: {} }, { kind: 'demo' }].map(post));
    check('the shell\'s own messages answer true', shell.every((a) => a.ok && a.json === 'true'));
    const none = {};
    for (const [id, msg] of Object.entries({
      agents: { kind: 'native', action: 'agents', setup: false }, mcpCommand: { kind: 'native', action: 'mcpCommand' }, socketPath: { kind: 'native', action: 'socketPath' },
      providers: { kind: 'chat', action: 'providers' }, send: { kind: 'chat', action: 'send', chat: 'c', text: 'hello' }, stars: { kind: 'native', action: 'githubStars' },
    })) none[id] = await post(msg);
    check('without a desktop the host still answers: no agents\' socket, no Agent Chat, no network',
      Object.values(none).every((a) => a.ok) && JSON.parse(none.agents.json).bridge === false && none.mcpCommand.json === '""' && none.socketPath.json === '""'
        && none.providers.json === '[]' && none.send.json === 'false' && none.stars.json === 'null',
      Object.entries(none).filter(([, a]) => !a.ok).map(([id, a]) => `${id}: ${a.error}`).join(' | '));

    // A save panel is a download, an open panel a file chooser.
    const download = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await post({ kind: 'native', action: 'export', format: 'png', options: { scale: 2 } });
    const got = await download;
    const saved = got ? path.join(temp, 'download.png') : null;
    if (got) await got.saveAs(saved);
    check('`native export` offers the picture as a download', got && got.suggestedFilename() === 'Preview two.png' && pngSize(readFileSync(saved))?.join('x') === '32x32',
      got ? `${got.suggestedFilename()}, ${pngSize(readFileSync(saved))?.join('×')}` : 'no download');
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 }).catch(() => null);
    await post({ kind: 'native', action: 'open' });
    const asked = await chooser;
    if (asked) await asked.setFiles({ name: 'From disk.openpixel', mimeType: 'application/octet-stream', buffer: readFileSync(path.join(node.files, 'Preview two.openpixel')) });
    const opened = asked ? await page.waitForFunction(async () => (await window.openpixel.post({ kind: 'native', action: 'tabs' })).tabs.some((t) => t.name === 'From disk'), null, { timeout: 5000 }).then(() => true, () => false) : false;
    check('`native open` takes a file from the person\'s computer into a tab', opened, asked ? '' : 'no file chooser');

    await sleep(300);
    const mounted = await page.evaluate(() => document.getElementById('root')?.childElementCount ?? 0);
    note(`the page itself: ${mounted > 0 ? 'rendered' : 'did not render'}, ${pageErrors.length} uncaught error(s)${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' | ')}` : ''}`);
    const blocked = consoleLines.filter((l) => /Content Security Policy|CompileError|wasm/i.test(l) && /^error|^warning/.test(l));
    check('nothing was blocked by the Content-Security-Policy, and the WebAssembly loaded without complaint', blocked.length === 0, blocked.slice(0, 2).join(' | '));
  } finally {
    node?.host.dispose();
    await browser.close();
    server.close();
    rmSync(temp, { recursive: true, force: true });
  }
}

await main();
const failures = results.filter((r) => !r.ok);
console.log(failures.length === 0 ? `\nweb preview: all ${results.length} checks passed` : `\nweb preview: ${failures.length} of ${results.length} checks FAILED`);
process.exit(failures.length === 0 ? 0 : 1);
