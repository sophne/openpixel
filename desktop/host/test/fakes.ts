/* Stand-ins for the host's checks: a core with the wasm package's surface and a scripted engine behind it, and a
   Platform that lives in memory. The fake engine is as strict as the real one about being used while a tool is
   still running. */
import * as posix from 'node:path/posix';
import type { ChatRunner, ChatRunnerOptions } from '../chat-api';
import type { CoreEngine, CorePackage, HostIo } from '../core';
import type { BridgeHandlers, Platform, PlatformFS, PlatformPaths, PlatformUI } from '../platform';

const enc = new TextEncoder();
const dec = new TextDecoder();

// MARK: - the core

interface FakeFile {
  format: 'fake';
  name: string;
  size: number[];
  pixels: number;
}

export class FakeEngine implements CoreEngine {
  static made = 0;
  static freed = 0;
  /** Every tool call any engine got: "source:tool". */
  static calls: string[] = [];

  private _name = 'Untitled';
  private _path: string | undefined;
  private _dirty = false;
  private _revision = 0;
  private _size = [32, 32, 32];
  pixels = 0;
  private busy = false;
  private gone = false;
  private change: ((tool: string) => void) | null = null;
  private hostTools = new Map<string, (argsJson: string) => { json: string; images?: Uint8Array[] }>();
  private readonly io: HostIo;

  constructor(io?: HostIo) {
    this.io = io ?? {};
    FakeEngine.made += 1;
  }

  /** The real engine cannot be read or used while one of its tools runs (or after free). */
  private guard(): void {
    if (this.gone) throw new Error('null pointer passed to rust');
    if (this.busy) throw new Error('recursive use of an object detected which would lead to unsafe aliasing in rust');
  }

  private during<T>(f: () => T): T {
    this.guard();
    this.busy = true;
    try {
      return f();
    } finally {
      this.busy = false;
    }
  }

  private tell(tool: string): void {
    this.change?.(tool);
  }

  private file(): Uint8Array {
    const f: FakeFile = { format: 'fake', name: this._name, size: this._size, pixels: this.pixels };
    return enc.encode(JSON.stringify(f));
  }

  private writeTo(path: string): void {
    if (path.includes('readonly')) throw new Error(`cannot write ${path}`);
    if (!this.io.write) throw new Error('no files here');
    this.io.write(path, this.file());
  }

  execute(name: string, argsJson: string, source: string): { json: string; images: Uint8Array[] } {
    return this.during(() => {
      FakeEngine.calls.push(`${source}:${name}`);
      const args = JSON.parse(argsJson) as Record<string, unknown>;
      const done = (json: Record<string, unknown> = {}, images: Uint8Array[] = []) => ({ json: JSON.stringify(json), images });
      switch (name) {
        case 'new_sprite':
        case 'new_model': {
          if (args.width === 0) throw new Error('width must be at least 1');
          this._size = [Number(args.width ?? 32), Number(args.height ?? 32), name === 'new_sprite' ? 1 : Number(args.depth ?? 32)];
          this._name = typeof args.name === 'string' ? args.name : 'Untitled';
          this._path = undefined;
          this.pixels = 0;
          this._dirty = true;
          this._revision += 1;
          this.tell(name);
          return done({ revision: this._revision });
        }
        case 'open_model': {
          const path = String(args.path);
          if (!this.io.read || !this.io.exists?.(path)) throw new Error(`cannot open ${path}`);
          let f: FakeFile;
          try {
            f = JSON.parse(dec.decode(this.io.read(path))) as FakeFile;
          } catch {
            throw new Error(`${path} is not an OpenPixel file`);
          }
          this._name = f.name;
          this._size = f.size;
          this.pixels = f.pixels;
          // An imported .vox has no file of its own yet.
          this._path = path.endsWith('.vox') ? undefined : path;
          this._dirty = false;
          this.tell('open_model');
          return done({ name: this._name });
        }
        case 'save_model': {
          const path = typeof args.path === 'string' ? args.path : this._path;
          if (path === undefined) throw new Error('no file to save to');
          this.writeTo(path);
          this._path = path;
          this._dirty = false;
          this.tell('save_model');
          return done({ path });
        }
        case 'set_pixels':
          this.pixels += 1;
          this._revision += 1;
          this._dirty = true;
          this.tell('set_pixels');
          return done({ revision: this._revision });
        case 'render_view':
          return done({ scale: args.scale ?? null }, [new Uint8Array([137, 80, 78, 71, ...this._size, Number(args.scale ?? 0)])]);
        case 'get_model_info':
          return done({ name: this._name, size: this._size, pixels: this.pixels });
        case 'export_png':
        case 'export_sheet':
          this.writeTo(String(args.path));
          return done({ path: args.path, scale: args.scale ?? 1 });
        case 'get_editor_screenshot': {
          const tool = this.hostTools.get(name);
          if (!tool) throw new Error('No OpenPixel window is open.');
          const out = tool(argsJson);
          return { json: out.json, images: out.images ?? [] };
        }
        default:
          throw new Error(`unknown tool ${name}`);
      }
    });
  }

