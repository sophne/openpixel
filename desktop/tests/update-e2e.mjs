// The update path of a packed app, end to end, on Linux, against a local feed (after `npm run release:build`).
//
//   node tests/update-e2e.mjs [--install]        (npm run test:update)
//
// A folder with a newer `latest-linux.yml` and its AppImage is served on http://127.0.0.1:<port>/; the packed
// AppImage (a copy, in a home folder of this run's own) is started with OPENPIXEL_UPDATE_FEED pointing there.
// Checked: the Update button appears by itself (the launch check); clicking it shows the update dialog, which
// names the new version and offers to download it; the download runs and is verified against the feed's
// checksum; the "Restart to Update" question comes and, answered "Later", nothing is installed, also not on
// quitting. A second run offers a file that does not match its checksum: it is refused, and the dialog falls
// back to the download page.
// With --install the first run answers "Restart to Update": the AppImage file is replaced by the download and
// the app opens again. (That is electron-updater's own step and needs a system where an AppImage can start by
// itself; see RELEASING.md.)
//
// The dialogs are answered through Electron's `dialog.showMessageBox`, replaced in the main process for this run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { appEnv, desktop, needDisplay, until } from './lib.mjs';

/** Text for use inside a regular expression, every character that means something there taken literally. */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

if (process.platform !== 'linux') { console.log('The update check against a local feed runs on Linux (AppImage) only.'); process.exit(0); }
needDisplay();

