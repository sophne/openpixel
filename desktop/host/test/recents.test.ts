// The library's rules (Recents.swift): what is kept, where folders and the archive put things, what the home
// screen is told.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Core } from '../core';
import { LIMIT, Recents, cleanName, thumbName } from '../recents';
import { type MemoryPlatform, fakeCore, memoryPlatform } from './fakes';

const DATA = '/home/me/.local/share/OpenPixel';
const FILES = '/home/me/Documents/OpenPixel';

function setup(): { p: MemoryPlatform; core: Core; recents: Recents } {
  const p = memoryPlatform();
  const core = new Core(fakeCore(), p);
  return { p, core, recents: new Recents(p, core, DATA) };
}

/** Opens a saved model and records it, as the host does after open_model. */
function touch(s: { p: MemoryPlatform; core: Core; recents: Recents }, path: string, size = [16, 16, 1]): void {
  s.p.fs.addModel(path, path.split('/').pop()!.replace('.openpixel', ''), size);
  const e = s.core.engine();
  e.execute('open_model', { path }, 'person');
  s.recents.touch(e);
  e.free();
}

test('preview names are stable per path (FNV-1a, as the Mac app named them)', () => {
  assert.equal(thumbName(''), 'cbf29ce484222325.png');
  assert.equal(thumbName('a'), 'af63dc4c8601ec8c.png');
  assert.equal(thumbName('/Users/me/Documents/OpenPixel/Fox.openpixel'), thumbName('/Users/me/Documents/OpenPixel/Fox.openpixel'));
  assert.notEqual(thumbName('/a/é.openpixel'), thumbName('/a/e.openpixel'));
  assert.match(thumbName('/a/é.openpixel'), /^[0-9a-f]{16}\.png$/);
});

test('a touched file goes first, with its kind, size and a preview at a sensible scale', () => {
  const s = setup();
  touch(s, `${FILES}/Fox.openpixel`);
  s.p.clock.now += 5;
  touch(s, `${FILES}/Island.openpixel`, [24, 24, 24]);
  const [island, fox] = s.recents.entries;
  assert.deepEqual({ ...island, touched: 0 }, { path: `${FILES}/Island.openpixel`, name: 'Island', kind: '3d', size: [24, 24, 24], touched: 0, thumb: thumbName(`${FILES}/Island.openpixel`) });
  assert.equal(fox?.kind, '2d');
  assert.equal(island!.touched - fox!.touched, 5);
  // 128 / 16 for the sprite, 160 / (24 * 2) for the model: the last byte of the fake picture is the scale.
  assert.equal(s.p.fs.read(`${DATA}/thumbs/${fox!.thumb}`).at(-1), 8);
  assert.equal(s.p.fs.read(`${DATA}/thumbs/${island!.thumb}`).at(-1), 3);
  // Touching again moves it up without doubling it.
  touch(s, `${FILES}/Fox.openpixel`);
  assert.deepEqual(s.recents.entries.map((e) => e.name), ['Fox', 'Island']);
  // On disk as the Mac app wrote it: optional fields are left out, not null.
  assert.deepEqual(Object.keys(JSON.parse(s.p.fs.readText(`${DATA}/recents.json`))[0]), ['path', 'name', 'kind', 'size', 'touched', 'thumb']);
});

