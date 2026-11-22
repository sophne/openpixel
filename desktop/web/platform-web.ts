/* `Platform` for a browser tab (docs/desktop-architecture.md: "a web version loads the same package in the browser
   and swaps `Platform`"). This one is the preview's: files live in memory and are gone when the tab closes.
   Nothing here knows about the core or the app's logic; desktop/host does the rest, unchanged. */
import type { Platform, PlatformFS, PlatformPaths, PlatformUI } from '../host/platform';

const encoder = new TextEncoder();

// MARK: - paths ("/"-separated, always absolute)

function resolve(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

function dirname(path: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const i = p.lastIndexOf('/');
  return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i).replace(/\/+$/, '') || '/';
}

function basename(path: string, ext?: string): string {
  const p = path.replace(/\/+$/, '');
  const name = p.slice(p.lastIndexOf('/') + 1);
  return ext !== undefined && ext !== '' && name.endsWith(ext) && name !== ext ? name.slice(0, -ext.length) : name;
}

function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i);
}

export const ROOT = '/OpenPixel';
/** Where "Save As" and the exports write: a file written there after a save panel is offered as a download. */
export const DOWNLOADS = '/Downloads';
/** Where files the person picked from their computer are copied to. */
export const UPLOADS = '/Uploads';

export function webPaths(): PlatformPaths {
  return {
    home: ROOT,
    data: `${ROOT}/data`,
    files: `${ROOT}/files`,
    temp: '/tmp',
    sep: '/',
    join: (...parts) => {
      const joined = parts.filter((p) => p !== '').join('/');
      return joined.startsWith('/') ? resolve(joined) : resolve(joined).slice(1) || '.';
    },
    dirname,
    basename,
    extname,
    normalize: (p) => resolve(p === '~' ? ROOT : p.startsWith('~/') ? `${ROOT}/${p.slice(2)}` : p),
  };
}

// MARK: - files

/** A file system in memory. Its errors read like Node's, since the host shows them to the person as they are. */
export class MemoryFS implements PlatformFS {
  private readonly files = new Map<string, { data: Uint8Array; mtimeMs: number }>();
  private readonly dirs = new Set<string>(['/']);

  read(path: string): Uint8Array {
    const f = this.files.get(resolve(path));
    if (!f) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return f.data;
  }
  write(path: string, data: Uint8Array | string): void {
    const p = resolve(path);
    if (!this.dirs.has(dirname(p))) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    if (this.dirs.has(p)) throw new Error(`EISDIR: illegal operation on a directory, open '${path}'`);
    // A copy: what the caller handed over stays the caller's.
    this.files.set(p, { data: typeof data === 'string' ? encoder.encode(data) : data.slice(), mtimeMs: Date.now() });
  }
  exists(path: string): boolean {
    const p = resolve(path);
    return this.files.has(p) || this.dirs.has(p);
  }
  stat(path: string): { mtimeMs: number; size: number; isDirectory: boolean } | null {
    const p = resolve(path);
    const f = this.files.get(p);
    if (f) return { mtimeMs: f.mtimeMs, size: f.data.length, isDirectory: false };
    return this.dirs.has(p) ? { mtimeMs: 0, size: 0, isDirectory: true } : null;
  }
  list(path: string): string[] {
    const p = resolve(path);
    const names = new Set<string>();
    for (const child of [...this.files.keys(), ...this.dirs]) if (child !== p && dirname(child) === p) names.add(basename(child));
    return [...names].sort();
  }
  createDirAll(path: string): void {
    const p = resolve(path);
    if (this.files.has(p)) throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
    for (let d = p; !this.dirs.has(d); d = dirname(d)) this.dirs.add(d);
  }
  remove(path: string): void {
    const p = resolve(path);
    if (p === '/') return;
    this.files.delete(p);
    for (const child of [...this.files.keys()]) if (child.startsWith(p + '/')) this.files.delete(child);
    for (const child of [...this.dirs]) if (child === p || child.startsWith(p + '/')) this.dirs.delete(child);
  }
  rename(from: string, to: string): void {
    const a = resolve(from);
    const b = resolve(to);
    const refuse = (code: string): never => {
      throw new Error(`${code}, rename '${from}' -> '${to}'`);
    };
    if (!this.dirs.has(dirname(b))) refuse('ENOENT: no such file or directory');
    const f = this.files.get(a);
    if (f) {
      if (this.dirs.has(b)) refuse('EISDIR: illegal operation on a directory');
      this.files.delete(a);
      this.files.set(b, f);
      return;
    }
    if (!this.dirs.has(a) || a === '/') refuse('ENOENT: no such file or directory');
    if (this.files.has(b) || b.startsWith(a + '/')) refuse('EINVAL: invalid argument');
    for (const [child, data] of [...this.files]) {
      if (!child.startsWith(a + '/')) continue;
      this.files.delete(child);
      this.files.set(b + child.slice(a.length), data);
    }
    for (const child of [...this.dirs]) {
      if (child !== a && !child.startsWith(a + '/')) continue;
      this.dirs.delete(child);
      this.dirs.add(b + child.slice(a.length));
    }
  }
}

