/* The home screen's library: recently opened or saved files (path, name, size and a small preview picture),
   the folders the person sorts them into, what they archived, and the built-in samples. Folders and the archive
   only organise this list; files stay where they are on disk until they are deleted forever (then they go to the
   Trash). Kept in the data folder (recents.json, library.json and thumbs/). Nothing leaves this computer.
   Port of Recents.swift. */
import type { Core, Engine } from './core';
import type { Platform } from './platform';
import { type Json, errorText, obj, pngDataURL, text } from './util';

export interface Entry {
  path: string;
  name: string;
  kind: string;
  size: number[];
  touched: number;
  thumb?: string;
  /** The library folder it sits in (absent: top level). */
  folder?: string;
  archived?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parent?: string;
  created: number;
}

/** Where a built-in sample sits in the library, and whether it was archived or deleted. */
export interface SampleState {
  folder?: string;
  archived?: boolean;
  deleted?: boolean;
}

export interface Library {
  folders: Folder[];
  samples: Record<string, SampleState>;
}

/** Loose files kept in Recents; files in folders or in the archive are never dropped. */
export const LIMIT = 40;
export const SAMPLE_IDS = ['sample2d', 'sample3d'];

const isText = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number';
const optional = <T>(v: unknown, is: (v: unknown) => v is T): v is T | undefined | null => v === undefined || v === null || is(v);
const isFlag = (v: unknown): v is boolean => typeof v === 'boolean';

/** The files as they were written (by this app or the Mac app). One entry that does not fit and nothing is read,
    as before. */
function readEntries(v: unknown): Entry[] | null {
  if (!Array.isArray(v)) return null;
  const out: Entry[] = [];
  for (const item of v) {
    const e = obj(item);
    if (!e || !isText(e.path) || !isText(e.name) || !isText(e.kind) || !isNumber(e.touched)) return null;
    if (!Array.isArray(e.size) || !e.size.every(Number.isInteger)) return null;
    if (!optional(e.thumb, isText) || !optional(e.folder, isText) || !optional(e.archived, isFlag)) return null;
    const entry: Entry = { path: e.path, name: e.name, kind: e.kind, size: e.size as number[], touched: e.touched };
    if (isText(e.thumb)) entry.thumb = e.thumb;
    if (isText(e.folder)) entry.folder = e.folder;
    if (isFlag(e.archived)) entry.archived = e.archived;
    out.push(entry);
  }
  return out;
}

function readLibrary(v: unknown): Library | null {
  const o = obj(v);
  const samples = o && obj(o.samples);
  if (!o || !samples || !Array.isArray(o.folders)) return null;
  const lib: Library = { folders: [], samples: {} };
  for (const item of o.folders) {
    const f = obj(item);
    if (!f || !isText(f.id) || !isText(f.name) || !isNumber(f.created) || !optional(f.parent, isText)) return null;
    const folder: Folder = { id: f.id, name: f.name, created: f.created };
    if (isText(f.parent)) folder.parent = f.parent;
    lib.folders.push(folder);
  }
  for (const [id, item] of Object.entries(samples)) {
    const s = obj(item);
    if (!s || !optional(s.folder, isText) || !optional(s.archived, isFlag) || !optional(s.deleted, isFlag)) return null;
    const state: SampleState = {};
    if (isText(s.folder)) state.folder = s.folder;
    if (isFlag(s.archived)) state.archived = s.archived;
    if (isFlag(s.deleted)) state.deleted = s.deleted;
    lib.samples[id] = state;
  }
  return lib;
}

/** Stable name per path (FNV-1a over its UTF-8 bytes). */
export function thumbName(path: string): string {
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(path)) h = BigInt.asUintN(64, (h ^ BigInt(b)) * 0x100000001b3n);
  return h.toString(16).padStart(16, '0') + '.png';
}

export function cleanName(s: string | null | undefined, fallback: string): string {
  const t = (s ?? '').trim();
  return t === '' ? fallback : Array.from(t).slice(0, 120).join('');
}

export class Recents {
  readonly folder: string;
  entries: Entry[] = [];
  library: Library = { folders: [], samples: {} };
  private readonly platform: Platform;
  private readonly core: Core;
  private sampleCache: Json[] | null = null;

  constructor(platform: Platform, core: Core, folder: string, load = true) {
    this.platform = platform;
    this.core = core;
    this.folder = folder;
    const { fs, paths } = platform;
    try {
      fs.createDirAll(paths.join(folder, 'thumbs'));
    } catch {
      // The library then stays in memory for this run.
    }
    if (load) {
      this.entries = readEntries(this.readJSON('recents.json')) ?? [];
      this.library = readLibrary(this.readJSON('library.json')) ?? { folders: [], samples: {} };
    }
  }

