// What the test scripts share: starting the app under Playwright, a virtual screen on Linux, and video conversion.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repo = path.join(desktop, '..');
export const fakeHost = path.join(desktop, 'tests', 'fake-host.mjs');
/** The virtual screen: large enough for the UI test's biggest window (1680×1050). */
export const SCREEN = '1680x1100x24';

/** On Linux without a display (CI, containers) the script starts itself again under xvfb-run and never returns
    from here; everywhere else this does nothing. */
export function needDisplay() {
  if (process.platform !== 'linux' || process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return;
  const r = spawnSync('xvfb-run', ['-a', '-s', `-screen 0 ${SCREEN}`, process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' });
  if (r.error) { console.error('No display, and xvfb-run is not installed.'); process.exit(2); }
  process.exit(r.status ?? 1);
}

/** The environment for the Electron child: software WebGL where there is no graphics card, and without the
    NODE_OPTIONS of the caller, which Electron refuses loudly (`--use-openssl-ca`). */
export function appEnv(extra = {}) {
  const env = { ...process.env, NODE_OPTIONS: '', ...extra };
  if (process.platform === 'linux' && env.OPENPIXEL_SOFTWARE_GL === undefined) env.OPENPIXEL_SOFTWARE_GL = '1';
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** Starts the app with Playwright. `args` are the app's own (`--legacy-ui`, `--ui-test <folder>`, …). */
export async function launch({ args = [], env = {}, recordVideo } = {}) {
  const { _electron } = await import('playwright');
  // Chromium's sandbox needs a setuid helper that containers and CI machines rarely have.
  const sandbox = process.platform === 'linux' ? ['--no-sandbox'] : [];
  return _electron.launch({ args: [desktop, ...sandbox, ...args], cwd: desktop, env: appEnv(env), recordVideo, timeout: 60_000 });
}

/** Bundles electron/*.ts into dist-electron/ (the app's `main`). */
export async function buildShell() {
  const { buildElectron } = await import('../scripts/build-electron.mjs');
  await buildElectron();
}

/** Playwright records WebM; MP4 (H.264) plays everywhere. Resolves with the MP4's path, or null without ffmpeg. */
export function toMp4(webm, mp4) {
  return new Promise((resolve) => {
    if (!existsSync(webm)) return resolve(null);
    // H.264 wants even sizes.
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('error', () => resolve(null));
    p.on('exit', (code) => resolve(code === 0 && existsSync(mp4) ? mp4 : null));
  });
}

/** Waits until `fn()` is truthy (it may be async), or throws after `ms`. */
export async function until(fn, what, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