// MARK: - downloads

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.html': 'text/html', '.obj': 'text/plain', '.mtl': 'text/plain',
};

function offerDownload(name: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data.slice()], { type: TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The save panel of a browser: the host is told a path under /Downloads, and what it then writes there is handed
    to the person as a download. Only the write that answers a panel counts (with the files written beside it in
    the same go, like an OBJ's .mtl): a file saved there and autosaved again later is not downloaded each time. */
class Downloads {
  /** Paths without their extension that a panel just answered with. */
  private readonly expected = new Set<string>();
  private n = 0;

  /** A fresh path for `name`. Each panel gets a folder of its own, so two exports by one name never meet. */
  expect(name: string): string {
    this.n += 1;
    const path = `${DOWNLOADS}/${this.n}/${basename(name) || 'OpenPixel'}`;
    this.expected.add(path.slice(0, path.length - extname(path).length));
    return path;
  }

  wrote(path: string, data: Uint8Array | string): void {
    if (this.expected.size === 0 || !path.startsWith(DOWNLOADS + '/')) return;
    const stem = path.slice(0, path.length - extname(path).length);
    if (!this.expected.has(stem)) return;
    // The tool that writes this file may write another beside it before it returns; after that, no more.
    setTimeout(() => this.expected.delete(stem), 0);
    offerDownload(basename(path), typeof data === 'string' ? encoder.encode(data) : data);
  }
}

// MARK: - the window's half

/** A hidden file input, clicked. Null when the person cancels. Browsers only show the chooser in answer to a
    click or a key press, which is when the page asks for it. */
function chooseFile(extensions: string[]): Promise<File | null> {
  return new Promise((done) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.style.display = 'none';
    const finish = (file: File | null): void => {
      input.remove();
      done(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    document.body.append(input);
    input.click();
  });
}

function webUI(fs: MemoryFS, downloads: Downloads): PlatformUI {
  const pc = (): Record<string, unknown> | undefined => (window as unknown as { PC?: Record<string, unknown> }).PC;
  return {
    async openPanel({ extensions }) {
      const file = await chooseFile(extensions);
      if (!file) return null;
      const data = new Uint8Array(await file.arrayBuffer());
      fs.createDirAll(UPLOADS);
      // Never over a file picked earlier: that one may be open in a tab.
      const ext = extname(file.name);
      const stem = basename(file.name, ext) || 'Untitled';
      let path = `${UPLOADS}/${stem}${ext}`;
      for (let n = 2; fs.exists(path); n += 1) path = `${UPLOADS}/${stem} ${n}${ext}`;
      fs.write(path, data);
      return path;
    },
    async savePanel({ name, extension }) {
      const wanted = name !== '' ? name : 'OpenPixel';
      const full = extension !== '' && extname(wanted).toLowerCase() !== '.' + extension.toLowerCase() ? `${wanted}.${extension}` : wanted;
      const path = downloads.expect(full.replaceAll('/', '-'));
      fs.createDirAll(dirname(path));
      return path;
    },
    // Nothing is lost that was not already only in memory.
    askToSave: async () => 'discard',
    async alert(title, text) {
      console.warn(`${title || 'OpenPixel'}: ${text}`);
    },
    async showUpdateDialog({ version }) {
      console.info(`OpenPixel ${version} is available.`);
    },
    copyText(text) {
      // Allowed in answer to a click, on https or localhost; elsewhere the browser says no and nothing is copied.
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    },
    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) return false;
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    },
    reveal: () => false,
    screenshot: () => Promise.reject(new Error('A browser tab cannot take a picture of itself.')),
    setTitle(title) {
      document.title = title;
    },
    page(fn, ...args) {
      try {
        const f = pc()?.[fn];
        if (typeof f === 'function') f.apply(pc(), args);
      } catch (e) {
        console.error(`PC.${fn} failed:`, e);
      }
    },
  };
}

export interface WebPlatform extends Platform {
  /** The files as they are kept (downloads aside, `fs` on the Platform is this). */
  memory: MemoryFS;
}

/** The browser's Platform. No `desktop` and no `local`: no agents' socket, no Agent Chat. */
export function webPlatform(): WebPlatform {
  const memory = new MemoryFS();
  const paths = webPaths();
  for (const folder of [paths.data, paths.files, paths.temp, DOWNLOADS, UPLOADS]) memory.createDirAll(folder);
  const downloads = new Downloads();
  const fs: PlatformFS = {
    read: (p) => memory.read(p),
    write(p, data) {
      memory.write(p, data);
      downloads.wrote(p, data);
    },
    exists: (p) => memory.exists(p),
    stat: (p) => memory.stat(p),
    list: (p) => memory.list(p),
    createDirAll: (p) => memory.createDirAll(p),
    remove: (p) => memory.remove(p),
    rename: (a, b) => memory.rename(a, b),
  };
  return {
    os: 'web',
    fs,
    memory,
    paths,
    ui: webUI(memory, downloads),
    now: () => Date.now() / 1000,
    // The preview stays off the network: no update feed, no star count.
    fetchText: async () => null,
  };
}