  private readJSON(name: string): unknown {
    try {
      return JSON.parse(text(this.platform.fs.read(this.platform.paths.join(this.folder, name))));
    } catch {
      return undefined;
    }
  }

  private thumb(name: string): string {
    return this.platform.paths.join(this.folder, 'thumbs', name);
  }

  save(): void {
    const { fs, paths } = this.platform;
    try {
      fs.write(paths.join(this.folder, 'recents.json'), JSON.stringify(this.entries));
      fs.write(paths.join(this.folder, 'library.json'), JSON.stringify(this.library));
    } catch {
      // Kept in memory; the next change tries again.
    }
  }

  /** Records an engine's file (after an open or a save) with a fresh preview. Opening an archived file brings it back. */
  touch(engine: Engine): void {
    const path = engine.path;
    if (path === null) return;
    const { fs, paths } = this.platform;
    const [sx = 1, sy = 1, sz = 1] = engine.size;
    const sprite = engine.isSprite;
    const name = thumbName(path);
    const scale = sprite ? Math.max(1, Math.trunc(128 / Math.max(sx, sy))) : Math.max(1, Math.trunc(160 / (Math.max(sx, sy, sz) * 2)));
    try {
      const png = engine.execute('render_view', { frame: 0, scale }, 'home').images[0];
      if (png) fs.write(this.thumb(name), png);
    } catch {
      // No preview this time.
    }
    const old = this.entries.find((e) => e.path === path);
    this.entries = this.entries.filter((e) => e.path !== path);
    const entry: Entry = {
      path,
      name: paths.basename(path, paths.extname(path)),
      kind: sprite ? '2d' : '3d',
      size: [sx, sy, sz],
      touched: this.platform.now(),
      thumb: name,
    };
    const folder = old?.folder;
    if (folder !== undefined && this.library.folders.some((f) => f.id === folder)) entry.folder = folder;
    if (old?.archived !== undefined) entry.archived = old.archived;
    this.entries.unshift(entry);
    let loose = 0;
    this.entries = this.entries.filter((e) => {
      if (e.folder !== undefined || e.archived === true) return true;
      loose += 1;
      return loose <= LIMIT;
    });
    this.save();
  }

  remove(path: string): void {
    this.entries = this.entries.filter((e) => e.path !== path);
    this.save();
  }

  // MARK: - folders

  folderExists(id: string | null | undefined): boolean {
    return id === null || id === undefined || this.library.folders.some((f) => f.id === id);
  }

