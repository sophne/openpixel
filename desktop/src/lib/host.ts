/* The page's link to the app (app.js 6–20, 3329).
   In Electron the preload script provides window.openpixel; the messages are the ones the old page posted to
   window.webkit.messageHandlers.pc (docs/desktop-architecture.md, section 1). Opened in a plain browser there is no
   host, and the page behaves as the old one did without `bridge`: tools fail with "OpenPixel engine is not
   connected", native actions answer null, and Agent Chat talks to the scripted agent the chat area registers. */

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
  /** Tests can force 'darwin'. */
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
    /** The Mac app's web view (and Electron's preload, for the old page). */
    webkit?: { messageHandlers?: { pc?: { postMessage(msg: Record<string, unknown>): Promise<any> } } };
    OPENPIXEL_START?: string;
    OPENPIXEL_UITEST?: { folder: string; [k: string]: unknown };
    OPENPIXEL_SCREENSHOT?: boolean;
    OPENPIXEL_DEMO?: unknown;
  }
}

const query = new URLSearchParams(location.search);

function findHost(): OpenPixelHost | null {
  if (window.openpixel) return window.openpixel;
  // The same page inside the Mac app's web view: the old bridge and the old globals.
  const pc = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pc;
  if (!pc) return null;
  return {
    post: (msg) => pc.postMessage(msg),
    platform: 'darwin',
    flags: {
      start: window.OPENPIXEL_START === 'home' ? 'home' : 'editor',
      uitest: window.OPENPIXEL_UITEST,
      screenshot: window.OPENPIXEL_SCREENSHOT === true,
      demo: window.OPENPIXEL_DEMO,
    },
  };
}

/** The host, or null when the page is opened without the app. */
export const host: OpenPixelHost | null = findHost();
export const hasHost = host !== null;

/** Without a host the page shows what the old page showed: the Mac's labels. `?platform=win32` tries another one. */
const asked = query.get('platform');
export const platform: Platform = host ? host.platform : asked === 'win32' || asked === 'linux' ? asked : 'darwin';

export const flags: HostFlags = host ? host.flags : {
  start: window.OPENPIXEL_START === 'home' ? 'home' : 'editor',
  uitest: window.OPENPIXEL_UITEST,
  demo: window.OPENPIXEL_DEMO,
};
/** A --screenshot picture is of the page alone: it paints the glass's colour itself (html.screenshot in style.css). */
export const SCREENSHOT = flags.screenshot === true || window.OPENPIXEL_SCREENSHOT === true || query.has('screenshot');

/** The old page's `bridge` (null without the app). New code uses post(); this is for the UI test and the demo script. */
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
/** The chat area registers its scripted agent (chatMock, app.js 4219) for the page opened without the app. */
export function setChatMock(fn: ChatMock | null): void { chatMock = fn; }
/** Agent Chat messages: providers, send, stop, skills, login, history, saveHistory. */
export function chatNative(action: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (host) return host.post({ kind: 'chat', action, ...extra });
  return Promise.resolve(chatMock ? chatMock(action, extra) : null); // the page opened in a browser, without the app
}