  get name(): string { this.guard(); return this._name; }
  get path(): string | undefined { this.guard(); return this._path; }
  get dirty(): boolean { this.guard(); return this._dirty; }
  get revision(): number { this.guard(); return this._revision; }
  get isSprite(): boolean { this.guard(); return this._size[2] === 1; }
  get size(): number[] { this.guard(); return [...this._size]; }

  markClean(): void {
    this.guard();
    this._dirty = false;
  }

  autosave(to?: string): void {
    this.during(() => {
      const path = to ?? this._path;
      if (path === undefined) throw new Error('no file to save to');
      this.writeTo(path);
      this._path = path;
      this._dirty = false;
      this.tell('autosave');
    });
  }

  rename(to: string | undefined, name: string): void {
    this.during(() => {
      this._path = to;
      this._name = name;
      this.tell('rename');
    });
  }

  onChange(fn: (tool: string) => void): void {
    this.change = fn;
  }

  setHostTool(name: string, fn: (argsJson: string) => { json: string; images?: Uint8Array[] }): void {
    this.hostTools.set(name, fn);
  }

  free(): void {
    this.guard();
    this.gone = true;
    FakeEngine.freed += 1;
  }

  /** What buildSample does to an engine. */
  sample(threeD: boolean): void {
    this.during(() => {
      this._name = threeD ? 'Island' : 'Mushroom';
      this._size = threeD ? [24, 24, 24] : [16, 16, 1];
      this.pixels = 99;
      this._dirty = false;
      this.tell('new_model');
    });
  }

  /** For tests: a change the engine could not save by itself keeps it dirty. */
  lockFile(): void {
    this._path = '/readonly/locked.openpixel';
    this._dirty = true;
  }
}

/** The wasm package, faked. `updateReport` is only there when asked for (a core without it answers "unknown"). It
    reads the feed the way the real core does: the top-level `version:` line of electron-builder's file. */
export function fakeCore(options: { updates?: boolean } = {}): CorePackage {
  FakeEngine.made = 0;
  FakeEngine.freed = 0;
  FakeEngine.calls = [];
  const core: CorePackage = {
    Engine: FakeEngine,
    version: () => '1.0.0',
    toolCatalog: () => '[]',
    buildSample: (engine, threeD) => (engine as FakeEngine).sample(threeD),
  };
  if (options.updates) {
    core.updateReport = (feed, os) => {
      FakeEngine.calls.push(`updateReport:${os ?? ''}`);
      const m = /^version: ([0-9][0-9A-Za-z.+-]*)$/m.exec(feed);
      if (!m) throw new Error('the update feed lists no release');
      const latest = m[1] as string;
      const newer = latest !== '1.0.0';
      return JSON.stringify({
        running_version: '1.0.0', latest_version: latest, update_available: newer,
        download: 'https://openpixel.dev/downloads', release_notes: `https://github.com/sophne/openpixel/releases/tag/v${latest}`,
        next: newer ? `Tell the person OpenPixel ${latest} is out.` : 'OpenPixel is up to date.',
      });
    };
  }
  return core;
}

// MARK: - the platform

export class MemoryFS implements PlatformFS {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>(['/']);
  /** Paths whose rename fails, to see what the host says then. */
  stuck = new Set<string>();