  /** The folder and every folder inside it, at any depth. */
  subtree(id: string): Set<string> {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of this.library.folders) {
        if (!out.has(f.id) && f.parent !== undefined && out.has(f.parent)) {
          out.add(f.id);
          grew = true;
        }
      }
    }
    return out;
  }

  createFolder(name: string | null | undefined, parent: string | null | undefined): string | null {
    if (!this.folderExists(parent)) return null;
    const id = crypto.randomUUID().toLowerCase();
    const folder: Folder = { id, name: cleanName(name, 'New folder'), created: this.platform.now() };
    if (typeof parent === 'string') folder.parent = parent;
    this.library.folders.push(folder);
    this.save();
    return id;
  }

  /** A file was renamed on disk: its entry (folder, archive, preview) moves with it. */
  renamePath(old: string, to: string): void {
    const e = this.entries.find((x) => x.path === old);
    if (!e) return;
    const { fs, paths } = this.platform;
    const newThumb = thumbName(to);
    if (e.thumb !== undefined) {
      try {
        fs.rename(this.thumb(e.thumb), this.thumb(newThumb));
      } catch {
        // The preview is made again the next time the file is saved.
      }
    }
    e.path = to;
    e.name = paths.basename(to, paths.extname(to));
    e.thumb = newThumb;
    this.save();
  }

  renameFolder(id: string, name: string | null | undefined): boolean {
    const f = this.library.folders.find((x) => x.id === id);
    if (!f) return false;
    f.name = cleanName(name, f.name);
    this.save();
    return true;
  }

  /** Moves a folder into another one (null: top level). A folder can't go inside itself. */
  moveFolder(id: string, parent: string | null | undefined): boolean {
    const f = this.library.folders.find((x) => x.id === id);
    if (!f || !this.folderExists(parent)) return false;
    if (typeof parent === 'string') {
      if (this.subtree(id).has(parent)) return false;
      f.parent = parent;
    } else {
      delete f.parent;
    }
    this.save();
    return true;
  }

  /** Deletes a folder and the folders inside it. Their files go to the archive (at the top level when restored). */
  deleteFolder(id: string): boolean {
    if (!this.library.folders.some((f) => f.id === id)) return false;
    const gone = this.subtree(id);
    this.library.folders = this.library.folders.filter((f) => !gone.has(f.id));
    for (const e of this.entries) {
      if (e.folder !== undefined && gone.has(e.folder)) {
        delete e.folder;
        e.archived = true;
      }
    }
    for (const [k, s] of Object.entries(this.library.samples)) {
      if (s.folder !== undefined && gone.has(s.folder)) {
        const kept: SampleState = { archived: true };
        if (s.deleted !== undefined) kept.deleted = s.deleted;
        this.library.samples[k] = kept;
      }
    }
    this.save();
    return true;
  }

  // MARK: - files and samples (an item is a file path or a sample id)

  moveItem(id: string, folderID: string | null | undefined): boolean {
    if (!this.folderExists(folderID)) return false;
    const target: SampleState | Entry | undefined = SAMPLE_IDS.includes(id) ? (this.library.samples[id] ??= {}) : this.entries.find((e) => e.path === id);
    if (!target) return false;
    if (typeof folderID === 'string') target.folder = folderID;
    else delete target.folder;
    delete target.archived;
    this.save();
    return true;
  }

  setArchived(id: string, archived: boolean): boolean {
    const sample = SAMPLE_IDS.includes(id);
    const target: SampleState | Entry | undefined = sample ? (this.library.samples[id] ??= {}) : this.entries.find((e) => e.path === id);
    if (!target) return false;
    if (archived) target.archived = true;
    else delete target.archived;
    if (!archived && !this.folderExists(target.folder)) delete target.folder;
    if (!archived && !sample) (target as Entry).touched = Math.max((target as Entry).touched, this.platform.now() - 1);
    this.save();
    return true;
  }

  /** Deletes an item for good: a sample disappears from the library, a file goes to the Trash.
      Answers null when done, or why it couldn't be. */
  async deleteForever(id: string): Promise<string | null> {
    if (SAMPLE_IDS.includes(id)) {
      this.library.samples[id] = { deleted: true };
      this.save();
      return null;
    }
    const e = this.entries.find((x) => x.path === id);
    if (!e) return 'That file is no longer in the library.';
    const { fs, ui } = this.platform;
    if (fs.exists(e.path)) {
      try {
        if (ui.trash) await ui.trash(e.path);
        else fs.remove(e.path);
      } catch (err) {
        return `Could not move “${e.name}” to the Trash: ${errorText(err)}`;
      }
    }
    if (e.thumb !== undefined) {
      try {
        fs.remove(this.thumb(e.thumb));
      } catch {
        // A preview left behind is harmless.
      }
    }
    this.entries = this.entries.filter((x) => x.path !== id);
    this.save();
    return null;
  }

  // MARK: - for the home screen

  /** Everything the home screen shows: files (with previews inlined and whether each still exists),
      samples (unless deleted) and folders. */
  listForPage(): Json {
    const { fs, paths } = this.platform;
    const shownFolder = (id: string | undefined): string | null => (id !== undefined && this.folderExists(id) ? id : null);
    const files: Json[] = this.entries.map((e) => {
      const o: Json = {
        id: e.path, path: e.path, name: e.name, kind: e.kind, size: e.size, touched: e.touched,
        dir: paths.dirname(e.path).replaceAll(paths.home, '~'),
        exists: fs.exists(e.path),
        folder: shownFolder(e.folder),
        archived: e.archived === true,
      };
      if (e.thumb !== undefined) {
        try {
          o.thumb = pngDataURL(fs.read(this.thumb(e.thumb)));
        } catch {
          // No preview on disk.
        }
      }
      return o;
    });
    for (const preview of this.samplePreviews()) {
      const id = typeof preview.id === 'string' ? preview.id : '';
      const st = this.library.samples[id] ?? {};
      if (st.deleted === true) continue;
      files.push({ ...preview, sample: true, exists: true, touched: 0, folder: shownFolder(st.folder), archived: st.archived === true });
    }
    const folders = this.library.folders.map((f) => ({ id: f.id, name: f.name, parent: f.parent ?? null, created: f.created }));
    return { files, folders };
  }

  /** Previews of the two built-in samples, made once. */
  samplePreviews(): Json[] {
    if (this.sampleCache) return this.sampleCache;
    const out: Json[] = [];
    for (const [id, threeD] of [['sample2d', false], ['sample3d', true]] as const) {
      const e = this.core.engine();
      try {
        this.core.buildSample(e, threeD);
        let png: Uint8Array | undefined;
        try {
          png = e.execute('render_view', threeD ? { scale: 3 } : { scale: 4 }, 'home').images[0];
        } catch {
          // Shown without a picture.
        }
        out.push({
          id, name: threeD ? 'Island (3D sample)' : 'Mushroom (2D sample)',
          kind: threeD ? '3d' : '2d', size: e.size,
          thumb: png ? pngDataURL(png) : null,
        });
      } finally {
        e.free();
      }
    }
    this.sampleCache = out;
    return out;
  }
}
