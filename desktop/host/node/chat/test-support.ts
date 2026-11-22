/* For the tests only: PlatformFS on Node's own files (the app's real one is the Electron shell's), and small helpers
   for temporary folders. */
import * as nodeFS from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { PlatformFS } from '../../platform';

export const nodeFiles: PlatformFS = {
  read: (path) => new Uint8Array(nodeFS.readFileSync(path)),
  write: (path, data) => {
    const beside = `${path}.tmp-${process.pid}`;
    nodeFS.writeFileSync(beside, data);
    nodeFS.renameSync(beside, path);
  },
  exists: (path) => nodeFS.existsSync(path),
  stat: (path) => {
    try {
      const s = nodeFS.statSync(path);
      return { mtimeMs: s.mtimeMs, size: s.size, isDirectory: s.isDirectory() };
    } catch { return null; }
  },
  list: (path) => { try { return nodeFS.readdirSync(path); } catch { return []; } },
  createDirAll: (path, mode) => { nodeFS.mkdirSync(path, { recursive: true, mode }); },
  remove: (path) => nodeFS.rmSync(path, { recursive: true, force: true }),
  rename: (from, to) => nodeFS.renameSync(from, to),
};

/** A new empty folder that the test may fill; removed when the process ends. */
export function tempFolder(name: string): string {
  const dir = nodeFS.mkdtempSync(nodePath.join(os.tmpdir(), `openpixel-${name}-`));
  process.on('exit', () => { try { nodeFS.rmSync(dir, { recursive: true, force: true }); } catch { /* left for the system */ } });
  return dir;
}

/** Writes a file, making its folders. */
export function put(path: string, text: string, mode?: number): void {
  nodeFS.mkdirSync(nodePath.dirname(path), { recursive: true });
  nodeFS.writeFileSync(path, text, mode === undefined ? {} : { mode });
}