test(`only ${LIMIT} loose files are kept; files in folders or the archive never drop out`, () => {
  const s = setup();
  touch(s, `${FILES}/Kept in folder.openpixel`);
  touch(s, `${FILES}/Archived.openpixel`);
  const folder = s.recents.createFolder('Heroes', null)!;
  assert.equal(s.recents.moveItem(`${FILES}/Kept in folder.openpixel`, folder), true);
  assert.equal(s.recents.setArchived(`${FILES}/Archived.openpixel`, true), true);
  for (let i = 0; i < LIMIT + 3; i += 1) touch(s, `${FILES}/n${i}.openpixel`);
  const names = s.recents.entries.map((e) => e.name);
  assert.equal(names.length, LIMIT + 2);
  assert.equal(names[0], `n${LIMIT + 2}`);
  assert.ok(names.includes('Kept in folder') && names.includes('Archived'));
  assert.ok(!names.includes('n0') && !names.includes('n2') && names.includes('n3'));
  // Opening an archived file keeps its place in the archive and its folder (when the folder is still there).
  touch(s, `${FILES}/Kept in folder.openpixel`);
  assert.equal(s.recents.entries[0]?.folder, folder);
  s.recents.deleteFolder(folder);
  touch(s, `${FILES}/Kept in folder.openpixel`);
  assert.equal(s.recents.entries[0]?.folder, undefined);
  assert.equal(s.recents.entries[0]?.archived, true);
});

test('folders: names, nesting, and what deleting one does', () => {
  const s = setup();
  const r = s.recents;
  assert.equal(cleanName('  Sprites \n', 'x'), 'Sprites');
  assert.equal(cleanName('   ', 'New folder'), 'New folder');
  assert.equal(cleanName('a'.repeat(200), 'x').length, 120);
  const a = r.createFolder(undefined, undefined)!;
  const b = r.createFolder('B', a)!;
  const c = r.createFolder('C', b)!;
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(r.library.folders[0]?.name, 'New folder');
  assert.equal(r.createFolder('Orphan', 'no-such-folder'), null);
  assert.deepEqual([...r.subtree(a)].sort(), [a, b, c].sort());
  assert.equal(r.renameFolder(b, '  Bosses '), true);
  assert.equal(r.renameFolder(b, ' '), true, 'an empty name keeps the old one');
  assert.equal(r.library.folders[1]?.name, 'Bosses');
  assert.equal(r.renameFolder('nope', 'x'), false);
  // A folder can't go inside itself or its own children.
  assert.equal(r.moveFolder(a, c), false);
  assert.equal(r.moveFolder(a, a), false);
  assert.equal(r.moveFolder(c, 'nope'), false);
  assert.equal(r.moveFolder(c, null), true);
  assert.equal(r.library.folders[2]?.parent, undefined);
  assert.equal(r.moveFolder(c, b), true);

  touch(s, `${FILES}/Fox.openpixel`);
  assert.equal(r.moveItem(`${FILES}/Fox.openpixel`, c), true);
  assert.equal(r.moveItem('sample3d', b), true);
  assert.equal(r.moveItem('/not/in/library.openpixel', c), false);
  assert.equal(r.moveItem(`${FILES}/Fox.openpixel`, 'nope'), false);
  // Deleting a folder takes the folders inside along; their files go to the archive, at the top level.
  assert.equal(r.deleteFolder(a), true);
  assert.equal(r.deleteFolder(a), false);
  assert.deepEqual(r.library.folders, []);
  assert.deepEqual({ folder: r.entries[0]?.folder, archived: r.entries[0]?.archived }, { folder: undefined, archived: true });
  assert.deepEqual(r.library.samples, { sample3d: { archived: true } });
  assert.deepEqual(JSON.parse(s.p.fs.readText(`${DATA}/library.json`)), { folders: [], samples: { sample3d: { archived: true } } });
});

test('archive and restore; a restored file comes back at the top of Recents', () => {
  const s = setup();
  const r = s.recents;
  touch(s, `${FILES}/Old.openpixel`);
  const folder = r.createFolder('F', null)!;
  r.moveItem(`${FILES}/Old.openpixel`, folder);
  r.setArchived(`${FILES}/Old.openpixel`, true);
  r.library.folders = [];
  s.p.clock.now += 1000;
  assert.equal(r.setArchived(`${FILES}/Old.openpixel`, false), true);
  const e = r.entries[0]!;
  assert.deepEqual({ archived: e.archived, folder: e.folder, touched: e.touched }, { archived: undefined, folder: undefined, touched: s.p.clock.now - 1 });
  assert.equal(r.setArchived('/nope', true), false);
  assert.equal(r.setArchived('sample2d', true), true);
  assert.deepEqual(r.library.samples.sample2d, { archived: true });
  r.setArchived('sample2d', false);
  assert.deepEqual(r.library.samples.sample2d, {});
});

