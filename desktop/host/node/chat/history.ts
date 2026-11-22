/* History: each file's chats, kept next to the app's other data (<data folder>/Chat/History).
   One JSON file per document, named after a hash of its path, so chats survive restarts and follow the file.
   The files are the ones the Swift app wrote too, so chats from before are read back. */
import { createHash } from 'node:crypto';
import * as nodePath from 'node:path';
import type { PlatformFS } from '../../platform';
import type { Dict } from './values.ts';
import { isDict, nsJSON, str } from './values.ts';

export interface HistoryStore { fs: PlatformFS; workDir: string }

const folder = (s: HistoryStore): string => nodePath.join(s.workDir, 'History');

/** <History>/<first 12 bytes of SHA-256 of the key, in hex>.json */
export function historyFile(s: HistoryStore, key: string): string {
  const h = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 24);
  return nodePath.join(folder(s), `${h}.json`);
}

function readJSON(s: HistoryStore, file: string): unknown {
  try {
    const o: unknown = JSON.parse(Buffer.from(s.fs.read(file)).toString('utf8'));
    return isDict(o) || Array.isArray(o) ? o : undefined; // a bare value is not a history
  } catch { return undefined; }
}

/** A file's chats, or null when it has none. */
export function loadHistory(s: HistoryStore, key: string): unknown {
  if (key === '') return null;
  return readJSON(s, historyFile(s, key)) ?? null;
}

export function saveHistory(s: HistoryStore, key: string, data: unknown): boolean {
  if (key === '' || !isDict(data)) return false;
  try {
    // "key" says which file it belongs to, so chats of files that are gone can be cleared.
    const text = nsJSON({ ...data, key });
    const file = historyFile(s, key);
    s.fs.createDirAll(folder(s));
    s.fs.write(file, text);
    return true;
  } catch { return false; }
}

/** A file deleted from OpenPixel takes its chats with it. */
export function deleteHistory(s: HistoryStore, key: string): void {
  if (key === '') return;
  try { s.fs.remove(historyFile(s, key)); } catch { /* it had none */ }
}

/** A renamed file keeps its chats. */
export function moveHistory(s: HistoryStore, from: string, to: string): void {
  const a = historyFile(s, from), b = historyFile(s, to);
  if (from === to || !s.fs.exists(a)) return;
  try { s.fs.remove(b); } catch { /* nothing was there */ }
  try { s.fs.rename(a, b); } catch { return; }
  const o = readJSON(s, b);
  if (isDict(o)) {
    try { s.fs.write(b, nsJSON({ ...o, key: to })); } catch { /* it keeps the old key; pruning may clear it */ }
  }
}

/** At launch: clears the chats of files that no longer exist (deleted or moved away outside the app) and of
    never-saved files. A file whose folder is missing too (a disconnected drive) keeps its chats. */
export function pruneHistory(s: HistoryStore): void {
  const dir = folder(s);
  for (const name of s.fs.list(dir)) {
    if (nodePath.extname(name) !== '.json') continue;
    const file = nodePath.join(dir, name);
    const key = str((readJSON(s, file) as Dict | undefined)?.key);
    if (key === undefined) continue;
    const gone = key.startsWith('untitled:') || (!s.fs.exists(key) && s.fs.exists(nodePath.dirname(key)));
    if (gone) { try { s.fs.remove(file); } catch { /* next launch */ } }
  }
}
