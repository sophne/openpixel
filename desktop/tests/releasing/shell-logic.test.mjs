// The shell's update and agent-command logic (electron/updater.ts, electron/agent-command.ts), without Electron:
// which copies install their own updates, the update dialog's steps, the copy of the agent program Linux keeps, and
// what `OpenPixel --mcp` hands to the native program.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = mkdtempSync(path.join(os.tmpdir(), 'openpixel-shell-logic-'));
process.on('exit', () => rmSync(out, { recursive: true, force: true }));
// The two modules as the app bundles them (TypeScript, CommonJS for Electron's main process); neither needs Electron
// to be loaded. electron-updater stays out: the tests hand the updater a stand-in.
await build({ absWorkingDir: desktop, entryPoints: ['electron/updater.ts', 'electron/agent-command.ts'], outdir: out, bundle: true, platform: 'node',
  format: 'cjs', outExtension: { '.js': '.cjs' }, external: ['electron', 'electron-updater'], logLevel: 'silent' });
const updater = (await import(pathToFileURL(path.join(out, 'updater.cjs')).href)).default;
const agent = (await import(pathToFileURL(path.join(out, 'agent-command.cjs')).href)).default;

const facts = (o = {}) => ({ packaged: true, stamped: true, platform: 'linux', env: {}, execPath: '/opt/OpenPixel/openpixel-desktop', ...o });

test('which copies install their own updates', () => {
  const { canSelfInstall } = updater;
  // Windows and macOS: when the release build said so (macOS: only Developer ID builds are stamped).
  assert.equal(canSelfInstall(facts({ platform: 'win32' })), true);
  assert.equal(canSelfInstall(facts({ platform: 'darwin' })), true);
  assert.equal(canSelfInstall(facts({ platform: 'darwin', stamped: false })), false);
  assert.equal(canSelfInstall(facts({ platform: 'win32', packaged: false })), false, 'never a development build');
  // Linux: only the AppImage itself. A .deb, or a .deb started from another AppImage's terminal, is not one.
  const appImage = { APPIMAGE: '/home/me/Apps/OpenPixel.AppImage', APPDIR: '/tmp/.mount_OpenPiXYZ' };
  assert.equal(canSelfInstall(facts({ env: appImage, execPath: '/tmp/.mount_OpenPiXYZ/openpixel-desktop' })), true);
  assert.equal(canSelfInstall(facts({ env: appImage, execPath: '/opt/OpenPixel/openpixel-desktop' })), false);
  assert.equal(canSelfInstall(facts({ env: { APPIMAGE: '/x.AppImage' }, execPath: '/tmp/.mount_OpenPiXYZ/openpixel-desktop' })), false);
  assert.equal(canSelfInstall(facts({ env: {} })), false);
  assert.equal(canSelfInstall(facts({ env: appImage, execPath: '/tmp/.mount_OpenPiXYZ/openpixel-desktop', stamped: false })), false);
  assert.equal(canSelfInstall(facts({ platform: 'freebsd' })), false);
});

test('the stamp is read from the packed package.json; anything else means no', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-stamp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(updater.selfUpdateStamp(dir), false, 'no package.json');
  for (const [text, want] of [['{"openpixel":{"selfUpdate":true}}', true], ['{"openpixel":{"selfUpdate":false}}', false], ['{"openpixel":{"selfUpdate":"true"}}', false],
    ['{"name":"x"}', false], ['not json', false]]) {
    writeFileSync(path.join(dir, 'package.json'), text);
    assert.equal(updater.selfUpdateStamp(dir), want, text);
  }
  // The repository's own package.json carries no stamp: a development build never installs updates.
  assert.equal(updater.selfUpdateStamp(desktop), false);
});

