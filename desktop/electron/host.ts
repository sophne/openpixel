import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { Host, HostOptions, Platform, PlatformUI } from '../host/platform';
import * as seam from './seam';

/* Puts the app together: the Platform (the window's half from main.ts, the Node half from desktop/host/node), the
   core (the Rust engine as WebAssembly) and the app's logic (desktop/host), which runs here in the main process.
   See docs/desktop-architecture.md §3. */

export interface AppHostOptions {
  /** Dialogs, clipboard, screenshots, the title, calls into the page: what main.ts does with the window. */
  ui: PlatformUI;
  uiTest?: string;
  screenshot?: boolean;
  open?: string;
  /** The desktop/ folder (the app's root; inside app.asar once installed). */
  desktopFolder: string;
  packaged: boolean;
  resourcesPath: string;
}

/** The command agents run: the native `openpixel` program. The one named in OPENPIXEL_MCP, the one shipped inside
    the installed app, or a local build (release before debug; the release path when there is neither). */
export function findMcpCommand(o: Pick<AppHostOptions, 'desktopFolder' | 'packaged' | 'resourcesPath'>): string {
  const exe = process.platform === 'win32' ? 'openpixel.exe' : 'openpixel';
  if (process.env.OPENPIXEL_MCP) return path.resolve(process.env.OPENPIXEL_MCP);
  if (o.packaged) return path.join(o.resourcesPath, 'core', exe);
  const builds = ['release', 'debug'].map((kind) => path.join(o.desktopFolder, '..', 'core', 'target', kind, exe));
  return builds.find((p) => existsSync(p)) ?? builds[0];
}

export async function createAppHost(o: AppHostOptions): Promise<Host> {
  const { socketPath = '', ...half } = seam.nodePlatform?.({ uiTest: o.uiTest, screenshot: o.screenshot }) ?? {};
  const platform = {
    os: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
    now: () => Date.now() / 1000,
    ...half,
    ui: o.ui,
    desktop: { mcpCommand: findMcpCommand(o), socketPath },
  } as Platform;
  const options: HostOptions = { platform, core: undefined, uiTest: o.uiTest, screenshot: o.screenshot, open: o.open };

  // Development and the shell's own tests: any module that exports `createHost` can stand in for the app's logic
  // (tests/fake-host.mjs). It gets the same platform, and no core.
  const fake = process.env.OPENPIXEL_FAKE_HOST;
  if (fake) {
    const stand: { createHost(options: HostOptions): Host } = await import(pathToFileURL(path.resolve(fake)).href);
    return stand.createHost(options);
  }
  if (!seam.createHost || !seam.nodePlatform || !seam.core) {
    throw new Error(`This build of OpenPixel has no app logic: ${seam.missing} was not there when it was bundled.`
      + ' Build the core (`npm run build:core`) and bundle again, or set OPENPIXEL_FAKE_HOST.');
  }
  // The engine's bytes sit next to this bundle (scripts/build-electron.mjs puts them there). Node gets them
  // handed over; the address a browser would fetch them from is never used.
  seam.core.initSync({ module: readFileSync(path.join(__dirname, 'core.wasm')) });
  return seam.createHost({ ...options, core: seam.core });
}