test('deleting for good: files go to the Trash, samples just leave the library', async () => {
  const s = setup();
  const r = s.recents;
  const path = `${FILES}/Fox.openpixel`;
  touch(s, path);
  const thumb = `${DATA}/thumbs/${thumbName(path)}`;
  assert.ok(s.p.fs.exists(thumb));
  assert.equal(await r.deleteForever('/not/here.openpixel'), 'That file is no longer in the library.');

  // The message names the system's own place for deleted files.
  s.p.ui.trash = async () => { throw new Error('it is full'); };
  for (const [os, words] of [['linux', 'the trash'], ['darwin', 'the Trash'], ['win32', 'the Recycle Bin']] as const) {
    s.p.os = os;
    assert.equal(await r.deleteForever(path), `Could not move “Fox” to ${words}: it is full`);
  }
  s.p.os = 'linux';
  assert.deepEqual(r.entries.map((e) => e.name), ['Fox']);

  const trashed: string[] = [];
  s.p.ui.trash = async (p) => { trashed.push(p); s.p.fs.remove(p); };
  assert.equal(await r.deleteForever(path), null);
  assert.deepEqual(trashed, [path]);
  assert.ok(!s.p.fs.exists(thumb));
  assert.deepEqual(r.entries, []);

  // Without a Trash (a browser), the file is removed. A file already gone is only forgotten.
  delete s.p.ui.trash;
  touch(s, path);
  assert.equal(await r.deleteForever(path), null);
  assert.ok(!s.p.fs.exists(path));
  touch(s, path);
  s.p.fs.remove(path);
  assert.equal(await r.deleteForever(path), null);

  r.moveItem('sample2d', r.createFolder('F', null));
  assert.equal(await r.deleteForever('sample2d'), null);
  assert.deepEqual(r.library.samples.sample2d, { deleted: true });
});

test('a renamed file keeps its entry, folder and preview', () => {
  const s = setup();
  const r = s.recents;
  touch(s, `${FILES}/Fox.openpixel`);
  const folder = r.createFolder('F', null)!;
  r.moveItem(`${FILES}/Fox.openpixel`, folder);
  r.renamePath(`${FILES}/Fox.openpixel`, `${FILES}/Red Fox.openpixel`);
  const e = r.entries[0]!;
  assert.deepEqual({ path: e.path, name: e.name, thumb: e.thumb, folder: e.folder }, { path: `${FILES}/Red Fox.openpixel`, name: 'Red Fox', thumb: thumbName(`${FILES}/Red Fox.openpixel`), folder });
  assert.ok(s.p.fs.exists(`${DATA}/thumbs/${e.thumb}`) && !s.p.fs.exists(`${DATA}/thumbs/${thumbName(`${FILES}/Fox.openpixel`)}`));
  r.renamePath('/unknown', '/other');
  assert.deepEqual(r.entries.map((x) => x.name), ['Red Fox']);
  r.remove(`${FILES}/Red Fox.openpixel`);
  assert.deepEqual(r.entries, []);
});