test('the feed override and the launch check', () => {
  const { feedOverride, updateSettings } = updater;
  assert.equal(feedOverride({}), undefined);
  assert.equal(feedOverride({ OPENPIXEL_UPDATE_FEED: ' http://127.0.0.1:8123/feed ' }), 'http://127.0.0.1:8123/feed/');
  assert.equal(feedOverride({ OPENPIXEL_UPDATE_FEED: 'https://example.test/a/' }), 'https://example.test/a/');
  for (const bad of ['', '  ', 'file:///etc/passwd', 'ftp://x/', 'not an address', '/tmp/feed']) assert.equal(feedOverride({ OPENPIXEL_UPDATE_FEED: bad }), undefined, bad);

  assert.deepEqual(updateSettings(facts({ platform: 'win32' })), { selfInstall: true, atLaunch: true });
  assert.deepEqual(updateSettings(facts({ platform: 'darwin', stamped: false })), { selfInstall: false, atLaunch: true });
  // Development: no check at launch, unless a test feed is named.
  assert.deepEqual(updateSettings(facts({ packaged: false })), { selfInstall: false, atLaunch: false });
  assert.deepEqual(updateSettings(facts({ packaged: false, env: { OPENPIXEL_UPDATE_FEED: 'http://127.0.0.1:1/' } })), { feed: 'http://127.0.0.1:1/', selfInstall: false, atLaunch: true });
  // The person can switch the launch check off.
  assert.equal(updateSettings(facts({ platform: 'win32', env: { OPENPIXEL_NO_UPDATE_CHECK: '1' } })).atLaunch, false);
  assert.equal(updateSettings(facts({ platform: 'win32', env: { OPENPIXEL_NO_UPDATE_CHECK: 'yes' } })).atLaunch, false);
  assert.equal(updateSettings(facts({ platform: 'win32', env: { OPENPIXEL_NO_UPDATE_CHECK: '0' } })).atLaunch, true);
  assert.equal(updateSettings(facts({ platform: 'win32', env: { OPENPIXEL_NO_UPDATE_CHECK: '' } })).atLaunch, true);
});

/** electron-updater's `autoUpdater`, as much of it as the dialog uses. */
class FakeAutoUpdater extends EventEmitter {
  calls = [];
  found = { isUpdateAvailable: true, updateInfo: { version: '2.0.0' } };
  downloadFails = null;
  installFails = null;
  feed = null;
  release = null;
  checkForUpdates() { this.calls.push('check'); if (this.found instanceof Error) return Promise.reject(this.found); return Promise.resolve(this.found); }
  downloadUpdate() {
    this.calls.push('download');
    return new Promise((resolve, reject) => { this.release = () => (this.downloadFails ? reject(this.downloadFails) : resolve(['/cache/pending/OpenPixel.AppImage'])); });
  }
  quitAndInstall(silent, runAfter) { this.calls.push(`quitAndInstall ${silent} ${runAfter}`); if (this.installFails) setImmediate(() => this.emit('error', this.installFails)); }
  setFeedURL(o) { this.feed = o; }
}

/** The window, recorded: every dialog with the button it gets, progress, links, and whether quitting was prepared. */
function fakeShell(answers = []) {
  const shell = {
    headless: false, version: '1.0.0', dialogs: [], opened: [], progressSeen: [], prepared: 0, stayed: 0, save: true,
    async messageBox(o) { shell.dialogs.push(o); return { response: answers.length ? answers.shift() : (o.cancelId ?? 0) }; },
    async openExternal(url) { shell.opened.push(url); return true; },
    progress(f) { shell.progressSeen.push(f); },
    async prepareToQuit() { shell.prepared++; return shell.save; },
    stayOpen() { shell.stayed++; },
  };
  return shell;
}
const info = { version: '2.0.0', url: 'https://openpixel.dev/downloads', notes: 'https://github.com/sophne/openpixel/releases/tag/v2.0.0' };
const settle = () => new Promise((r) => setTimeout(r, 10));

