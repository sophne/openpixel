// Checks the app as it is packed for this system (after `npm run release:build`): what people install must start,
// carry the right version, and give agents their MCP server.
//
//   node tests/packaged-app.mjs            (npm run test:packaged)
//
// On every system:
//   - the native `openpixel` program inside the app says the app's version and answers an MCP `initialize`;
//   - the app's own executable started with `--mcp` (the old Mac app's agent command) answers `initialize` on
//     standard output and writes nothing else there;
//   - the app starts: `--screenshot` saves a picture of the window and quits.
// Linux (the AppImage, run unpacked so no FUSE is needed): after a start the copy of the agent program is at
//   ~/.local/share/OpenPixel/bin/openpixel, executable, and answers; it is left alone when unchanged and restored
//   when damaged.
// macOS: the app and the agent program inside it are universal, the bundle id, oldest system and build number are
//   the release's, and the signature (Developer ID or ad hoc) verifies.
// The release workflow runs this on each system before it uploads anything.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SCREEN, appEnv, desktop, needDisplay } from './lib.mjs';

needDisplay();

const release = path.join(desktop, 'release');
const version = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;
const linux = process.platform === 'linux', mac = process.platform === 'darwin', win = process.platform === 'win32';
const args = process.argv.slice(2);
const buildNumber = args.includes('--build-number') ? args[args.indexOf('--build-number') + 1] : undefined;

/** What is started, the unpacked app's resources, and the switches a start needs here. */
const app = linux
  ? { exe: path.join(release, 'upload', 'OpenPixel.AppImage'), resources: path.join(release, 'linux-unpacked', 'resources'),
    // Unpacked into a temporary folder and run from there: containers and CI machines have no FUSE. Chromium's
    // sandbox needs a setuid helper they do not have either.
    env: { APPIMAGE_EXTRACT_AND_RUN: '1' }, switches: ['--no-sandbox'] }
  : mac
    ? { exe: path.join(release, 'mac-universal', 'OpenPixel.app', 'Contents', 'MacOS', 'OpenPixel'),
      resources: path.join(release, 'mac-universal', 'OpenPixel.app', 'Contents', 'Resources'), env: {}, switches: [] }
    : { exe: path.join(release, 'win-unpacked', 'OpenPixel.exe'), resources: path.join(release, 'win-unpacked', 'resources'), env: {}, switches: [] };
const program = path.join(app.resources, 'core', win ? 'openpixel.exe' : 'openpixel');

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${String(e?.message ?? e).split('\n').join('\n        ')}`);
  }
}

const INITIALIZE = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"packaged-app-check","version":"1"}}}';

/** Starts `command --mcp …` as an agent would (pipes), sends `initialize`, closes its input when the answer has come,
    and resolves with everything it wrote and its exit code. */
function mcp(command, list, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, list, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`no answer within 60 s\nstdout: ${stdout}\nstderr: ${stderr.slice(-2000)}`)); }, 60_000);
    child.stdout.on('data', (d) => { stdout += d; if (stdout.includes('\n')) child.stdin.end(); });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
    child.stdin.on('error', () => {});
    child.stdin.write(`${INITIALIZE}\n`);
  });
}

/** The one line an MCP server may write for one request: the answer to `initialize`, from this version. */
function assertInitialized(r, what) {
  const lines = r.stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, `${what}: exactly one line on standard output, got ${lines.length}:\n${r.stdout.slice(0, 600)}\nstderr: ${r.stderr.slice(-600)}`);
  const answer = JSON.parse(lines[0]);
  assert.equal(answer.id, 1);
  assert.equal(answer.result?.serverInfo?.name, 'openpixel', lines[0].slice(0, 300));
  assert.equal(answer.result?.serverInfo?.version, version, `${what} runs ${answer.result?.serverInfo?.version}, the app is ${version}`);
  assert.equal(r.code, 0, `${what} ended with ${r.code}\n${r.stderr.slice(-600)}`);
}

/** A home folder of this run's own: nothing of the person's is read or written. */
const home = mkdtempSync(path.join(os.tmpdir(), 'openpixel-packaged-home-'));
const runEnv = appEnv({ ...app.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  XDG_DATA_HOME: undefined, XDG_CONFIG_HOME: undefined, XDG_CACHE_HOME: undefined, OPENPIXEL_MCP: undefined, OPENPIXEL_SOCKET: undefined });
for (const k of Object.keys(runEnv)) if (runEnv[k] === undefined) delete runEnv[k];

console.log(`OpenPixel ${version}, packed for ${process.platform} (${app.exe})`);

await check('the packed app and the agent program inside it are there', () => {
  assert.ok(existsSync(app.exe), `${app.exe} is missing: run \`npm run release:build\` first`);
  assert.ok(existsSync(program), `${program} is missing`);
  if (!win) assert.equal(statSync(program).mode & 0o111, 0o111, 'the agent program is executable');
});
if (failures.length) { console.log('\nNothing to check.'); process.exit(1); }

