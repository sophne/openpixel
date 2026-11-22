// Runs the app's UI test (tests/uitest.js: the page clicks through itself) in the real app and records a video of
// the run.
//
//   node tests/run-ui-test.mjs [--platform darwin|win32|linux] [--out <folder>] [--no-video] [--no-build]
//                              [--settle <ms>] [--no-retry] [--verbose]
//
// In <out>/shots/: the checkpoint pictures and report.json (written by the app: electron/main.ts); <out>/ui-test.mp4
// is the video. <out> defaults to test-results/<platform>.
//
// The page is shown for the system this runs on. `--platform` shows another system's layout and wording instead
// (the Mac's room for the window buttons and ⌘ glyphs, or Ctrl, "Show in Explorer", …) with this machine's fonts
// and rendering; the test's expectations follow (uitest.js: PLATFORM).
//
// Exits 1 when a case failed or the run gave no report. A few cases wait a fixed time for an animation and miss it
// now and then on a busy machine or with software rendering, so a run with failures is repeated once and only what
// fails both times counts (the first attempt is kept in <out>/first-attempt). `--no-retry` turns that off.
// On Linux without a display the script runs itself under xvfb-run; software WebGL is switched on there
// (OPENPIXEL_SOFTWARE_GL=1).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildShell, desktop, launch, needDisplay, toMp4 } from './lib.mjs';

needDisplay();

const argv = process.argv.slice(2);
const value = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const real = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
const platform = value('--platform', real);
if (!['darwin', 'win32', 'linux'].includes(platform)) { console.error('--platform takes darwin, win32 or linux'); process.exit(2); }
const out = path.resolve(value('--out', path.join(desktop, 'test-results', platform)));
const video = !argv.includes('--no-video'), verbose = argv.includes('--verbose');

if (!argv.includes('--no-build')) {
  await buildShell();
  const r = spawnSync(process.execPath, [path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: desktop, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** One run. Resolves with the report the app wrote (or what went wrong instead). */
async function run() {
  // Every run works in a folder called "shots": the home screen's list shows where a file is ("shots/Files").
  const folder = path.join(out, 'shots'), videos = path.join(out, '.video');
  for (const p of [folder, videos, path.join(out, 'ui-test.mp4'), path.join(out, 'ui-test.webm')]) rmSync(p, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const started = Date.now();
  const app = await launch({
    args: ['--ui-test', folder],
    // A pause before each picture, so previews and thumbnails are in it (see `snap` in electron/main.ts).
    env: { OPENPIXEL_PLATFORM: platform, OPENPIXEL_SNAP_SETTLE_MS: value('--settle', '350') },
    recordVideo: video ? { dir: videos, size: { width: 1440, height: 900 } } : undefined,
  });
  const exited = new Promise((resolve) => app.process().once('exit', resolve));
  app.process().stderr.on('data', (d) => {
    // The app's own progress notes, and what it could not do; Chromium's chatter only when asked.
    for (const line of String(d).split('\n')) if (line.trim() && (verbose || /^\[ui-test\]|^OpenPixel/.test(line))) console.log(`    ${line}`);
  });
  let recording;
  app.firstWindow().then((page) => {
    recording = page.video();
    if (verbose) page.on('console', (m) => console.log(`    [page] ${m.text()}`));
    page.on('pageerror', (e) => console.log(`    [page error] ${e.message}`));
  }).catch(() => {});
  // The app quits by itself: after the report, or when its own 300 s watchdog fires.
  const timer = setTimeout(() => app.process().kill(), 330_000);
  await exited;
  clearTimeout(timer);
  let mp4 = null;
  if (recording) {
    const webm = await recording.path().catch(() => null);
    if (webm) mp4 = await toMp4(webm, path.join(out, 'ui-test.mp4'));
    if (!mp4 && webm && existsSync(webm)) renameSync(webm, path.join(out, 'ui-test.webm')); // no ffmpeg: keep what there is
    rmSync(videos, { recursive: true, force: true });
  }
  const file = path.join(folder, 'report.json');
  let report = { error: 'the app ended without writing report.json' };
  if (existsSync(file)) { try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { report = { error: `report.json is not JSON: ${e.message}` }; } }
  const results = Array.isArray(report.results) ? report.results : [];
  return { folder, report, results, failures: results.filter((x) => !x.ok), broken: report.error ?? (report.crashed ? `the test crashed: ${String(report.crashed).split('\n')[0]}` : null),
    mp4, seconds: Math.round((Date.now() - started) / 1000), pictures: readdirSync(folder).filter((f) => f.endsWith('.png')).length };
}

function show(r) {
  if (r.broken) {
    console.log(`  no result — ${r.broken}`);
    if (r.results.length) console.log(`  ${r.results.length - r.failures.length} passed, ${r.failures.length} failed before that`);
  } else {
    console.log(`  ${r.results.length - r.failures.length} passed, ${r.failures.length} failed`);
  }
  for (const f of r.failures) console.log(`    ✗ ${f.name}\n        ${String(f.error ?? '').split('\n').join('\n        ')}`);
  console.log(`  ${r.pictures} pictures and report.json in ${r.folder} (${r.seconds} s)${video ? `; video: ${r.mp4 ?? 'none (is ffmpeg installed?)'}` : ''}`);
}

console.log(`\nUI test, the page shown as ${platform}${platform === real ? '' : ` (on ${real})`}`);
let result = await run();
show(result);
/** What counts against the run: a case that failed (twice, when the run was repeated), or no result at all. */
let failed = result.failures.map((f) => f.name);

if (failed.length && !result.broken && !argv.includes('--no-retry')) {
  console.log(`\n${failed.length} case(s) failed: running once more to tell a slow moment from a fault`);
  const first = path.join(out, 'first-attempt');
  rmSync(first, { recursive: true, force: true });
  mkdirSync(first, { recursive: true });
  renameSync(result.folder, path.join(first, 'shots'));
  for (const f of ['ui-test.mp4', 'ui-test.webm']) if (existsSync(path.join(out, f))) renameSync(path.join(out, f), path.join(first, f));
  const again = await run();
  show(again);
  // A case the second run never reached still counts.
  const passedAgain = new Set(again.results.filter((x) => x.ok).map((x) => x.name));
  failed = failed.filter((n) => !passedAgain.has(n));
  const onlyNow = again.failures.map((f) => f.name).filter((n) => !result.failures.some((f) => f.name === n));
  console.log(`\nFailing both times: ${failed.length ? failed.join('; ') : 'nothing'}`
    + (onlyNow.length ? `\nFailed only the second time (not counted): ${onlyNow.join('; ')}` : ''));
  if (again.broken) failed.push(again.broken);
  result = again;
}

const ok = !result.broken && failed.length === 0;
console.log(`\nUI test as ${platform}: ${ok ? 'passed' : 'FAILED'} (${result.results.length - result.failures.length} passed, ${result.failures.length} failed in the last run)`);
process.exit(ok ? 0 : 1);