test('a copy that does not install by itself offers the download page, and never loads the updater', async () => {
  const shell = fakeShell([0]);
  const u = updater.createUpdater(shell, { selfInstall: false }, () => { throw new Error('electron-updater must not be loaded'); });
  await u.showUpdateDialog(info);
  assert.deepEqual(shell.dialogs.map((d) => [d.message, d.buttons]), [['OpenPixel 2.0.0 is available', ['Download…', 'Later']]]);
  assert.match(shell.dialogs[0].detail, /You have 1\.0\.0\.[\s\S]*releases\/tag\/v2\.0\.0/);
  assert.deepEqual(shell.opened, ['https://openpixel.dev/downloads']);
  // "Later" opens nothing.
  await u.showUpdateDialog(info);
  assert.equal(shell.opened.length, 1);
  // Checks and screenshots never show a dialog.
  const quiet = fakeShell();
  quiet.headless = true;
  await updater.createUpdater(quiet, { selfInstall: false }).showUpdateDialog(info);
  assert.deepEqual(quiet.dialogs, []);
});

test('a copy that installs by itself: asked, downloaded in the background, asked again, then installed', async () => {
  const shell = fakeShell([0, 0, 0]);
  const auto = new FakeAutoUpdater();
  const u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  // Set up so that nothing happens by itself.
  assert.deepEqual([auto.autoDownload, auto.autoInstallOnAppQuit, auto.disableDifferentialDownload, auto.feed], [false, false, true, null]);
  assert.deepEqual(shell.dialogs.map((d) => [d.message, d.buttons]), [['OpenPixel 2.0.0 is available', ['Download Update', 'Later']]]);
  assert.deepEqual(auto.calls, ['check', 'download']);
  assert.deepEqual(u.state(), { kind: 'downloading', version: '2.0.0', percent: 0 });
  auto.emit('download-progress', { percent: 62.5 });
  assert.deepEqual(shell.progressSeen, [0, 0.625]);
  // Asked again while it downloads: where it stands, no second download.
  shell.dialogs.length = 0;
  await u.showUpdateDialog(info);
  assert.deepEqual(shell.dialogs.map((d) => [d.message, d.detail]), [['OpenPixel 2.0.0 is downloading', '63 % so far. OpenPixel asks before it restarts.']]);
  assert.deepEqual(auto.calls, ['check', 'download']);
  // Downloaded: the second question. Yes: everything is saved first, then the install, quietly, opening again after.
  shell.dialogs.length = 0;
  auto.release();
  await settle();
  assert.deepEqual(shell.dialogs.map((d) => [d.message, d.buttons]), [['OpenPixel 2.0.0 is ready to install', ['Restart to Update', 'Later']]]);
  assert.equal(shell.progressSeen.at(-1), null);
  assert.equal(shell.prepared, 1);
  assert.deepEqual(auto.calls, ['check', 'download', 'quitAndInstall true true']);
});

test('nothing installs without the person: Later at either question, or cancelling the save', async () => {
  // Later at the first question: no download.
  let shell = fakeShell([1]);
  let auto = new FakeAutoUpdater();
  let u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  assert.deepEqual([auto.calls, u.state(), shell.progressSeen], [['check'], { kind: 'idle' }, []]);

  // Later at the second: downloaded, not installed, also not on quitting; asking again offers the restart again.
  shell = fakeShell([0, 1, 1]);
  auto = new FakeAutoUpdater();
  u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  auto.release();
  await settle();
  assert.deepEqual(u.state(), { kind: 'ready', version: '2.0.0' });
  assert.equal(auto.autoInstallOnAppQuit, false);
  await u.showUpdateDialog(info);
  assert.deepEqual(shell.dialogs.map((d) => d.message), ['OpenPixel 2.0.0 is available', 'OpenPixel 2.0.0 is ready to install', 'OpenPixel 2.0.0 is ready to install']);
  assert.deepEqual([auto.calls, shell.prepared], [['check', 'download'], 0]);

  // Yes, but the person cancels where unsaved work is asked about: nothing is installed.
  shell = fakeShell([0, 0]);
  shell.save = false;
  auto = new FakeAutoUpdater();
  u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  auto.release();
  await settle();
  assert.deepEqual([shell.prepared, auto.calls], [1, ['check', 'download']]);
});