  read(path: string): Uint8Array {
    const data = this.files.get(path);
    if (!data) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return data;
  }
  readText(path: string): string {
    return dec.decode(this.read(path));
  }
  write(path: string, data: Uint8Array | string): void {
    if (!this.dirs.has(posix.dirname(path))) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    this.files.set(path, typeof data === 'string' ? enc.encode(data) : data);
  }
  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  stat(path: string): { mtimeMs: number; size: number; isDirectory: boolean } | null {
    const data = this.files.get(path);
    if (data) return { mtimeMs: 0, size: data.length, isDirectory: false };
    return this.dirs.has(path) ? { mtimeMs: 0, size: 0, isDirectory: true } : null;
  }
  list(path: string): string[] {
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) if (p !== path && posix.dirname(p) === path) names.add(posix.basename(p));
    return [...names].sort();
  }
  createDirAll(path: string): void {
    for (let p = path; !this.dirs.has(p); p = posix.dirname(p)) this.dirs.add(p);
  }
  remove(path: string): void {
    this.files.delete(path);
    for (const p of [...this.files.keys()]) if (p.startsWith(path + '/')) this.files.delete(p);
    for (const p of [...this.dirs]) if (p === path || p.startsWith(path + '/')) this.dirs.delete(p);
  }
  rename(from: string, to: string): void {
    const data = this.files.get(from);
    if (!data || this.stuck.has(from)) throw new Error(`EPERM: operation not permitted, rename '${from}' -> '${to}'`);
    this.files.delete(from);
    this.files.set(to, data);
  }
  /** A file as the fake engine writes it. */
  addModel(path: string, name: string, size = [16, 16, 1]): void {
    this.createDirAll(posix.dirname(path));
    this.write(path, JSON.stringify({ format: 'fake', name, size, pixels: 3 }));
  }
}

export class RecordingUI implements PlatformUI {
  /** Everything asked of the window, in order: "page refresh set_pixels", "alert OpenPixel: …", … */
  log: string[] = [];
  pages: [string, ...unknown[]][] = [];
  titles: { title: string; path: string | null; edited: boolean }[] = [];
  /** What the next panels answer (null: cancelled). */
  openAnswers: (string | null)[] = [];
  saveAnswers: (string | null)[] = [];
  askAnswers: ('save' | 'discard' | 'cancel')[] = [];
  saveOptions: { name: string; extension: string }[] = [];
  updateDialogs: { version: string; url?: string; notes?: string }[] = [];
  clipboard = '';
  png: Uint8Array | null = new Uint8Array([137, 80, 78, 71]);
  trashed: string[] = [];
  trash?: (path: string) => Promise<void>;

  async openPanel(options: { extensions: string[] }): Promise<string | null> {
    this.log.push(`openPanel ${options.extensions.join(',')}`);
    return this.openAnswers.shift() ?? null;
  }
  async savePanel(options: { name: string; extension: string }): Promise<string | null> {
    this.log.push(`savePanel ${options.name}`);
    this.saveOptions.push(options);
    return this.saveAnswers.shift() ?? null;
  }
  async askToSave(name: string): Promise<'save' | 'discard' | 'cancel'> {
    this.log.push(`askToSave ${name}`);
    return this.askAnswers.shift() ?? 'cancel';
  }
  async alert(title: string, text: string): Promise<void> {
    this.log.push(`alert ${title}: ${text}`);
  }
  async showUpdateDialog(info: { version: string; url?: string; notes?: string }): Promise<void> {
    this.log.push(`updateDialog ${info.version}`);
    this.updateDialogs.push(info);
  }
  copyText(text: string): void {
    this.clipboard = text;
  }
  async openExternal(url: string): Promise<boolean> {
    this.log.push(`openExternal ${url}`);
    return true;
  }
  reveal(path: string): boolean {
    this.log.push(`reveal ${path}`);
    return true;
  }
  async screenshot(): Promise<Uint8Array> {
    if (!this.png) throw new Error('no window');
    return this.png;
  }
  setTitle(title: string, path: string | null, edited: boolean): void {
    this.titles.push({ title, path, edited });
  }
  page(fn: string, ...args: unknown[]): void {
    this.pages.push([fn, ...args]);
    this.log.push(`page ${fn} ${args.map((a) => JSON.stringify(a)).join(' ')}`.trimEnd());
  }
  /** The `PC.<fn>` calls so far, as text, and forgets them. */
  takePages(fn?: string): string[] {
    const out = this.pages.filter((p) => fn === undefined || p[0] === fn).map(([name, ...args]) => `${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`);
    this.pages = [];
    return out;
  }
  get title(): { title: string; path: string | null; edited: boolean } | undefined {
    return this.titles[this.titles.length - 1];
  }
}

