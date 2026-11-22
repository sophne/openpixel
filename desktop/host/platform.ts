/* What the app's logic (desktop/host) needs from wherever it runs. Electron provides the real thing
   (desktop/electron); a browser build can provide an in-memory one. Nothing in host/ outside host/node/ may reach
   for Node or Electron directly: it goes through this. See docs/desktop-architecture.md. */

import type { ChatRunner, ChatRunnerOptions } from './chat-api';

/** A message from the page: {kind: 'tool' | 'native' | 'chat' | ..., ...}. */
export type PageMessage = Record<string, unknown> & { kind: string };

/** Synchronous files, like the engine and the Swift app used them. Paths are the operating system's own. */
export interface PlatformFS {
  read(path: string): Uint8Array;                       // throws Error(text) when it cannot
  write(path: string, data: Uint8Array | string): void; // atomic: write beside, then rename over
  exists(path: string): boolean;
  stat(path: string): { mtimeMs: number; size: number; isDirectory: boolean } | null;
  list(path: string): string[];                         // names in a folder ([] when it is not there)
  createDirAll(path: string, mode?: number): void;
  remove(path: string): void;                           // a file, or a folder with everything in it
  rename(from: string, to: string): void;
}

export interface PlatformPaths {
  home: string;
  /** Per-user data: Recents, chat history, preferences, the agents' socket.
      macOS ~/Library/Application Support/OpenPixel, Windows %APPDATA%\OpenPixel, Linux $XDG_DATA_HOME/OpenPixel. */
  data: string;
  /** Where new files are saved: ~/Documents/OpenPixel. */
  files: string;
  temp: string;
  sep: string;
  join(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string, ext?: string): string;
  extname(path: string): string;                        // ".openpixel"
  /** Absolute, with "." and ".." resolved; "~" expanded. Does not follow links. */
  normalize(path: string): string;
}

export interface PlatformUI {
  openPanel(options: { extensions: string[] }): Promise<string | null>;
  savePanel(options: { name: string; extension: string }): Promise<string | null>;
  askToSave(name: string): Promise<'save' | 'discard' | 'cancel'>;
  alert(title: string, text: string): Promise<void>;
  /** A newer version exists: tell the person and offer the download. */
  showUpdateDialog(info: { version: string; url?: string; notes?: string }): Promise<void>;
  copyText(text: string): void;
  openExternal(url: string): Promise<boolean>;
  reveal(path: string): boolean;
  /** The editor window as the person sees it, PNG. */
  screenshot(): Promise<Uint8Array>;
  setTitle(title: string, path: string | null, edited: boolean): void;
  /** Calls window.PC[fn](...args) in the page. */
  page(fn: string, ...args: unknown[]): void;
  /** Moves a file to the system's Trash; rejects with Error(text) when it cannot. Without it, deleting a file
      from the library removes it for good. */
  trash?(path: string): Promise<void>;
}

export interface Platform {
  os: 'darwin' | 'win32' | 'linux' | 'web';
  fs: PlatformFS;
  paths: PlatformPaths;
  ui: PlatformUI;
  /** Seconds since 1970. */
  now(): number;
  /** GET over the network; null when offline, blocked, or not 200. */
  fetchText(url: string, headers?: Record<string, string>): Promise<string | null>;
  /** Things only a desktop has; absent in a browser. host/node/ builds them for Electron. */
  desktop?: DesktopServices;
  /** The agents' socket and the test agents, from `nodePlatform`; absent in a browser. */
  local?: LocalServices;
}

/** Agents on this computer: the socket `openpixel --mcp` connects to, and the person's own agent CLIs for Agent Chat. */
export interface DesktopServices {
  /** The command agents run: the native `openpixel` program shipped with the app. */
  mcpCommand: string;
  /** Unix socket path, or the Windows pipe name. */
  socketPath: string;
}

/** What `nodePlatform` (host/node/platform-node.ts) adds for the agents on this computer. It arrives on the
    Platform as `local`; a shell that spreads the Node half into its Platform passes it along without knowing. */
export interface LocalServices {
  /** Starts the agents' socket at `path` (host/node/bridge.ts). Throws Error(text) when it cannot listen. */
  listen(path: string, handlers: BridgeHandlers): BridgeListener;
  /** UI tests: starts `command --mcp` like an agent would, introduces it as `client` and, with `call`, makes one
      tool call (host/node/test-agents.ts). Throws Error(text) when the program does not start. */
  spawnAgent(options: { command: string; socketPath: string; client: string; call: boolean }): void;
  /** UI tests: lets the agents `spawnAgent` started finish (closes their input and waits for them). */
  stopAgents(): Promise<void>;
  /** Ends whatever `spawnAgent` started, at once. */
  killAgents(): void;
}

/** What the agents' socket hands to the host. One connection is one agent's `openpixel --mcp`. */
export interface BridgeHandlers {
  /** One request line in, one reply line out (see Bridge.swift). A connection's lines are answered in order. */
  line(line: string, connection: number): string | Promise<string>;
  opened(connection: number): void;
  closed(connection: number): void;
  /** The socket could not be had after all (errors from the system arrive late): nothing listens. */
  failed?(error: string): void;
}

export interface BridgeListener {
  /** Where it listens: the path it was given, or on Windows the pipe that stands for it. */
  path: string;
  stop(): void;
}

export interface HostOptions {
  platform: Platform;
  /** The engine: the initialised wasm-bindgen package built from core/wasm (same one a browser loads). */
  core: unknown;
  /** The old --ui-test: an empty library in this folder, a private socket there, no network, no real agents. */
  uiTest?: string;
  /** --screenshot: a throwaway library, no autosave, no agents' socket. */
  screenshot?: boolean;
  /** A file to open at launch. */
  open?: string;
  /** Agent Chat (host/node/chat). Without it the chat answers as in a UI test: no agents, nothing starts. */
  chat?: (options: ChatRunnerOptions) => ChatRunner;
}

export interface Host {
  /** Answers one page message (`tool`, `native`, `chat`, and the test messages `spawnAgent`, `stopAgents`).
      Rejects with Error(text) when the old app would have answered with an error. */
  handle(msg: PageMessage): Promise<unknown>;
  /** 'home' or 'editor': what the page shows first (OPENPIXEL_START). */
  start(): 'home' | 'editor';
  /** A file handed over by the system (double-click, drag onto the icon). */
  openFile(path: string): void;
  /** The window is closing: autosaves, asks about what could not be saved. False when the person cancelled. */
  quitting(): Promise<boolean>;
  /** Stops timers, the agents' socket and running chats. */
  dispose(): void;
}