test('when installing by itself cannot work, the download page is offered instead', async () => {
  // The updater finds nothing (it reads GitHub's list itself), or cannot ask.
  for (const found of [null, { isUpdateAvailable: false, updateInfo: { version: '1.0.0' } }, new Error('net::ERR_INTERNET_DISCONNECTED\n    at stack…')]) {
    const shell = fakeShell([0]);
    const auto = new FakeAutoUpdater();
    auto.found = found;
    await updater.createUpdater(shell, { selfInstall: true }, () => auto).showUpdateDialog(info);
    assert.deepEqual([shell.dialogs.map((d) => d.buttons), shell.opened, auto.calls], [[['Download…', 'Later']], ['https://openpixel.dev/downloads'], ['check']]);
    if (found instanceof Error) assert.match(shell.dialogs[0].detail, /could not prepare the update by itself \(net::ERR_INTERNET_DISCONNECTED\)\. You can get it from the download page\./);
  }
  // The download fails (or does not match its checksum: electron-updater rejects it the same way).
  let shell = fakeShell([0, 1]);
  let auto = new FakeAutoUpdater();
  auto.downloadFails = new Error('sha512 checksum mismatch, expected abc, got def');
  let u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  auto.release();
  await settle();
  assert.deepEqual(shell.dialogs.map((d) => d.buttons), [['Download Update', 'Later'], ['Download…', 'Later']]);
  assert.match(shell.dialogs[1].detail, /could not download the update by itself \(sha512 checksum mismatch/);
  assert.deepEqual([u.state(), shell.progressSeen.at(-1), auto.calls.includes('quitAndInstall true true')], [{ kind: 'idle' }, null, false]);

  // The install does not start: the app stays open (and asks about unsaved work again when it is closed).
  shell = fakeShell([0, 0, 1]);
  auto = new FakeAutoUpdater();
  auto.installFails = new Error('spawn EACCES');
  u = updater.createUpdater(shell, { selfInstall: true }, () => auto);
  await u.showUpdateDialog(info);
  auto.release();
  await settle();
  await settle();
  assert.equal(shell.stayed, 1);
  assert.match(shell.dialogs.at(-1).detail, /could not install the update by itself \(spawn EACCES\)/);
});

test('the dialog names what will be installed; a test feed goes to the updater too', async () => {
  // Someone on a pre-release: the updater may pick another release than the newest stable the feed names.
  const shell = fakeShell([1]);
  const auto = new FakeAutoUpdater();
  auto.found = { isUpdateAvailable: true, updateInfo: { version: '2.1.0-beta.1' } };
  await updater.createUpdater(shell, { selfInstall: true, feed: 'http://127.0.0.1:8123/' }, () => auto).showUpdateDialog(info);
  assert.equal(shell.dialogs[0].message, 'OpenPixel 2.1.0-beta.1 is available');
  assert.equal(shell.dialogs[0].detail.includes('v2.0.0'), false, 'the other release\'s notes are not this one\'s');
  assert.deepEqual([auto.feed, auto.forceDevUpdateConfig], [{ provider: 'generic', url: 'http://127.0.0.1:8123/' }, true]);
  assert.equal(updater.shortReason(new Error(`first line\n${'x'.repeat(500)}`)), 'first line');
  assert.equal(updater.shortReason('y'.repeat(300)).length, 200);
});

test('asked twice at once (an agent with install=true while the dialog is open): one dialog', async () => {
  const shell = fakeShell();
  let open;
  shell.messageBox = (o) => { shell.dialogs.push(o); return new Promise((r) => { open = () => r({ response: 1 }); }); };
  const u = updater.createUpdater(shell, { selfInstall: false });
  const first = u.showUpdateDialog(info), second = u.showUpdateDialog(info);
  await settle();
  assert.equal(shell.dialogs.length, 1);
  open();
  await Promise.all([first, second]);
  assert.equal(shell.dialogs.length, 1);
});

// ---------------------------------------------------------------- the agent command

test('where the agent program is: named, shipped, or a local build', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-agent-where-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const where = { desktopFolder: path.join(dir, 'desktop'), packaged: false, resourcesPath: path.join(dir, 'resources') };
  const { shippedAgentProgram } = agent;
  assert.equal(shippedAgentProgram(where, { OPENPIXEL_MCP: path.join(dir, 'mine') }, 'linux'), path.join(dir, 'mine'));
  assert.equal(shippedAgentProgram({ ...where, packaged: true }, {}, 'linux'), path.join(dir, 'resources', 'core', 'openpixel'));
  assert.equal(shippedAgentProgram({ ...where, packaged: true }, {}, 'win32'), path.join(dir, 'resources', 'core', 'openpixel.exe'));
  // No build yet: the release path is named. A debug build is used when it is all there is; release wins.
  assert.equal(shippedAgentProgram(where, {}, 'linux'), path.join(dir, 'core', 'target', 'release', 'openpixel'));
  mkdirSync(path.join(dir, 'core', 'target', 'debug'), { recursive: true });
  writeFileSync(path.join(dir, 'core', 'target', 'debug', 'openpixel'), '');
  assert.equal(shippedAgentProgram(where, {}, 'linux'), path.join(dir, 'core', 'target', 'debug', 'openpixel'));
  mkdirSync(path.join(dir, 'core', 'target', 'release'), { recursive: true });
  writeFileSync(path.join(dir, 'core', 'target', 'release', 'openpixel'), '');
  assert.equal(shippedAgentProgram(where, {}, 'linux'), path.join(dir, 'core', 'target', 'release', 'openpixel'));
});