const install = process.argv.includes('--install');
const built = path.join(desktop, 'release', 'upload', 'OpenPixel.AppImage');
if (!existsSync(built)) { console.error(`${built} is missing: run \`npm run release:build\` first`); process.exit(2); }
const version = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
const NEWER = '99.0.0';

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok    ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL  ${name}\n        ${String(e?.message ?? e).split('\n').join('\n        ')}`); }
}

const root = mkdtempSync(path.join(os.tmpdir(), 'openpixel-update-e2e-'));
const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');

/** A feed folder: the "new" AppImage (the built one: only the feed says it is newer) and its latest-linux.yml.
    `lie` writes a checksum the file does not have. */
function feedFolder(name, { lie = false } = {}) {
  const folder = path.join(root, name);
  mkdirSync(folder);
  const file = path.join(folder, 'OpenPixel.AppImage');
  copyFileSync(built, file);
  const sum = lie ? createHash('sha512').update('another file').digest('base64') : sha512(file);
  writeFileSync(path.join(folder, 'latest-linux.yml'),
    `version: ${NEWER}\nfiles:\n  - url: OpenPixel.AppImage\n    sha512: ${sum}\n    size: ${statSync(file).size}\npath: OpenPixel.AppImage\nsha512: ${sum}\nreleaseDate: '${new Date().toISOString()}'\n`);
  return folder;
}

/** Serves `folder`; every request is noted (method, path, the User-Agent, all headers, how it ended). */
function serve(folder) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.join(folder, name);
    const note = { method: req.method, path: `/${name}`, agent: req.headers['user-agent'] ?? '', headers: { ...req.headers }, status: 0 };
    requests.push(note);
    if (!/^[\w.-]+$/.test(name) || !existsSync(file)) { note.status = 404; res.writeHead(404).end('not here'); return; }
    note.status = 200;
    res.writeHead(200, { 'Content-Length': statSync(file).size, 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, requests, close: () => new Promise((r) => server.close(r)) })));
}

/** Starts a copy of the packed AppImage, in its own home, reading its updates from `feed`. `answers` says which
    button each dialog gets, by the dialog's message. */
async function start(name, feed, answers) {
  const home = path.join(root, name);
  mkdirSync(path.join(home, 'Applications'), { recursive: true });
  const appImage = path.join(home, 'Applications', 'OpenPixel.AppImage');
  copyFileSync(built, appImage);
  // ELECTRON_DISABLE_SANDBOX: the copy that opens again after an install is started by the updater, without this
  // run's `--no-sandbox`; containers and CI machines cannot run Chromium's sandbox.
  const env = appEnv({ HOME: home, APPIMAGE_EXTRACT_AND_RUN: '1', OPENPIXEL_UPDATE_FEED: feed, TMPDIR: path.join(home, 'tmp'), ELECTRON_DISABLE_SANDBOX: '1' });
  for (const k of ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'OPENPIXEL_MCP', 'OPENPIXEL_SOCKET', 'OPENPIXEL_NO_UPDATE_CHECK']) delete env[k];
  mkdirSync(env.TMPDIR);
  const { _electron } = await import('playwright');
  const electronApp = await _electron.launch({ executablePath: appImage, args: ['--no-sandbox'], env, timeout: 120_000 });
  const stderr = [];
  electronApp.process().stderr?.on('data', (d) => stderr.push(String(d)));
  // Every dialog is recorded and answered; none appears on the screen.
  await electronApp.evaluate(({ dialog }, byMessage) => {
    globalThis.__dialogs = [];
    dialog.showMessageBox = async (...list) => {
      const o = list[list.length - 1];
      const rule = byMessage.find(([text]) => o.message.includes(text));
      const response = rule ? rule[1] : (o.cancelId ?? 0);
      globalThis.__dialogs.push({ message: o.message, detail: o.detail ?? '', buttons: o.buttons ?? [], answered: (o.buttons ?? [])[response] ?? String(response) });
      return { response, checkboxChecked: false };
    };
  }, answers);
  const page = await electronApp.firstWindow();
  return {
    electronApp, page, home, appImage, stderr, original: statSync(appImage), pid: await electronApp.evaluate(() => process.pid),
    dialogs: () => electronApp.evaluate(() => globalThis.__dialogs),
    facts: () => electronApp.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), appImage: process.env.APPIMAGE, appDir: process.env.APPDIR, exe: process.execPath })),
  };
}

console.log(`OpenPixel ${version} (AppImage) against a local feed offering ${NEWER}`);

// ---------------------------------------------------------------- a good update
{
  const feed = await serve(feedFolder('feed'));
  const run = await start('home', feed.url, [['is available', 0], ['is ready to install', install ? 0 : 1]]);
  const pending = path.join(run.home, '.cache', 'openpixel-updater', 'pending');
  try {
    await check('the packed AppImage runs as one (APPIMAGE is set, the app is packaged, its version is the build\'s)', async () => {
      const f = await run.facts();
      assert.equal(f.packaged, true);
      assert.equal(f.version, version);
      assert.equal(f.appImage, run.appImage, 'APPIMAGE names the file that was started');
      assert.ok(f.appDir && f.exe.startsWith(`${f.appDir}/`), `the program runs from the AppImage's own folder (${f.exe} in ${f.appDir})`);
    });

    await check('at launch the app reads the feed by itself and the Update button appears', async () => {
      await run.page.waitForSelector('#tab-update', { state: 'visible', timeout: 30_000 });
      const says = await run.page.locator('#tab-update').evaluate((b) => b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent);
      assert.match(says ?? '', new RegExp(`Update to OpenPixel ${escapeRegExp(NEWER)}`));
      const asked = feed.requests.filter((r) => r.path === '/latest-linux.yml');
      assert.equal(asked.length, 1, 'one request for the feed');
      assert.equal(asked[0].agent, `OpenPixel/${version}`, 'it says which version asks');
      assert.equal(feed.requests.some((r) => r.path === '/OpenPixel.AppImage'), false, 'nothing is downloaded by itself');
      assert.deepEqual(await run.dialogs(), [], 'and no dialog');
    });

    await check('clicking Update shows the dialog: the new version, downloaded only when the person says so', async () => {
      await run.page.click('#tab-update');
      const first = await until(async () => (await run.dialogs())[0], 'the update dialog', 30_000);
      assert.equal(first.message, `OpenPixel ${NEWER} is available`);
      assert.deepEqual(first.buttons, ['Download Update', 'Later']);
      assert.match(first.detail, new RegExp(`You have ${escapeRegExp(version)}\\.[\\s\\S]*asks before it restarts[\\s\\S]*releases/tag/v${escapeRegExp(NEWER)}`));
      assert.equal(first.answered, 'Download Update');
    });

    await check('the download runs in the background, is checked against the feed\'s checksum, and then the app asks before restarting', async () => {
      const ready = await until(async () => (await run.dialogs()).find((d) => d.message.includes('ready to install')), 'the download and the restart question', 180_000);
      assert.equal(ready.message, `OpenPixel ${NEWER} is ready to install`);
      assert.deepEqual(ready.buttons, ['Restart to Update', 'Later']);
      const got = feed.requests.filter((r) => r.path === '/OpenPixel.AppImage' && r.method === 'GET');
      assert.equal(got.length, 1, `one download of the whole file (${JSON.stringify(feed.requests.map((r) => `${r.method} ${r.path}`))})`);
      // (With --install the file has already been moved into the AppImage's place when this looks.)
      if (!install) {
        const saved = existsSync(pending) ? readdirSync(pending).filter((n) => n.endsWith('.AppImage')) : [];
        assert.equal(saved.length, 1, `the download is kept in ${pending}: ${existsSync(pending) ? readdirSync(pending) : 'no such folder'}`);
        assert.equal(sha512(path.join(pending, saved[0])), sha512(path.join(root, 'feed', 'OpenPixel.AppImage')), 'what was saved is what the feed describes');
      }
    });

    await check('no request carries anything that tells this installation from another, or the person\'s language', async () => {
      // electron-updater would send a random ID it keeps for the installation (x-user-staging-id), and Electron's
      // network stack the app's language; the app sends the same values as everyone instead (electron/updater.ts).
      // What each request carried is printed for RELEASING.md's account of what the app sends.
      const seen = new Map();
      for (const r of feed.requests) {
        const staging = r.headers['x-user-staging-id'];
        assert.ok(staging === undefined || staging === '00000000-0000-0000-0000-000000000000', `${r.method} ${r.path} sent x-user-staging-id: ${staging}`);
        assert.ok([undefined, '*'].includes(r.headers['accept-language']), `${r.method} ${r.path} sent accept-language: ${r.headers['accept-language']}`);
        const { host, ...rest } = r.headers;
        const line = `${r.method} ${r.path}: ${Object.entries(rest).map(([k, v]) => `${k}: ${v}`).join(' | ')}`;
        seen.set(line.replace(/bytes=[0-9-]+/, 'bytes=…'), true);
      }
      for (const line of seen.keys()) console.log(`        ${line}`);
    });

    if (!install) {
      await check('"Later": nothing is installed, now or on quitting', async () => {
        const before = statSync(run.appImage);
        await run.page.click('#tab-update');
        await until(async () => (await run.dialogs()).filter((d) => d.message.includes('ready to install')).length === 2, 'the restart question again', 30_000);
        await run.electronApp.close();
        const after = statSync(run.appImage);
        assert.deepEqual([after.ino, after.mtimeMs, after.size], [before.ino, before.mtimeMs, before.size], 'the AppImage is the file it was');
      });
    } else {
      await check('"Restart to Update": the AppImage is replaced by the download and the app opens again', async () => {
        // So far the app itself asked for the feed twice: at launch and when Update was clicked.
        const asked = 2;
        await until(() => statSync(run.appImage, { throwIfNoEntry: false })?.ino !== run.original.ino && existsSync(run.appImage), 'a new file in the AppImage\'s place', 60_000);
        assert.equal(sha512(run.appImage), sha512(path.join(root, 'feed', 'OpenPixel.AppImage')), 'it is the download');
        assert.equal(statSync(run.appImage).mode & 0o111, 0o111, 'and it can be started');
        // The old copy quits (this run's debugger connection is all that holds it), the new one starts by itself
        // and reads the feed again.
        await Promise.race([run.electronApp.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
        try { process.kill(run.pid, 'SIGKILL'); } catch { /* it has gone by itself */ }
        try {
          await until(() => feed.requests.filter((r) => r.path === '/latest-linux.yml' && r.agent === `OpenPixel/${version}`).length > asked, 'the new copy to start and read the feed', 90_000);
        } catch (e) {
          const running = spawnSync('pgrep', ['-fa', run.home], { encoding: 'utf8' }).stdout.split('\n').map((l) => l.slice(0, 160)).join('\n');
          throw new Error(`${e.message}\nrequests: ${feed.requests.map((r) => `${r.method} ${r.path} (${r.agent})`).join(', ')}\nrunning:\n${running}`);
        } finally {
          spawnSync('pkill', ['-f', run.home]);
        }
      });
    }
  } finally {
    await Promise.race([run.electronApp.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    await feed.close();
    if (failures.length) console.log(`        stderr of the app:\n        ${run.stderr.join('').split('\n').slice(-25).join('\n        ')}`);
  }
}

// ---------------------------------------------------------------- a file that is not what the feed says
if (!install) {
  const feed = await serve(feedFolder('bad-feed', { lie: true }));
  const run = await start('home-2', feed.url, [['is available', 0]]);
  try {
    await check('a download that does not match the feed\'s checksum is refused; the dialog offers the download page instead', async () => {
      await run.page.waitForSelector('#tab-update', { state: 'visible', timeout: 30_000 });
      await run.page.click('#tab-update');
      const fallback = await until(async () => (await run.dialogs()).find((d) => d.detail.includes('could not download the update by itself')), 'the refusal', 180_000);
      assert.match(fallback.detail, /sha512 checksum mismatch/);
      assert.deepEqual(fallback.buttons, ['Download…', 'Later']);
      assert.equal((await run.dialogs()).some((d) => d.message.includes('ready to install')), false, 'it is never offered for installing');
      const before = statSync(run.appImage);
      await run.electronApp.close();
      assert.equal(statSync(run.appImage).ino, before.ino, 'the AppImage is untouched');
    });
  } finally {
    await run.electronApp.close().catch(() => {});
    await feed.close();
  }
}

try { rmSync(root, { recursive: true, force: true }); } catch { /* the system clears its temporary folder */ }
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