test('the home screen hears files, samples and folders in the shapes the page reads', () => {
  const s = setup();
  const r = s.recents;
  touch(s, `${FILES}/Fox.openpixel`);
  const folder = r.createFolder('Heroes', null)!;
  r.moveItem(`${FILES}/Fox.openpixel`, folder);
  r.moveItem('sample2d', folder);
  r.setArchived('sample3d', true);
  const page = r.listForPage() as { files: Record<string, unknown>[]; folders: unknown[] };
  assert.deepEqual(page.files[0], {
    id: `${FILES}/Fox.openpixel`, path: `${FILES}/Fox.openpixel`, name: 'Fox', kind: '2d', size: [16, 16, 1], touched: s.p.clock.now,
    dir: '~/Documents/OpenPixel', exists: true, folder, archived: false,
    thumb: 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 16, 16, 1, 8]).toString('base64'),
  });
  assert.deepEqual(page.files[1], {
    id: 'sample2d', name: 'Mushroom (2D sample)', kind: '2d', size: [16, 16, 1],
    thumb: 'data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 16, 16, 1, 4]).toString('base64'),
    sample: true, exists: true, touched: 0, folder, archived: false,
  });
  assert.deepEqual({ ...page.files[2], thumb: '' }, { id: 'sample3d', name: 'Island (3D sample)', kind: '3d', size: [24, 24, 24], thumb: '', sample: true, exists: true, touched: 0, folder: null, archived: true });
  assert.deepEqual(page.folders, [{ id: folder, name: 'Heroes', parent: null, created: s.p.clock.now }]);

  // A file gone from disk stays listed (greyed out by the page); a folder that no longer exists reads as top level.
  s.p.fs.remove(`${FILES}/Fox.openpixel`);
  r.library.folders = [];
  const later = r.listForPage() as { files: Record<string, unknown>[] };
  assert.deepEqual([later.files[0]?.exists, later.files[0]?.folder, later.files[1]?.folder], [false, null, null]);
  r.library.samples.sample2d = { deleted: true };
  assert.deepEqual((r.listForPage() as { files: { id: string }[] }).files.map((f) => f.id), [`${FILES}/Fox.openpixel`, 'sample3d']);
});

test('the library is read back as written, also from the Mac app; a damaged file reads as empty', () => {
  const s = setup();
  // JSONEncoder's output: any key order, no nulls, sizes as whole numbers.
  s.p.fs.write(`${DATA}/recents.json`, '[{"touched":770000000.5,"size":[32,32,1],"kind":"2d","name":"Fox","path":"/Users/me/Documents/OpenPixel/Fox.openpixel","thumb":"00.png","archived":true,"later":"ignored"}]');
  s.p.fs.write(`${DATA}/library.json`, '{"samples":{"sample2d":{"folder":"f1","deleted":false}},"folders":[{"id":"f1","name":"Heroes","created":1},{"created":2,"parent":"f1","name":"Bosses","id":"f2"}]}');
  const r = new Recents(s.p, s.core, DATA);
  assert.deepEqual(r.entries, [{ path: '/Users/me/Documents/OpenPixel/Fox.openpixel', name: 'Fox', kind: '2d', size: [32, 32, 1], touched: 770000000.5, thumb: '00.png', archived: true }]);
  assert.deepEqual(r.library, { folders: [{ id: 'f1', name: 'Heroes', created: 1 }, { id: 'f2', name: 'Bosses', created: 2, parent: 'f1' }], samples: { sample2d: { folder: 'f1', deleted: false } } });
  // A run that must not see the person's library (UI tests, screenshots) reads nothing.
  assert.deepEqual(new Recents(s.p, s.core, DATA, false).entries, []);

  for (const bad of ['[{"path":"/a","name":"a","kind":"2d","size":[1,1,1]}]', '[{"path":"/a","name":"a","kind":"2d","size":[1.5,1,1],"touched":1}]', '{"path":"/a"}', 'not json']) {
    s.p.fs.write(`${DATA}/recents.json`, bad);
    assert.deepEqual(new Recents(s.p, s.core, DATA).entries, [], bad);
  }
  s.p.fs.write(`${DATA}/library.json`, '{"folders":[{"id":"f1"}],"samples":{}}');
  assert.deepEqual(new Recents(s.p, s.core, DATA).library, { folders: [], samples: {} });
});
