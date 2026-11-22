/* The core as the host uses it: a typed wrapper over the wasm-bindgen package built from core/wasm
   (docs/desktop-architecture.md, section 2). The package speaks JSON text; here tools take and give objects, and
   whatever the core throws arrives as an Error whose message is the tool's own text. */
import type { Platform } from './platform';
import { type Json, errorText, obj, toError } from './util';

/** Files, time and network for the core; every method is synchronous. A missing method means "not here". */
export interface HostIo {
  read?(path: string): Uint8Array;
  write?(path: string, data: Uint8Array): void;
  exists?(path: string): boolean;
  createDirAll?(path: string): void;
  homeDir?(): string | undefined;
  now?(): number;
  httpGet?(url: string): Uint8Array;
}

/** `Engine` in the package. */
export interface CoreEngine {
  execute(name: string, args: string, source: string): { json: string; images: Uint8Array[] };
  readonly name: string;
  readonly path: string | undefined;
  readonly dirty: boolean;
  readonly revision: number;
  readonly isSprite: boolean;
  readonly size: number[];
  markClean(): void;
  autosave(to?: string): void;
  rename(to: string | undefined, name: string): void;
  onChange(fn: (tool: string) => void): void;
  setHostTool(name: string, fn: (argsJson: string) => { json: string; images?: Uint8Array[] }): void;
  free(): void;
}

/** The initialised package (`HostOptions.core`). */
export interface CorePackage {
  Engine: new (io?: HostIo) => CoreEngine;
  version(): string;
  toolCatalog(): string;
  buildSample(engine: CoreEngine, threeD: boolean): void;
  /** What check_for_updates answers for this feed text, as JSON (Updates.report in the Swift source). The host
      fetches the feed itself, since the core's own `httpGet` cannot wait for the network here. */
  updateReport?(feedXml: string): string;
}

export type Source = 'person' | 'agent' | 'sample' | 'home';

/** What a tool call returns: a JSON object, plus PNG pictures for review tools. */
export interface ToolOutput {
  json: Json;
  images: Uint8Array[];
}

/** The core's files and clock on this platform. No `httpGet`: the network cannot be waited for here. */
export function hostIo(platform: Platform): HostIo {
  const { fs, paths } = platform;
  return {
    read: (path) => fs.read(path),
    write: (path, data) => fs.write(path, data),
    exists: (path) => fs.exists(path),
    createDirAll: (path) => fs.createDirAll(path),
    homeDir: () => paths.home,
    now: () => platform.now(),
  };
}

export class Core {
  readonly pkg: CorePackage;
  private readonly io: HostIo;

  constructor(pkg: unknown, platform: Platform) {
    const p = pkg as Partial<CorePackage> | null | undefined;
    if (!p || typeof p.Engine !== 'function' || typeof p.version !== 'function' || typeof p.buildSample !== 'function') {
      throw new Error('OpenPixel could not load its core.');
    }
    this.pkg = p as CorePackage;
    this.io = hostIo(platform);
  }

  version(): string {
    return this.pkg.version();
  }

  /** A 32×32×32 model called "Untitled" with the db32 palette. */
  engine(): Engine {
    return new Engine(this.pkg, this.io);
  }

  /** Builds the 2D mushroom or the 3D island sample into `engine`. */
  buildSample(engine: Engine, threeD: boolean): void {
    engine.run((raw) => this.pkg.buildSample(raw, threeD));
  }
}

/** One document with its undo history and every tool.

    The core tells about changes while a tool is still running, and it cannot be asked anything until that tool has
    returned. So `onChange` is called right after the call that caused the change, in order: by then the engine can
    be read and used again (the library redraws a file's preview from there, for one). */
export class Engine {
  /** Called after any change with the tool's name. */
  onChange: ((tool: string) => void) | null = null;
  private readonly raw: CoreEngine;
  private changes: string[] = [];
  private depth = 0;
  private telling = false;
  private freed = false;

  constructor(pkg: CorePackage, io?: HostIo) {
    this.raw = new pkg.Engine(io);
    this.raw.onChange((tool) => {
      this.changes.push(tool);
    });
  }

  /** Runs a tool. Throws Error(text) with the tool's own words. */
  execute(name: string, args: Json, source: Source): ToolOutput {
    return this.run((raw) => {
      const out = raw.execute(name, JSON.stringify(args), source);
      const result = { json: obj(JSON.parse(out.json)) ?? {}, images: Array.from(out.images ?? []) };
      // When the bindings hand the answer over as an object of the core's own, its memory goes back now.
      (out as { free?: () => void }).free?.();
      return result;
    });
  }

  get name(): string { return this.raw.name; }
  get path(): string | null { return this.raw.path ?? null; }
  get dirty(): boolean { return this.raw.dirty; }
  get revision(): number { return this.raw.revision; }
  /** One voxel deep: a 2D sprite. */
  get isSprite(): boolean { return this.raw.isSprite; }
  /** [x, y, z] */
  get size(): number[] { return Array.from(this.raw.size); }

  markClean(): void {
    this.run((raw) => raw.markClean());
  }

  /** Writes the document to `to` (or its own file) without logging a tool call; tells onChange "autosave". */
  autosave(to?: string): void {
    this.run((raw) => (to === undefined ? raw.autosave() : raw.autosave(to)));
  }

  /** The file moved to `to` (null: it has none yet) and is now called `name`; tells onChange "rename". */
  rename(to: string | null, name: string): void {
    this.run((raw) => raw.rename(to ?? undefined, name));
  }

  /** A tool the host answers itself (get_editor_screenshot). */
  setHostTool(name: string, fn: (args: Json) => ToolOutput): void {
    this.raw.setHostTool(name, (argsJson) => {
      const out = fn(obj(JSON.parse(argsJson)) ?? {});
      return { json: JSON.stringify(out.json), images: out.images };
    });
  }

  /** Gives the core's memory for this document back. The engine cannot be used afterwards. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.onChange = null;
    this.raw.free();
  }

  /** Calls into the core, then passes on the changes it reported. */
  run<T>(call: (raw: CoreEngine) => T): T {
    if (this.freed) throw new Error('This file is no longer open.');
    this.depth += 1;
    try {
      return call(this.raw);
    } catch (e) {
      throw toError(errorText(e) === '' ? 'failed' : e);
    } finally {
      this.depth -= 1;
      if (this.depth === 0) this.tell();
    }
  }

  private tell(): void {
    if (this.telling) return;
    this.telling = true;
    try {
      while (this.changes.length > 0) {
        const tool = this.changes.shift() as string;
        if (!this.freed) this.onChange?.(tool);
      }
    } finally {
      this.telling = false;
    }
  }
}
