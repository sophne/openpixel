/* For the tests only: PlatformFS on Node's own files (the app's real one is the Electron shell's), and small helpers
   for temporary folders. */
import * as nodeFS from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { PlatformFS } from '../../platform';
import type { Dict } from './values.ts';
import { trimAll } from './values.ts';

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

/** A short, comparable account of the events: "session", "text:<all text of a block>", "think",
    "tool <name>", "ok <name>" / "failed <name>", "error: <message>", "done" / "done failed". */
export function timeline(events: Dict[]): string[] {
  const out: string[] = [], names = new Map<string, string>();
  const text = (v: unknown, or: string): string => (typeof v === 'string' ? v : or);
  for (const e of events) {
    const last = out[out.length - 1];
    switch (text(e.t, '')) {
      case 'session': if (last !== 'session') out.push('session'); break;
      case 'text': {
        const d = text(e.d, '');
        if (last !== undefined && last.startsWith('text:')) out[out.length - 1] = last + d; else out.push('text:' + d);
        break;
      }
      case 'think': if (last !== 'think') out.push('think'); break;
      case 'tool': {
        const id = text(e.id, ''), name = text(e.name, '?');
        names.set(id, name);
        out.push(`tool ${name}`);
        break;
      }
      case 'tool_done': {
        const name = names.get(text(e.id, '')) ?? '(unknown call)';
        out.push(`${e.ok === true ? 'ok' : 'failed'} ${name}`);
        break;
      }
      case 'error': out.push(`error: ${text(e.message, '')}`); break;
      case 'done': out.push(e.ok === true ? 'done' : 'done failed'); break;
      default: break;
    }
  }
  return out.map((s) => (s.startsWith('text:') ? 'text:' + trimAll(s.slice(5)) : s));
}
