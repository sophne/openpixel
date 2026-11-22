// Development: Vite serves the React page (with hot reload), esbuild keeps the Electron side bundled, and Electron
// shows the page from Vite. Electron starts again whenever its own code changes; closing the window ends it all.
//
//   npm run dev [-- <the app's arguments>]      e.g.  npm run dev -- --legacy-ui   or   npm run dev -- model.openpixel
//
// Linux without a graphics card or as root (containers): OPENPIXEL_SOFTWARE_GL=1 npm run dev -- --no-sandbox
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { buildElectron } from './build-electron.mjs';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appArgs = process.argv.slice(2);
const electron = createRequire(import.meta.url)('electron'); // the path of the Electron program

const vite = await createServer({ root: desktop, configFile: path.join(desktop, 'vite.config.ts') });
await vite.listen();
const url = vite.resolvedUrls?.local[0] ?? 'http://localhost:5173/';
console.log(`Vite: ${url}`);

let child = null, restarting = false, stopping = false;
function start() {
  // Chromium's own switches (--no-sandbox, …) go before the app's folder, the app's arguments after it.
  const switches = appArgs.filter((a) => a === '--no-sandbox' || a.startsWith('--enable-') || a.startsWith('--disable-'));
  const rest = appArgs.filter((a) => !switches.includes(a));
  child = spawn(electron, [...switches, desktop, ...rest], {
    stdio: 'inherit',
    // Electron refuses some of the caller's NODE_OPTIONS loudly (--use-openssl-ca); it needs none of them.
    env: { ...process.env, NODE_OPTIONS: '', OPENPIXEL_DEV_URL: url },
  });
  child.on('exit', (code) => {
    if (restarting) { restarting = false; start(); return; }
    stop(code ?? 0);
  });
}
async function stop(code) {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled([vite.close(), watcher?.dispose()]);
  process.exit(code);
}

let first = true;
const watcher = await buildElectron({
  watch: true,
  onRebuild() {
    if (first) { first = false; start(); return; }
    if (!child || restarting) return;
    console.log('Electron code changed: starting it again');
    restarting = true;
    child.kill();
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restarting = false; if (child) child.kill(); else stop(0); });
