import { contextBridge, ipcRenderer } from 'electron';

/* The only door between the page and the app (docs/desktop-architecture.md §1). The page gets `window.openpixel`
   and, so the old page in app/web runs unchanged, the names the Mac app gave it: `window.webkit.messageHandlers.pc`
   and the OPENPIXEL_* flags. Nothing else of Electron or Node reaches the page. */

interface Hello {
  platform: 'darwin' | 'win32' | 'linux';
  flags: { start: 'home' | 'editor'; uitest?: { folder: string }; screenshot?: boolean; demo?: unknown };
  /** Classes for <html>: `platform-…`, and `screenshot` where the window has no glass behind the page. */
  classes: string[];
}
const hello: Hello = ipcRenderer.sendSync('openpixel:hello');

/** Sends one message to the app and waits for its answer. Failures arrive as a plain Error with the app's own
    text (not Electron's "Error invoking remote method…"), because the page shows `e.message` to the person. */
async function post(msg: unknown): Promise<unknown> {
  const r: { ok: boolean; result?: unknown; error?: string } = await ipcRenderer.invoke('openpixel:post', msg);
  if (r.ok) return r.result;
  throw new Error(r.error ?? 'failed');
}

contextBridge.exposeInMainWorld('openpixel', { post, platform: hello.platform, flags: hello.flags });
contextBridge.exposeInMainWorld('webkit', { messageHandlers: { pc: { postMessage: post } } });
contextBridge.exposeInMainWorld('OPENPIXEL_START', hello.flags.start);
if (hello.flags.uitest) contextBridge.exposeInMainWorld('OPENPIXEL_UITEST', hello.flags.uitest);
if (hello.flags.screenshot) contextBridge.exposeInMainWorld('OPENPIXEL_SCREENSHOT', true);
if (hello.flags.demo !== undefined) contextBridge.exposeInMainWorld('OPENPIXEL_DEMO', hello.flags.demo);

// The classes go on <html> the moment it exists, before any style applies, so nothing is drawn without them.
const mark = (): boolean => {
  if (!document.documentElement) return false;
  document.documentElement.classList.add(...hello.classes);
  return true;
};
if (!mark()) new MutationObserver((_, o) => { if (mark()) o.disconnect(); }).observe(document, { childList: true });
