// Runs the UI test (app/web/uitest.js: the page clicks through itself) in the real app, for the old page
// (--legacy-ui) and for the React page, records a video of each run and compares their pictures.
//
//   node tests/run-ui-test.mjs [--ui legacy|react|both] [--out <folder>] [--platform darwin|win32|linux]
//                              [--no-video] [--no-build] [--verbose]
//
// Per UI, in <out>/<ui>/: the checkpoint pictures and report.json (written by the app: electron/main.ts);
// <out>/<ui>.mp4 is the video; with both, <out>/compare/ has the side-by-side pictures (tests/compare-shots.mjs).
// The page is told it runs on a Mac unless --platform says otherwise, so both look like the Mac app they are
// compared with. Exits 1 when a case failed or a run gave no report. On Linux without a display it runs itself
// under xvfb-run; software WebGL is switched on there (OPENPIXEL_SOFTWARE_GL=1).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { buildShell, desktop, launch, needDisplay, toMp4 } from './lib.mjs';
import { compareShots } from './compare-shots.mjs';

needDisplay();

const argv = process.argv.slice(2);
const value = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const which = value('--ui', 'both');
if (!['legacy', 'react', 'both'].includes(which)) { console.error('--ui takes legacy, react or both'); process.exit(2); }
const out = path.resolve(value('--out', path.join(desktop, 'test-results')));
const platform = value('--platform', 'darwin');
const video = !argv.includes('--no-video'), verbose = argv.includes('--verbose');
const uis = which === 'both' ? ['legacy', 'react'] : [which];

if (!argv.includes('--no-build')) {
  await buildShell();
  if (uis.includes('react')) {
    const r = spawnSync(process.execPath, [path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: desktop, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

/** One run. Resolves with the report the app wrote (or what went wrong instead). */
async function run(ui) {
  const folder = path.join(out, ui), videos = path.join(out, `.video-${ui}`);
  for (const p of [folder, videos, path.join(out, `${ui}.mp4`), path.join(out, `${ui}.webm`)]) rmSync(p, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const started = Date.now();
  const app = await launch({
    args: [...(ui === 'legacy' ? ['--legacy-ui'] : []), '--ui-test', folder],
    env: { OPENPIXEL_PLATFORM: platform },
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
    if (webm) mp4 = await toMp4(webm, path.join(out, `${ui}.mp4`));
    if (!mp4 && webm && existsSync(webm)) renameSync(webm, path.join(out, `${ui}.webm`)); // no ffmpeg: keep what there is
    rmSync(videos, { recursive: true, force: true });
  }
  const file = path.join(folder, 'report.json');
  let report = { error: 'the app ended without writing report.json' };
  if (existsSync(file)) { try { report = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { report = { error: `report.json is not JSON: ${e.message}` }; } }
  return { ui, folder, report, mp4, seconds: Math.round((Date.now() - started) / 1000), pictures: readdirSync(folder).filter((f) => f.endsWith('.png')).length };
}

let bad = false;
const runs = [];
for (const ui of uis) {
  console.log(`\n${ui === 'legacy' ? 'Old page (app/web)' : 'React page'} — UI test as ${platform}`);
  const r = await run(ui);
  runs.push(r);
  const { report } = r, results = Array.isArray(report.results) ? report.results : [];
  const failures = results.filter((x) => !x.ok);
  if (report.error || report.crashed) {
    bad = true;
    console.log(`  ${ui}: no result — ${report.error ?? `the test crashed: ${String(report.crashed).split('\n')[0]}`}`);
    if (results.length) console.log(`  ${results.length - failures.length} passed, ${failures.length} failed before that`);
  } else {
    if (report.failed || failures.length) bad = true;
    console.log(`  ${ui}: ${report.passed ?? results.length - failures.length} passed, ${report.failed ?? failures.length} failed`);
  }
  for (const f of failures) console.log(`    ✗ ${f.name}\n        ${String(f.error ?? '').split('\n').join('\n        ')}`);
  console.log(`  ${r.pictures} pictures and report.json in ${r.folder} (${r.seconds} s)${video ? `; video: ${r.mp4 ?? 'none (is ffmpeg installed?)'}` : ''}`);
}

if (runs.length === 2 && runs.every((r) => r.pictures)) {
  const s = compareShots(runs[0].folder, runs[1].folder, path.join(out, 'compare'));
  console.log(`\nPictures: ${s.compared} compared, ${s.identical} identical, worst ${s.worst.toFixed(3)} % different` +
    `${s.onlyInOld.length ? `, ${s.onlyInOld.length} only in the old run` : ''}${s.onlyInNew.length ? `, ${s.onlyInNew.length} only in the new run` : ''}`);
  console.log(`  ${path.join(out, 'compare', 'summary.md')}`);
}
process.exit(bad ? 1 : 0);
