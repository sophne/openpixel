/* The page's link to the app.
   In Electron the preload script provides window.openpixel (docs/desktop-architecture.md, section 1); the browser
   preview (desktop/web/main.ts) provides the same object itself. Opened without either (`npx vite`), there is no
   host: tools fail with "OpenPixel engine is not connected", native actions answer null, and Agent Chat talks to
   the scripted agent the chat area registers. */

export type Platform = 'darwin' | 'win32' | 'linux';
export interface HostFlags {
  start: 'home' | 'editor';
  uitest?: { folder: string; [k: string]: unknown };
  screenshot?: boolean;
  demo?: unknown;
}
export interface OpenPixelHost {
  /** Rejects with Error(text) on failure. */
  post(msg: Record<string, unknown>): Promise<any>;
  /** The system the page is shown for (a test can ask for another one's layout and wording). */
  platform: Platform;
  flags: HostFlags;
}

/** What the host calls on the page (window.PC). Built in lib/pc.ts. */
export interface PageCalls {
  updateAvailable(version: string | null): void;
  refresh(toolName?: string): void;
  showNewDialog(): void;
  githubStars(n: number): void;
  fullScreen(on: boolean): void;
  showHome(view?: string): Promise<void> | void;
  closeActiveTab(): boolean;
  showAgentHelp(): Promise<void> | void;
  chatEvent(e: Record<string, any>): void;
  chatMoved(from: string, to: string): void;
  command(cmd: string): void;
}

declare global {
  interface Window {
    openpixel?: OpenPixelHost;
    PC: PageCalls;
  }
}

const query = new URLSearchParams(location.search);

/** The host, or null when the page is opened without the app. */
export const host: OpenPixelHost | null = window.openpixel ?? null;
export const hasHost = host !== null;

/** Without a host the page shows macOS's wording, the one the markup is written in (lib/platform.ts);
 *  `?platform=win32` or `linux` tries another. */
const asked = query.get('platform');
export const platform: Platform = host ? host.platform : asked === 'win32' || asked === 'linux' ? asked : 'darwin';

export const flags: HostFlags = host ? host.flags : { start: 'editor' };
/** A --screenshot picture is of the page alone: it paints the glass's colour itself (html.screenshot in style.css). */
export const SCREENSHOT = flags.screenshot === true || query.has('screenshot');

/** `bridge.postMessage(msg)`: the name tests/uitest.js and tests/demo.js post through (null without the app).
 *  The page's own code uses post(). */
export const bridge: { postMessage(msg: Record<string, unknown>): Promise<any> } | null =
  host ? { postMessage: (msg) => host.post(msg) } : null;

/** Posts any message to the host (`{kind: 'frames'|'snap'|…}`). Resolves null without a host. */
export function post(msg: Record<string, unknown>): Promise<any> {
  return host ? host.post(msg) : Promise.resolve(null);
}

// The UI test swaps these two for a moment (`nativeAction = async () => true`); see testing/compat.ts.
type Call = (name: string, args?: Record<string, unknown>) => Promise<any>;
type Native = (action: string, extra?: Record<string, unknown>) => Promise<any>;
export const overrides: { call: Call | null; nativeAction: Native | null } = { call: null, nativeAction: null };

/** Runs one of the engine's tools (the same ones agents use). Rejects with the tool's error text. */
export async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (overrides.call) return overrides.call(name, args);
  if (!host) throw new Error('OpenPixel engine is not connected');
  return host.post({ kind: 'tool', name, args });
}
/** Asks the app for something only it can do (files, tabs, the library, the clipboard…). Null without a host. */
export function nativeAction(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (overrides.nativeAction) return overrides.nativeAction(action, extra);
  return host ? host.post({ kind: 'native', action, ...extra }) : Promise.resolve(null);
}

type ChatMock = (action: string, extra: Record<string, any>) => unknown;
let chatMock: ChatMock | null = null;
/** The chat area registers its scripted agent (chat/mock.ts) for the page opened without the app. */
export function setChatMock(fn: ChatMock | null): void { chatMock = fn; }
/** Agent Chat messages: providers, send, stop, skills, login, history, saveHistory. */
export function chatNative(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (host) return host.post({ kind: 'chat', action, ...extra });
  return Promise.resolve(chatMock ? chatMock(action, extra) : null); // the page opened in a browser, without the app
}