export const HOME = '/home/me';

export function memoryPaths(): PlatformPaths {
  return {
    home: HOME,
    data: `${HOME}/.local/share/OpenPixel`,
    files: `${HOME}/Documents/OpenPixel`,
    temp: '/tmp',
    sep: '/',
    join: (...parts) => posix.join(...parts),
    dirname: (p) => posix.dirname(p),
    basename: (p, ext) => posix.basename(p, ext),
    extname: (p) => posix.extname(p),
    normalize: (p) => posix.resolve('/', p === '~' ? HOME : p.startsWith('~/') ? posix.join(HOME, p.slice(2)) : p),
  };
}

export interface MemoryPlatform extends Platform {
  fs: MemoryFS;
  ui: RecordingUI;
  /** The clock: seconds since 1970, moved by hand. */
  clock: { now: number };
  /** What the network answers, by address (absent: offline). Every request is noted in `fetched`. */
  web: Map<string, string>;
  fetched: { url: string; headers: Record<string, string> | undefined }[];
  /** The agents' socket, when the host started it: lines can be fed in as an agent would send them. */
  socket: { path: string; handlers: BridgeHandlers; stopped: boolean } | null;
  spawned: { command: string; socketPath: string; client: string; call: boolean }[];
}

export function memoryPlatform(options: { desktop?: boolean; os?: Platform['os'] } = {}): MemoryPlatform {
  const fs = new MemoryFS();
  fs.createDirAll(HOME);
  fs.createDirAll('/tmp');
  const p: MemoryPlatform = {
    os: options.os ?? 'linux',
    fs,
    paths: memoryPaths(),
    ui: new RecordingUI(),
    clock: { now: 1_800_000_000 },
    web: new Map(),
    fetched: [],
    socket: null,
    spawned: [],
    now: () => p.clock.now,
    fetchText: async (url, headers) => {
      p.fetched.push({ url, headers });
      return p.web.get(url) ?? null;
    },
  };
  if (options.desktop !== false) {
    p.desktop = { mcpCommand: '/opt/OpenPixel/openpixel', socketPath: `${p.paths.data}/openpixel.sock` };
    p.local = {
      listen: (path, handlers) => {
        const socket = { path, handlers, stopped: false };
        p.socket = socket;
        return { path, stop: () => { socket.stopped = true; } };
      },
      spawnAgent: (o) => { p.spawned.push(o); },
      stopAgents: async () => { p.spawned = []; },
      killAgents: () => { p.spawned = []; },
    };
  }
  return p;
}

// MARK: - Agent Chat

export class FakeChat implements ChatRunner {
  log: string[] = [];
  readonly options: ChatRunnerOptions;
  constructor(options: ChatRunnerOptions) {
    this.options = options;
  }
  async providersForPage(): Promise<unknown[]> { return [{ id: 'claude-code', ready: true }]; }
  async start(body: Record<string, unknown>): Promise<unknown> {
    this.log.push(`start ${String(body.chat)}`);
    this.options.emit({ t: 'done', chat: body.chat, ok: true });
    return true;
  }
  stop(chat: string): void { this.log.push(`stop ${chat}`); }
  async skillsForPage(provider: string): Promise<unknown[]> { return [{ name: 'pixel-tips', provider }]; }
  login(provider: string): unknown { return provider === 'cursor' ? true : 'Nothing to sign in to.'; }
  loadHistory(key: string): unknown { return key === '' ? null : { key }; }
  saveHistory(key: string, data: unknown): unknown { this.log.push(`save ${key} ${JSON.stringify(data)}`); return key !== ''; }
  moveHistory(from: string, to: string): void { this.log.push(`move ${from} -> ${to}`); }
  deleteHistory(id: string): void { this.log.push(`delete ${id}`); }
  stopAll(): void { this.log.push('stopAll'); }
}
