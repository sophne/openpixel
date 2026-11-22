/* Chat history: one file per document under <work folder>/History, named after a hash of the document's path. */
import assert from 'node:assert/strict';
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { historyFile } from './history.ts';
import { createChatRunner } from './index.ts';
import { nodeFiles, put, tempFolder } from './test-support.ts';

const root = tempFolder('history');
const workDir = nodePath.join(root, 'data', 'Chat');
const store = { fs: nodeFiles, workDir };
const open = (): ReturnType<typeof createChatRunner> => createChatRunner({ mcpCommand: '/bin/true', workDir, emit: () => {}, fs: nodeFiles });
const chat = open();
const files = (): string[] => nodeFiles.list(nodePath.join(workDir, 'History')).sort();
const threads = { v: 1, current: 'c1', threads: [{ id: 'c1', title: 'Draw a heart ♥', messages: [{ role: 'user', text: 'a/b "c"' }] }] };

test('the file is named after the first 12 bytes of the SHA-256 of the key', () => {
  // SHA-256("abc") = ba7816bf 8f01cfea 414140de 5dae2223 …
  assert.equal(historyFile(store, 'abc'), nodePath.join(workDir, 'History', 'ba7816bf8f01cfea414140de.json'));
});

test('saving and loading: the chats come back, with the file they belong to', () => {
  assert.equal(nodeFS.existsSync(workDir), true, 'the work folder is made at the start');
  assert.equal(chat.loadHistory('/drive/art/hero.openpixel'), null);
  assert.equal(chat.saveHistory('/drive/art/hero.openpixel', threads), true);
  assert.deepEqual(chat.loadHistory('/drive/art/hero.openpixel'), { ...threads, key: '/drive/art/hero.openpixel' });
  assert.equal(threads.hasOwnProperty('key'), false, 'what the page sent is left as it was');
  assert.deepEqual(files(), [nodePath.basename(historyFile(store, '/drive/art/hero.openpixel'))]);
  // Compact JSON as the Mac app wrote it ("/" as "\/"), so both read each other's files.
  const text = nodeFS.readFileSync(historyFile(store, '/drive/art/hero.openpixel'), 'utf8');
  assert.equal(text, '{"v":1,"current":"c1","threads":[{"id":"c1","title":"Draw a heart ♥","messages":[{"role":"user","text":"a\\/b \\"c\\""}]}],"key":"\\/drive\\/art\\/hero.openpixel"}');
});

test('what is not a history is not saved or loaded', () => {
  assert.equal(chat.saveHistory('', threads), false);
  assert.equal(chat.loadHistory(''), null);
  for (const data of [null, undefined, 'text', 7, [threads]]) assert.equal(chat.saveHistory('/drive/x.openpixel', data), false);
  assert.equal(chat.loadHistory('/drive/x.openpixel'), null);
  put(historyFile(store, '/drive/broken.openpixel'), '{"v":1,');
  assert.equal(chat.loadHistory('/drive/broken.openpixel'), null);
  put(historyFile(store, '/drive/bare.openpixel'), '"just text"');
  assert.equal(chat.loadHistory('/drive/bare.openpixel'), null);
  nodeFS.rmSync(historyFile(store, '/drive/broken.openpixel'));
  nodeFS.rmSync(historyFile(store, '/drive/bare.openpixel'));
});

test('a renamed file keeps its chats, a deleted one takes them with it', () => {
  assert.equal(chat.saveHistory('/drive/art/old.openpixel', { v: 1, threads: [] }), true);
  chat.moveHistory('/drive/art/hero.openpixel', '/drive/art/old.openpixel'); // over another file's chats
  assert.equal(chat.loadHistory('/drive/art/hero.openpixel'), null);
  assert.deepEqual(chat.loadHistory('/drive/art/old.openpixel'), { ...threads, key: '/drive/art/old.openpixel' });
  assert.deepEqual(files(), [nodePath.basename(historyFile(store, '/drive/art/old.openpixel'))]);
  chat.moveHistory('/drive/art/none.openpixel', '/drive/art/old.openpixel'); // nothing to move: nothing changes
  chat.moveHistory('/drive/art/old.openpixel', '/drive/art/old.openpixel');
  assert.deepEqual(chat.loadHistory('/drive/art/old.openpixel'), { ...threads, key: '/drive/art/old.openpixel' });
  chat.deleteHistory('');
  chat.deleteHistory('/drive/art/none.openpixel');
  assert.equal(files().length, 1);
  chat.deleteHistory('/drive/art/old.openpixel');
  assert.deepEqual(files(), []);
});

test('at launch: chats of files that are gone, and of never-saved files, are cleared', () => {
  const folder = nodePath.join(root, 'art');
  const here = nodePath.join(folder, 'here.openpixel'), gone = nodePath.join(folder, 'gone.openpixel');
  const away = nodePath.join(root, 'unplugged', 'drive.openpixel'); // its folder is missing too: a disconnected drive
  put(here, '');
  for (const key of [here, gone, away, 'untitled:Untitled 3']) assert.equal(chat.saveHistory(key, { v: 1, threads: [] }), true);
  put(nodePath.join(workDir, 'History', 'notes.txt'), 'not a history');
  put(nodePath.join(workDir, 'History', 'old.json'), '{"v":1}'); // from before files were named: left alone
  assert.equal(files().length, 6);
  open();
  assert.deepEqual(files(), ['notes.txt', 'old.json', nodePath.basename(historyFile(store, here)), nodePath.basename(historyFile(store, away))].sort());
  // A never-saved file's chats do last while the app runs.
  assert.equal(chat.saveHistory('untitled:Untitled 3', { v: 1, threads: [] }), true);
  assert.deepEqual(chat.loadHistory('untitled:Untitled 3'), { v: 1, threads: [], key: 'untitled:Untitled 3' });
});
