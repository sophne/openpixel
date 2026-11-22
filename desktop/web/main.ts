/* The browser preview's entry: the same wasm-bindgen package Electron's main process loads (desktop/core-pkg), the
   same app logic (desktop/host), a Platform that keeps files in memory, and then the page as it is. What the
   preload script does in Electron (`window.openpixel`) happens here, before any of the page's modules run. */
import init, * as core from '../core-pkg/openpixel_wasm.js';
import { createHost } from '../host/index';
import type { PageMessage } from '../host/platform';
import { webPlatform } from './platform-web';

console.info('OpenPixel browser preview: files live in memory and are gone when the tab closes.');

const query = new URLSearchParams(location.search);

// Electron hands the engine's bytes over (initSync); a browser fetches the very same file.
await init({ module_or_path: new URL('../core-pkg/openpixel_wasm_bg.wasm', import.meta.url) });

const platform = webPlatform();
const host = createHost({ platform, core });

const asked = query.get('platform');
const shown: 'darwin' | 'win32' | 'linux' = asked === 'win32' || asked === 'linux' ? asked : 'darwin';

/** What the shell answers itself in Electron (electron/main.ts, `fromPage`): the window's own business. */
function shellOnly(msg: Record<string, unknown>): boolean {
  if (msg.kind === 'native') return msg.action === 'titlebar' || msg.action === 'haptic';
  return ['snap', 'resizeWindow', 'frames', 'uitestDone', 'demo'].includes(String(msg.kind));
}

/** One message from the page. Failures arrive as a plain Error with the app's own text, as from the preload. */
async function post(msg: Record<string, unknown>): Promise<unknown> {
  if (typeof msg?.kind !== 'string') throw new Error('bad message');
  if (shellOnly(msg)) return true;
  try {
    return await host.handle(msg as PageMessage);
  } catch (e) {
    throw new Error(String((e as Error)?.message ?? e));
  }
}

const w = window as unknown as Record<string, unknown>;
w.openpixel = { post, platform: shown, flags: { start: host.start() } };

// The classes Electron's preload puts on <html>. A browser has no glass behind the page, so the page paints the
// glass's colour itself, as it does on Windows and Linux.
document.documentElement.classList.add(`platform-${shown}`, 'screenshot');

// For tests/web-preview.mjs only: a look into the memory files.
if (query.has('test')) {
  w.__openpixelTest = {
    read: (path: string): number[] => Array.from(platform.memory.read(path)),
    exists: (path: string): boolean => platform.memory.exists(path),
    list: (path: string): string[] => platform.memory.list(path),
    paths: { home: platform.paths.home, data: platform.paths.data, files: platform.paths.files },
  };
}

await import('../src/main');