test('Linux keeps a copy of the agent program in the data folder: made when missing or different, left alone otherwise', { skip: process.platform === 'win32' }, (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-agent-copy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shipped = path.join(dir, 'mount', 'resources', 'core', 'openpixel');
  mkdirSync(path.dirname(shipped), { recursive: true });
  writeFileSync(shipped, 'program one');
  chmodSync(shipped, 0o755);
  utimesSync(shipped, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  const data = path.join(dir, 'home', '.local', 'share', 'OpenPixel');
  const target = path.join(data, 'bin', 'openpixel');

  assert.equal(agent.stableAgentProgram(shipped, data), target);
  assert.equal(readFileSync(target, 'utf8'), 'program one');
  assert.equal(statSync(target).mode & 0o777, 0o755);
  assert.equal(statSync(target).mtimeMs, statSync(shipped).mtimeMs);
  assert.deepEqual(readdirSync(path.dirname(target)), ['openpixel'], 'no temporary file is left');

  // The same program again: the copy is not rewritten (same file, not a new one).
  const inode = statSync(target).ino;
  agent.stableAgentProgram(shipped, data);
  assert.equal(statSync(target).ino, inode);
  // Same content under another date (an AppImage unpacked anew): only the date is put right.
  utimesSync(target, new Date('2025-06-01T00:00:00Z'), new Date('2025-06-01T00:00:00Z'));
  agent.stableAgentProgram(shipped, data);
  assert.deepEqual([statSync(target).ino, statSync(target).mtimeMs], [inode, statSync(shipped).mtimeMs]);

  // A new version of the app: replaced, by a new file moved over the old one.
  writeFileSync(shipped, 'program two, longer');
  utimesSync(shipped, new Date('2026-02-02T00:00:00Z'), new Date('2026-02-02T00:00:00Z'));
  agent.stableAgentProgram(shipped, data);
  assert.equal(readFileSync(target, 'utf8'), 'program two, longer');
  assert.notEqual(statSync(target).ino, inode);
  // Damaged with the size kept and the date changed (as an edit would): restored.
  writeFileSync(target, 'program XXX, longer');
  agent.stableAgentProgram(shipped, data);
  assert.equal(readFileSync(target, 'utf8'), 'program two, longer');
  // No longer executable: made so again.
  chmodSync(target, 0o644);
  agent.stableAgentProgram(shipped, data);
  assert.equal(statSync(target).mode & 0o111, 0o111);
  // Nothing shipped: an error, and the caller falls back to the program inside the app.
  assert.throws(() => agent.stableAgentProgram(path.join(dir, 'nothing'), data), /ENOENT/);
});

test('which command agents are told: the stable copy on a packaged Linux build, the program inside the app elsewhere', { skip: process.platform === 'win32' }, (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-agent-command-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const where = { desktopFolder: path.join(dir, 'app.asar'), packaged: true, resourcesPath: path.join(dir, 'resources') };
  mkdirSync(path.join(where.resourcesPath, 'core'), { recursive: true });
  writeFileSync(path.join(where.resourcesPath, 'core', 'openpixel'), 'program');
  const inApp = path.join(where.resourcesPath, 'core', 'openpixel');
  const env = { XDG_DATA_HOME: path.join(dir, 'xdg') };
  assert.equal(agent.agentCommand(where, env, 'linux'), path.join(dir, 'xdg', 'OpenPixel', 'bin', 'openpixel'));
  assert.equal(existsSync(path.join(dir, 'xdg', 'OpenPixel', 'bin', 'openpixel')), true);
  assert.equal(agent.agentCommand(where, env, 'darwin'), inApp);
  assert.equal(agent.agentCommand({ ...where, packaged: false }, { ...env, OPENPIXEL_MCP: inApp }, 'linux'), inApp);
  assert.equal(agent.agentCommand(where, { ...env, OPENPIXEL_MCP: inApp }, 'linux'), inApp, 'a named program is used as it is');
  // A data folder that cannot be written: this launch uses the program inside the app.
  writeFileSync(path.join(dir, 'file'), '');
  assert.equal(agent.agentCommand(where, { XDG_DATA_HOME: path.join(dir, 'file') }, 'linux'), inApp);
  // The data folder is the one the app and the MCP program use.
  assert.equal(agent.linuxDataFolder('/home/me', {}), '/home/me/.local/share/OpenPixel');
  assert.equal(agent.linuxDataFolder('/home/me', { XDG_DATA_HOME: '/data' }), '/data/OpenPixel');
  assert.equal(agent.linuxDataFolder('/home/me', { XDG_DATA_HOME: 'relative' }), '/home/me/.local/share/OpenPixel');
});

test('`OpenPixel --mcp`: the arguments the native program gets', () => {
  const { agentArguments } = agent;
  const app = '/Applications/OpenPixel.app/Contents/MacOS/OpenPixel';
  assert.deepEqual(agentArguments([app, '--mcp'], true), ['--mcp']);
  assert.deepEqual(agentArguments([app, '--mcp', '--headless'], true), ['--mcp', '--headless']);
  assert.deepEqual(agentArguments([app, '--mcp-http', '8123', '--token', 's3cret'], true), ['--mcp-http', '8123', '--token', 's3cret']);
  // Not an agent's start: a file to open, the app's own switches, nothing.
  for (const argv of [[app], [app, '/home/me/fox.openpixel'], [app, '--screenshot', 'out.png'], [app, '--ui-test', 'folder'], [app, '--mcpx']]) {
    assert.equal(agentArguments(argv, true), null, argv.join(' '));
  }
  // Development (`electron <app folder> …`): the app folder is not passed on; a port is.
  assert.deepEqual(agentArguments(['electron', '.', '--mcp'], false), ['--mcp']);
  assert.deepEqual(agentArguments(['electron', '--no-sandbox', '/repo/desktop', '--mcp-http', '8123'], false), ['--no-sandbox', '--mcp-http', '8123']);
  assert.deepEqual(agentArguments(['electron', '--mcp-http', '8123'], false), ['--mcp-http', '8123']);
});