await check('the agent program inside the app says the app\'s version', () => {
  const r = spawnSync(program, ['--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `OpenPixel ${version}`);
});

await check('the agent program answers MCP `initialize` (as `openpixel --mcp`)', async () => {
  assertInitialized(await mcp(program, ['--mcp', '--headless'], runEnv), 'openpixel --mcp');
});

await check('the app\'s own executable with `--mcp` hands over to it: the answer on standard output, and nothing else', async () => {
  // Linux: the program inside the AppImage, started directly (what a mounted AppImage runs).
  const exe = linux ? path.join(release, 'linux-unpacked', 'openpixel-desktop') : app.exe;
  assertInitialized(await mcp(exe, [...app.switches, '--mcp', '--headless'], runEnv), 'OpenPixel --mcp');
});

if (linux) {
  await check('Linux: the AppImage itself with `--mcp` answers too', async () => {
    const r = await mcp(app.exe, [...app.switches, '--mcp', '--headless'], runEnv);
    // Run unpacked (no FUSE here), the AppImage's own runtime lists the files it unpacks on standard output, part
    // before it starts the app and the rest when it ends (it does not empty its buffer in between, so the app's
    // line lands somewhere inside the list, even mid-line). That is the runtime's, not OpenPixel's, and a mounted
    // AppImage does not do it. So: take the answer's line out, and what is left must be that list and nothing else.
    const at = r.stdout.indexOf('{"');
    assert.ok(at >= 0, `no answer:\n${r.stdout.slice(0, 600)}\nstderr: ${r.stderr.slice(-600)}`);
    const end = r.stdout.indexOf('\n', at) + 1;
    const around = r.stdout.slice(0, at) + r.stdout.slice(end);
    const strangers = around.split('\n').filter((l) => l !== '' && !/^\/.*\/appimage_extracted_[0-9a-f]+(\/.*)?$/.test(l));
    assert.deepEqual(strangers, [], 'something other than the runtime\'s file list is on standard output');
    assertInitialized({ ...r, stdout: r.stdout.slice(at, end) }, 'OpenPixel.AppImage --mcp');
    if (around) console.log(`        (run unpacked, the AppImage runtime wrote its list of ${around.split('\n').filter(Boolean).length} unpacked files to standard output around the answer)`);
  });
}

/** One start of the app that ends by itself: `--screenshot`. */
function screenshotRun(name) {
  const png = path.join(home, name);
  const r = spawnSync(app.exe, [...app.switches, '--screenshot', png], { env: runEnv, encoding: 'utf8', timeout: 120_000 });
  assert.equal(r.status, 0, `--screenshot ended with ${r.status ?? r.signal}\n${(r.stderr ?? '').slice(-1500)}`);
  assert.ok(existsSync(png), `no picture at ${png}\n${(r.stderr ?? '').slice(-1500)}`);
  const head = readFileSync(png).subarray(0, 8).toString('hex');
  assert.equal(head, '89504e470d0a1a0a', 'the picture is a PNG');
  assert.ok(statSync(png).size > 5000, `the picture is only ${statSync(png).size} bytes`);
  return r;
}

await check('the app starts: `--screenshot` saves a picture of the window and quits', () => {
  screenshotRun('first.png');
});

if (linux) {
  const copy = path.join(home, '.local', 'share', 'OpenPixel', 'bin', 'openpixel');
  await check('Linux: after a start, the agent program is at ~/.local/share/OpenPixel/bin/openpixel and answers', async () => {
    assert.ok(existsSync(copy), `${copy} is missing after the first start`);
    assert.equal(statSync(copy).mode & 0o111, 0o111, 'executable');
    assert.ok(readFileSync(copy).equals(readFileSync(program)), 'the copy is the program inside the app');
    assertInitialized(await mcp(copy, ['--mcp', '--headless'], runEnv), '~/.local/share/OpenPixel/bin/openpixel --mcp');
  });
  await check('Linux: the copy is left alone when nothing changed, and put back when it is damaged or gone', () => {
    const before = statSync(copy);
    screenshotRun('second.png');
    assert.equal(statSync(copy).ino, before.ino, 'the same file as before');
    writeFileSync(copy, 'not a program');
    chmodSync(copy, 0o644);
    screenshotRun('third.png');
    assert.ok(readFileSync(copy).equals(readFileSync(program)), 'restored');
    assert.equal(statSync(copy).mode & 0o111, 0o111, 'executable again');
    rmSync(copy);
    screenshotRun('fourth.png');
    assert.ok(existsSync(copy), 'made again');
  });
}

if (mac) {
  const bundle = path.join(release, 'mac-universal', 'OpenPixel.app');
  const out = (cmd, list) => { const r = spawnSync(cmd, list, { encoding: 'utf8' }); assert.equal(r.status, 0, `${cmd} ${list.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };
  await check('macOS: the app and the agent program inside it are universal (Apple silicon and Intel)', () => {
    for (const file of [app.exe, program]) assert.deepEqual(out('lipo', ['-archs', file]).split(/\s+/).sort(), ['arm64', 'x86_64'], file);
  });
  await check('macOS: the bundle id, oldest system and build number are the release\'s', () => {
    const plist = (key) => out('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(bundle, 'Contents', 'Info.plist')]);
    assert.equal(plist('CFBundleIdentifier'), 'com.sophne.openpixel');
    assert.equal(plist('CFBundleShortVersionString'), version);
    assert.equal(plist('LSMinimumSystemVersion'), '12.0');
    assert.equal(plist('CFBundleExecutable'), 'OpenPixel');
    // The old Mac app's updater only moves to a higher build number: it must be the commit count, as text.
    if (buildNumber !== undefined) assert.equal(plist('CFBundleVersion'), buildNumber);
    assert.match(readFileSync(path.join(bundle, 'Contents', 'Info.plist'), 'utf8'), /<key>CFBundleVersion<\/key>\s*<string>[0-9][0-9.]*<\/string>/);
  });
  await check('macOS: the signature verifies (Developer ID, or ad hoc)', () => {
    const r = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', bundle], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    console.log(`        ${spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8' }).stderr.split('\n').filter((l) => /^(Signature|Authority|TeamIdentifier|flags|CodeDirectory)/.test(l)).join('\n        ')}`);
  });
}

try { rmSync(home, { recursive: true, force: true }); } catch { /* the system clears its temporary folder */ }
console.log(`\n${passed} passed, ${failures.length} failed${linux ? `   (screen ${SCREEN})` : ''}`);
process.exit(failures.length ? 1 : 0);
