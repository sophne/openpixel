// The app's logic against a scripted engine and an in-memory platform: tabs, autosave, renames, closing, the
// messages the page sends, agents on the socket, updates. What is checked is what AppDelegate.swift did.
import assert from 'node:assert/strict';
import { type TestContext, test } from 'node:test';
import type { Engine } from '../core';
import { AppHost } from '../documents';
import type { HostOptions } from '../platform';
import { FEED_URL } from '../updates';
import { FakeChat, FakeEngine, type MemoryPlatform, fakeCore, memoryPlatform } from './fakes';

const DATA = '/home/me/.local/share/OpenPixel';
const FILES = '/home/me/Documents/OpenPixel';
const STARS = 'https://api.github.com/repos/sophne/openpixel';

interface Booted {
  p: MemoryPlatform;
  host: AppHost;
  /** Lets timers run: 0 for the page's refresh, 1500 for autosave. */
  tick(ms?: number): void;
  native(action: string, more?: Record<string, unknown>): Promise<any>;
  /** One line from an agent on connection 1, and the parsed reply. */
  agent(line: unknown, connection?: number): Promise<any>;
  refreshes(): string[];
}

const mocked = new WeakSet<TestContext>();

function boot(t: TestContext, options: Partial<HostOptions> & { platform?: MemoryPlatform; updates?: boolean } = {}): Booted {
  if (!mocked.has(t)) {
    mocked.add(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(console, 'error', () => undefined);
  }
  const p = options.platform ?? memoryPlatform();
  const { updates, ...rest } = options;
  const host = new AppHost({ core: fakeCore({ updates: updates === true }), ...rest, platform: p });
  t.after(() => host.dispose());
  return {
    p,
    host,
    tick: (ms = 0) => t.mock.timers.tick(ms),
    native: (action, more = {}) => host.handle({ kind: 'native', action, ...more }),
    agent: async (line, connection = 1) => JSON.parse(await p.socket!.handlers.line(typeof line === 'string' ? line : JSON.stringify(line), connection)),
    refreshes: () => p.ui.takePages('refresh'),
  };
}

/** The tab bar as the page hears it. */
const tabsOf = (b: Booted): any => b.host.tabsForPage();
const raw = (e: Engine): FakeEngine => (e as unknown as { raw: FakeEngine }).raw;
/** Lets promises that are already settled run their continuations. */
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

async function newSprite(b: Booted, name: string): Promise<any> {
  return b.native('newDocument', { tool: 'new_sprite', args: { width: 16, height: 16, name } });
}

test('it starts on the home screen with a blank canvas nobody has to save', (t) => {
  const b = boot(t);
  assert.equal(b.host.start(), 'home');
  assert.deepEqual(tabsOf(b), { tabs: [], active: null });
  assert.deepEqual(b.p.ui.title, { title: 'OpenPixel — Untitled', path: null, edited: false });
  assert.deepEqual(FakeEngine.calls, ['sample:new_sprite']);
  assert.deepEqual([b.host.engine.size, b.host.engine.dirty], [[32, 32, 1], false]);
  assert.equal(b.p.socket?.path, `${DATA}/openpixel.sock`);
  b.tick(5000);
  assert.deepEqual(b.p.fs.list(FILES), [], 'the blank canvas is not a file');
});

test('a tool answers with its JSON and pictures; a failed one rejects with its own words', async (t) => {
  const b = boot(t);
  assert.deepEqual(await b.host.handle({ kind: 'tool', name: 'render_view', args: { scale: 2 } }), {
    scale: 2, images: ['data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 32, 32, 1, 2]).toString('base64')],
  });
  assert.deepEqual(await b.host.handle({ kind: 'tool', name: 'get_model_info' }), { name: 'Untitled', size: [32, 32, 1], pixels: 0 });
  await assert.rejects(b.host.handle({ kind: 'tool', name: 'nope', args: {} }), { message: 'unknown tool nope' });
  await assert.rejects(b.host.handle({ kind: 'tool', name: 'get_editor_screenshot' }), { message: 'get_editor_screenshot must come from an agent' });
  await assert.rejects(b.host.handle({} as never), { message: 'bad message' });
  await assert.rejects(b.host.handle({ kind: 'frames', count: 3 }), { message: 'unknown message' });
  await assert.rejects(b.host.handle({ kind: 'spawnAgent' }), { message: 'unknown message' }, 'test messages only work in a UI test');
  assert.equal(FakeEngine.calls.at(-1), 'person:get_editor_screenshot');
});

test('an agent drawing while no file is open makes a tab; a burst of edits is one refresh; autosave follows 1.5 s later', async (t) => {
  const b = boot(t);
  assert.deepEqual(await b.agent({ hello: { name: 'claude-code', version: '2.1', pid: 42, transport: 'stdio' } }), { ok: true });
  b.p.socket!.handlers.opened(1);
  await b.agent({ hello: { name: 'claude-code', version: '2.1', pid: 42, transport: 'stdio' } });
  assert.deepEqual(await b.agent({ tool: 'set_pixels', args: { pixels: [] } }), { ok: true, json: { revision: 2 }, images: [] });
  await b.agent({ tool: 'set_pixels' });
  assert.deepEqual((await b.agent({ tool: 'render_view', args: { scale: 1 } })).images, [Buffer.from([137, 80, 78, 71, 32, 32, 1, 1]).toString('base64')]);
  assert.deepEqual(await b.agent({ tool: 'nope', args: {} }), { ok: false, error: 'unknown tool nope' });
  assert.deepEqual(await b.agent('garbage'), { ok: false, error: 'bad request' });
  assert.deepEqual(await b.agent({ args: {} }), { ok: false, error: 'bad request' });
  assert.equal(FakeEngine.calls.filter((c) => c.startsWith('agent:')).length, 4);

  assert.equal(b.host.start(), 'editor');
  assert.deepEqual(tabsOf(b), { tabs: [{ id: 1, name: 'Untitled', kind: '2d', dirty: true, path: null }], active: 1 });
  assert.deepEqual(b.refreshes(), [], 'the page hears after the agent was answered');
  b.tick();
  assert.deepEqual(b.refreshes(), ['refresh("set_pixels")']);
  assert.deepEqual(b.p.ui.title, { title: 'OpenPixel — Untitled •', path: null, edited: true });

  b.tick(1499);
  assert.deepEqual(b.p.fs.list(FILES), []);
  b.tick(1);
  assert.deepEqual(b.p.fs.list(FILES), ['Untitled.openpixel']);
  b.tick();
  assert.deepEqual(b.refreshes(), ['refresh("autosave")']);
  assert.deepEqual(b.p.ui.title, { title: 'OpenPixel — Untitled', path: `${FILES}/Untitled.openpixel`, edited: false });
  assert.deepEqual(b.host.recents.entries.map((e) => e.path), [`${FILES}/Untitled.openpixel`]);

  // While edits keep coming, the file is written at most every 1.5 s.
  await b.agent({ tool: 'set_pixels' });
  b.tick(1000);
  await b.agent({ tool: 'set_pixels' });
  assert.equal(JSON.parse(b.p.fs.readText(`${FILES}/Untitled.openpixel`)).pixels, 2);
  b.tick(500);
  assert.equal(JSON.parse(b.p.fs.readText(`${FILES}/Untitled.openpixel`)).pixels, 4);

  const snap = await b.native('agents', { setup: false });
  assert.deepEqual(Object.keys(snap).sort(), ['bridge', 'command', 'last_seen', 'sessions']);
  assert.deepEqual([snap.command, snap.bridge], ['/opt/OpenPixel/openpixel', true]);
  assert.deepEqual({ ...snap.sessions[0], connected: 0, last_call: 0 }, {
    id: 1, client: 'claude-code', version: '2.1', transport: 'stdio', pid: 42, agent: 'claude-code', connected: 0, calls: 6, last_tool: 'set_pixels', open: true, last_call: 0,
  });
  assert.ok('setup' in (await b.native('agents')));
});

test('new files get a name of their own in the files folder, at once', async (t) => {
  const b = boot(t);
  assert.deepEqual(await newSprite(b, 'Fox'), { tabs: [{ id: 1, name: 'Fox', kind: '2d', dirty: false, path: `${FILES}/Fox.openpixel` }], active: 1 });
  assert.ok(b.p.fs.exists(`${FILES}/Fox.openpixel`));
  assert.equal(FakeEngine.freed, 1, 'the blank spare it replaced is given back');
  assert.equal((await newSprite(b, 'Fox')).tabs[1].path, `${FILES}/Fox 2.openpixel`);
  b.p.fs.write(`${FILES}/Fox 3.openpixel`, 'someone else’s');
  assert.equal((await newSprite(b, 'Fox')).tabs[2].path, `${FILES}/Fox 4.openpixel`);
  const model = await b.native('newDocument', { tool: 'new_model', args: { width: 8, height: 8, depth: 8, name: 'a/b: c' } });
  assert.deepEqual(model.tabs[3], { id: 4, name: 'a-b- c', kind: '3d', dirty: false, path: `${FILES}/a-b- c.openpixel` });
  assert.equal((await b.native('newDocument', { tool: 'anything else', args: { name: '.hidden' } })).tabs[4].path, `${FILES}/Untitled.hidden.openpixel`);
  assert.equal((await b.native('newDocument', { args: { name: '  ' } })).tabs[5].path, `${FILES}/Untitled.openpixel`);
  b.tick();
  assert.deepEqual(b.refreshes(), ['refresh("autosave")']);
  await b.native('switchTab', { id: 1 });
  assert.deepEqual(b.p.ui.title, { title: 'OpenPixel — Fox', path: `${FILES}/Fox.openpixel`, edited: false });

  // A file that cannot be made leaves everything as it was, and says why.
  const before = b.host.engine;
  assert.equal(await b.native('newDocument', { tool: 'new_sprite', args: { width: 0 } }), 'width must be at least 1');
  assert.equal(b.host.tabs.length, 6);
  assert.equal(b.host.engine, before);
  assert.equal(b.host.recents.entries.length, 6);
});

test('opening: a new tab, the same tab for the same file, nothing for a file that will not open', async (t) => {
  const b = boot(t);
  b.p.fs.addModel('/art/Fox.openpixel', 'Fox');
  assert.equal(await b.native('openPath', { path: '/art/Fox.openpixel' }), true);
  await newSprite(b, 'Other');
  assert.equal(tabsOf(b).active, 2);
  b.tick();
  b.refreshes();
  assert.equal(await b.native('openPath', { path: '/art/../art/./Fox.openpixel' }), true);
  assert.deepEqual([b.host.tabs.length, tabsOf(b).active], [2, 1]);
  b.tick();
  assert.deepEqual(b.refreshes(), ['refresh("open_model")']);
  assert.deepEqual(b.host.recents.entries.map((e) => e.name), ['Other', 'Fox']);

  assert.equal(await b.native('openPath', { path: '/art/Missing.openpixel' }), 'cannot open /art/Missing.openpixel');
  assert.equal(await b.native('openPath', {}), 'cannot open ');
  assert.deepEqual([b.host.tabs.length, tabsOf(b).active], [2, 1]);

  // From the system (a double-click): the same, with the reason shown in a box.
  b.host.openFile('/art/Missing.openpixel');
  await settle();
  assert.equal(b.p.ui.log.at(-1), 'alert OpenPixel: cannot open /art/Missing.openpixel');
  b.p.fs.addModel('/art/Owl.openpixel', 'Owl');
  b.host.openFile('/art/Owl.openpixel');
  assert.equal(b.p.ui.title?.path, '/art/Owl.openpixel');

  // File › Open…: answers at once; the file opens when the panel closes.
  b.p.ui.openAnswers = ['/art/Fox.openpixel', null, '/art/Missing.openpixel'];
  assert.equal(await b.native('open'), true);
  await settle();
  assert.equal(tabsOf(b).active, 1);
  assert.ok(b.p.ui.log.includes('openPanel openpixel,vox'));
  await b.native('open');
  await b.native('open');
  await settle();
  assert.equal(b.p.ui.log.filter((l) => l.startsWith('alert')).length, 2);
});

test('samples and imported .vox files get a file only once they are changed', async (t) => {
  const b = boot(t);
  assert.equal(await b.native('sample2d'), true);
  assert.equal(await b.native('sample3d'), true);
  b.p.fs.addModel('/downloads/Castle.vox', 'Castle', [20, 20, 20]);
  assert.equal(await b.native('openPath', { path: '/downloads/Castle.vox' }), true);
  assert.deepEqual(tabsOf(b).tabs, [
    { id: 1, name: 'Mushroom', kind: '2d', dirty: false, path: null },
    { id: 2, name: 'Island', kind: '3d', dirty: false, path: null },
    { id: 3, name: 'Castle', kind: '3d', dirty: false, path: null },
  ]);
  assert.deepEqual(b.host.tabs.map((x) => x.saveOnEdit), [true, true, true]);
  b.tick(1500);
  assert.deepEqual(b.p.fs.list(FILES), []);
  await b.host.handle({ kind: 'tool', name: 'set_pixels', args: {} });
  b.tick(1500);
  assert.deepEqual(b.p.fs.list(FILES), ['Castle.openpixel']);
  assert.deepEqual(b.host.tabs.map((x) => x.saveOnEdit), [true, true, false]);
  assert.equal(b.host.quitting !== undefined && (await b.host.quitting()), true, 'untouched samples never ask to be saved');
  assert.deepEqual(b.p.fs.list(FILES), ['Castle.openpixel']);
});

test('switching, reordering and closing tabs', async (t) => {
  const b = boot(t);
  for (const name of ['A', 'B', 'C']) await newSprite(b, name);
  const order = (): string => b.host.tabs.map((x) => x.engine.name).join('');
  assert.equal((await b.native('switchTab', { id: 1 })).active, 1);
  assert.equal(b.p.ui.title?.title, 'OpenPixel — A');
  assert.equal((await b.native('switchTab', { id: 99 })).active, 1);
  assert.equal((await b.native('switchTab', { id: '2' })).active, 1);
  await b.native('moveTab', { id: 1, index: 99 });
  assert.equal(order(), 'BCA');
  await b.native('moveTab', { id: 1, index: -5 });
  assert.equal(order(), 'ABC');
  await b.native('moveTab', { id: 3, index: 1 });
  assert.equal(order(), 'ACB');
  await b.native('moveTab', { id: 77, index: 0 });
  assert.equal(order(), 'ACB');

  // Closing the tab you are on goes to the one that takes its place (or the last one).
  await b.native('switchTab', { id: 3 });
  assert.deepEqual(await b.native('closeTab', { id: 3 }), { tabs: [tabsOf(b).tabs[0], tabsOf(b).tabs[1]], active: 2, closed: true });
  assert.equal((await b.native('closeTab', { id: 1 })).active, 2, 'closing another tab leaves you where you are');
  assert.deepEqual(await b.native('closeTab', { id: 12345 }), { ...tabsOf(b), closed: true });
  assert.deepEqual(await b.native('closeTab', {}), { ...tabsOf(b), closed: true });
  assert.deepEqual(await b.native('closeTab', { id: 2 }), { tabs: [], active: null, closed: true });
  assert.equal(b.host.start(), 'home');
  assert.deepEqual(b.p.ui.title, { title: 'OpenPixel — Untitled', path: null, edited: false });
  assert.deepEqual(b.p.ui.log.filter((l) => l.startsWith('askToSave')), [], 'saved files close without a question');
  assert.equal(FakeEngine.made - FakeEngine.freed, 1, 'only the new blank canvas is left');
});

test('closing a file that could not be saved by itself asks; cancel keeps it, discard closes it, save saves it', async (t) => {
  const b = boot(t);
  await newSprite(b, 'Keep');
  await newSprite(b, 'Locked');
  raw(b.host.engine).lockFile();
  await b.native('switchTab', { id: 1 });

  b.p.ui.askAnswers = ['cancel'];
  assert.equal((await b.native('closeTab', { id: 2 })).closed, false);
  assert.deepEqual(b.p.ui.log.filter((l) => l.startsWith('askToSave')), ['askToSave Locked']);
  assert.equal(tabsOf(b).active, 2, 'the tab in question is shown while it asks');
  assert.equal(b.host.tabs.length, 2);

  // Save…: the save itself fails here too, which is said, and the tab stays.
  b.p.ui.askAnswers = ['save'];
  assert.equal((await b.native('closeTab', { id: 2 })).closed, false);
  assert.equal(b.p.ui.log.at(-1), 'alert OpenPixel: cannot write /readonly/locked.openpixel');

  // Quitting asks the same, and stops when the person cancels.
  b.p.ui.askAnswers = ['cancel'];
  assert.equal(await b.host.quitting(), false);
  b.p.ui.askAnswers = ['discard'];
  assert.equal(await b.host.quitting(), true);

  b.p.ui.askAnswers = ['discard'];
  assert.equal((await b.native('closeTab', { id: 2 })).closed, true);
  assert.deepEqual(b.host.tabs.map((x) => x.id), [1]);

  // A file that only needs writing is written without a question, on close and on quit.
  await b.host.handle({ kind: 'tool', name: 'set_pixels' });
  assert.equal(b.host.engine.dirty, true);
  assert.equal(await b.host.quitting(), true);
  assert.equal(b.host.engine.dirty, false);
  await b.host.handle({ kind: 'tool', name: 'set_pixels' });
  assert.equal((await b.native('closeTab', { id: 1 })).closed, true);
  assert.equal(JSON.parse(b.p.fs.readText(`${FILES}/Keep.openpixel`)).pixels, 2);
  assert.equal(b.p.ui.log.filter((l) => l.startsWith('askToSave')).length, 5);
});

test('Save, Save As and Export go through the panels', async (t) => {
  const b = boot(t);
  // Nothing open: Save asks where, under the canvas's name.
  b.p.ui.saveAnswers = [null, '/art/First.openpixel'];
  b.p.fs.createDirAll('/art');
  assert.equal(await b.native('save'), false);
  assert.deepEqual(b.p.ui.saveOptions.at(-1), { name: 'Untitled.openpixel', extension: 'openpixel' });
  assert.equal(await b.native('save'), true);
  assert.equal(b.host.engine.path, '/art/First.openpixel');
  assert.equal(b.host.start(), 'editor', 'the saved canvas is a tab now');
  assert.deepEqual(b.host.recents.entries.map((e) => e.path), ['/art/First.openpixel']);
  // With a file, Save just saves; Save As asks again.
  const panels = b.p.ui.saveOptions.length;
  assert.equal(await b.native('save'), true);
  assert.equal(b.p.ui.saveOptions.length, panels);
  b.p.ui.saveAnswers = ['/art/Second.openpixel', '/readonly/Third.openpixel'];
  assert.equal(await b.native('saveAs'), true);
  b.tick();
  assert.equal(b.p.ui.title?.path, '/art/Second.openpixel');
  assert.deepEqual(b.refreshes().at(-1), 'refresh("save_model")');
  assert.equal(await b.native('saveAs'), false);
  assert.equal(b.p.ui.log.at(-1), 'alert OpenPixel: cannot write /readonly/Third.openpixel');

  // Export answers at once; the file is written when the panel closes.
  b.p.ui.saveAnswers = ['/art/out.png', '/art/sheet.png', null, '/readonly/x.png'];
  assert.equal(await b.native('export', { format: 'png', options: { scale: 4 } }), true);
  assert.equal(await b.native('export', { format: 'sheet' }), true);
  assert.equal(await b.native('export', { format: 'gif' }), true);
  assert.equal(await b.native('export'), true);
  await settle();
  assert.deepEqual(b.p.ui.saveOptions.slice(-4), [
    { name: 'Untitled.png', extension: 'png' }, { name: 'Untitled-sheet.png', extension: 'png' }, { name: 'Untitled.gif', extension: 'gif' }, { name: 'Untitled.png', extension: 'png' },
  ]);
  assert.ok(b.p.fs.exists('/art/out.png') && b.p.fs.exists('/art/sheet.png'));
  assert.deepEqual(FakeEngine.calls.filter((c) => c.includes('export')), ['person:export_png', 'person:export_sheet', 'person:export_png']);
  assert.equal(b.p.ui.log.at(-1), 'alert OpenPixel: cannot write /readonly/x.png');
});

test('renaming a file: on disk, in the library, in its tab, and its chats follow', async (t) => {
  const made: { chat?: FakeChat } = {};
  const b = boot(t, { chat: (o) => (made.chat = new FakeChat(o)) });
  await newSprite(b, 'Fox');
  b.tick();
  b.refreshes();
  b.p.ui.takePages();
  const old = `${FILES}/Fox.openpixel`;
  const to = `${FILES}/Red Fox.openpixel`;

  assert.equal(await b.native('renameFile', { tab: 1, name: ' Red Fox ' }), true);
  assert.deepEqual([b.p.fs.exists(old), b.p.fs.exists(to)], [false, true]);
  assert.equal(JSON.parse(b.p.fs.readText(to)).name, 'Red Fox', 'the new name is written into the file');
  assert.deepEqual(tabsOf(b).tabs[0], { id: 1, name: 'Red Fox', kind: '2d', dirty: false, path: to });
  assert.deepEqual(b.host.recents.entries.map((e) => [e.path, e.name]), [[to, 'Red Fox']]);
  assert.deepEqual(made.chat?.log, [`move ${old} -> ${to}`]);
  assert.equal(made.chat?.options.workDir, `${DATA}/Chat`);
  b.tick();
  assert.deepEqual(b.p.ui.takePages(), [`chatMoved(${JSON.stringify(old)}, ${JSON.stringify(to)})`, 'refresh("rename")']);
  assert.equal(b.p.ui.title?.title, 'OpenPixel — Red Fox');

  // By path, for a file that is not open; the same name again changes nothing.
  b.p.fs.addModel('/art/Owl.openpixel', 'Owl');
  await b.native('openPath', { path: '/art/Owl.openpixel' });
  await b.native('closeTab', { id: 2 });
  assert.equal(await b.native('renameFile', { path: '/art/Owl.openpixel', name: 'Barn Owl' }), true);
  assert.ok(b.p.fs.exists('/art/Barn Owl.openpixel'));
  assert.equal(b.host.recents.entries[0]?.name, 'Barn Owl');
  assert.equal(await b.native('renameFile', { path: '/art/Barn Owl.openpixel', name: 'Barn Owl' }), true);
  assert.equal(made.chat?.log.length, 2);
  // The path of an open file finds its tab; "/" and ":" cannot be in a name; other endings are kept.
  assert.equal(await b.native('renameFile', { path: `${FILES}/../OpenPixel/Red Fox.openpixel`, name: 'a/b:c' }), true);
  assert.equal(b.host.tabs[0]?.engine.path, `${FILES}/a-b-c.openpixel`);
  b.p.fs.write('/art/model.vox', 'x');
  assert.equal(await b.native('renameFile', { path: '/art/model.vox', name: 'castle' }), true);
  assert.ok(b.p.fs.exists('/art/castle.vox'));

  // What can go wrong, in the words the page shows.
  assert.equal(await b.native('renameFile', { tab: 1, name: '   ' }), 'Give the file a name');
  assert.equal(await b.native('renameFile', { tab: 1, name: '.secret' }), 'Give the file a name');
  assert.equal(await b.native('renameFile', { tab: 99, name: 'x' }), 'Could not find that file');
  assert.equal(await b.native('renameFile', { name: 'x' }), 'Could not find that file');
  assert.equal(await b.native('renameFile', { path: '/art/gone.openpixel', name: 'x' }), 'The file is not there any more');
  assert.equal(await b.native('renameFile', { path: '/art/Barn Owl.openpixel', name: 'castle.vox'.replace('.vox', '') }), true);
  b.p.fs.addModel('/art/Taken.openpixel', 'Taken');
  assert.equal(await b.native('renameFile', { path: '/art/castle.openpixel', name: 'Taken' }), 'There is already a file called “Taken” in that folder');
  b.p.fs.stuck.add('/art/castle.openpixel');
  assert.match(await b.native('renameFile', { path: '/art/castle.openpixel', name: 'Free' }), /^Could not rename it: EPERM/);

  // Only the letter case changes: through a temporary name, so a disk that ignores case goes along.
  assert.equal(await b.native('renameFile', { tab: 1, name: 'A-B-C' }), true);
  assert.deepEqual(b.p.fs.list(FILES), ['A-B-C.openpixel']);
});

test('renaming a document that has no file yet only changes its name; autosave then names the file', async (t) => {
  const b = boot(t);
  await b.native('sample2d');
  assert.equal(await b.native('renameFile', { tab: 1, name: 'Toadstool' }), true);
  assert.deepEqual(tabsOf(b).tabs[0], { id: 1, name: 'Toadstool', kind: '2d', dirty: false, path: null });
  b.tick(1500);
  assert.deepEqual(b.p.fs.list(FILES), ['Toadstool.openpixel']);
  b.tick();
  assert.deepEqual(b.refreshes().at(-1), 'refresh("autosave")');
});

test('deleting from the library closes the file first, then it goes to the Trash with its chats', async (t) => {
  const made: { chat?: FakeChat } = {};
  const b = boot(t, { chat: (o) => (made.chat = new FakeChat(o)) });
  const trashed: string[] = [];
  b.p.ui.trash = async (path) => { trashed.push(path); b.p.fs.remove(path); };
  await newSprite(b, 'Fox');
  await newSprite(b, 'Locked');
  const fox = `${FILES}/Fox.openpixel`;
  b.tick();
  b.refreshes();

  raw(b.host.engine).lockFile();
  assert.equal(await b.native('deleteItem', { id: '/readonly/locked.openpixel' }), '“Locked” is open with unsaved changes. Close its tab first.');
  assert.equal(b.host.tabs.length, 2);

  assert.equal(await b.native('deleteItem', { id: fox }), true);
  assert.deepEqual([trashed, b.host.tabs.map((x) => x.id), made.chat?.log], [[fox], [2], [`delete ${fox}`]]);
  b.tick();
  assert.deepEqual(b.refreshes(), ['refresh("close_tab")']);
  assert.equal(await b.native('deleteItem', { id: fox }), 'That file is no longer in the library.');
  assert.equal(await b.native('deleteItem', { id: 'sample3d' }), true);
  assert.equal(made.chat?.log.length, 1, 'samples have no chats to delete');
  assert.deepEqual((await b.native('library')).files.map((f: { id: string }) => f.id), [`${FILES}/Locked.openpixel`, 'sample2d']);
});

test('the library actions answer what the page expects', async (t) => {
  const b = boot(t);
  await newSprite(b, 'Fox');
  const fox = `${FILES}/Fox.openpixel`;
  const folder = await b.native('createFolder', { name: 'Heroes' });
  assert.equal(typeof folder, 'string');
  assert.equal(await b.native('createFolder', { name: 'x', parent: 'nope' }), false);
  const inner = await b.native('createFolder', { parent: folder });
  assert.equal(await b.native('renameFolder', { id: inner, name: 'Bosses' }), true);
  assert.equal(await b.native('renameFolder', {}), false);
  assert.equal(await b.native('moveFolder', { id: folder, parent: inner }), false);
  assert.equal(await b.native('moveFolder', { id: inner }), true);
  assert.equal(await b.native('moveItem', { id: fox, folder }), true);
  assert.equal(await b.native('moveItem', { id: fox, folder: 'nope' }), false);
  assert.equal(await b.native('archiveItem', { id: fox }), true, 'archived unless told otherwise');
  let lib = await b.native('library');
  assert.deepEqual([lib.files[0].archived, lib.files[0].folder, lib.folders.length], [true, folder, 2]);
  assert.equal(await b.native('archiveItem', { id: fox, archived: false }), true);
  assert.equal(await b.native('deleteFolder', { id: folder }), true);
  assert.equal(await b.native('deleteFolder', { id: folder }), false);
  assert.equal(await b.native('removeRecent', { path: fox }), true);
  lib = await b.native('library');
  assert.deepEqual(lib.files.map((f: { id: string }) => f.id), ['sample2d', 'sample3d']);
  assert.ok(b.p.fs.exists(fox), 'removing from Recents leaves the file alone');
});

test('small things the page asks the window for', async (t) => {
  const b = boot(t);
  assert.equal(await b.native('new'), true);
  assert.equal(await b.native('copyText', { text: 'openpixel --mcp' }), true);
  assert.equal(b.p.ui.clipboard, 'openpixel --mcp');
  assert.equal(await b.native('openLink', { link: 'github' }), true);
  assert.equal(await b.native('openLink', { link: 'website' }), true);
  assert.equal(await b.native('openLink', { link: 'x' }), true);
  assert.equal(await b.native('openLink', { link: 'https://evil.example' }), false);
  assert.equal(await b.native('openLink', { link: 'constructor' }), false);
  assert.equal(await b.native('openURL', { url: 'cursor://anysphere.cursor-deeplink/mcp/install?name=openpixel' }), true);
  assert.equal(await b.native('openURL', { url: 'https://example.com' }), false);
  assert.equal(await b.native('openURL', {}), false);
  assert.deepEqual(b.p.ui.log.filter((l) => l.startsWith('openExternal')), [
    'openExternal https://github.com/sophne/openpixel', 'openExternal https://openpixel.dev', 'openExternal https://x.com/eminvkc',
    'openExternal cursor://anysphere.cursor-deeplink/mcp/install?name=openpixel',
  ]);
  b.p.fs.createDirAll('/home/me/.cursor');
  b.p.fs.write('/home/me/.cursor/mcp.json', '{}');
  assert.equal(await b.native('revealConfig', { path: '~/.cursor/mcp.json' }), true);
  assert.equal(await b.native('revealConfig', { path: '~/.nothing/here.json' }), false);
  assert.equal(await b.native('revealConfig', {}), false);
  assert.equal(await b.native('reveal', { path: '/art/Fox.openpixel' }), true);
  assert.equal(await b.native('reveal', {}), true);
  assert.deepEqual(b.p.ui.log.filter((l) => l.startsWith('reveal')), ['reveal /home/me/.cursor/mcp.json', 'reveal /art/Fox.openpixel']);
  assert.equal(await b.native('mcpCommand'), '/opt/OpenPixel/openpixel');
  assert.equal(await b.native('socketPath'), `${DATA}/openpixel.sock`);
  assert.equal(await b.native('titlebar', { holes: [[0, 80]], drag: true }), true);
  assert.equal(await b.native('haptic'), true);
  assert.equal(await b.native('no such action'), false);
  assert.equal(await b.host.handle({ kind: 'native' }), false);
  assert.deepEqual(await b.native('tabs'), { tabs: [], active: null });
  assert.deepEqual(await b.native('version'), { version: '1.0.0', build: '', updates: true, automatic: false, available: null });
});

test('GitHub stars: the last known count at once, a fresh one at most once an hour', async (t) => {
  const b = boot(t);
  const asked = (): number => b.p.fetched.filter((f) => f.url === STARS).length;
  b.p.web.set(STARS, JSON.stringify({ stargazers_count: 1234, name: 'openpixel' }));
  assert.equal(await b.native('githubStars'), null);
  await settle();
  assert.equal(asked(), 1);
  assert.deepEqual(b.p.fetched.find((f) => f.url === STARS)?.headers, { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenPixel' });
  assert.deepEqual(b.p.ui.takePages('githubStars'), ['githubStars(1234)']);
  assert.deepEqual(JSON.parse(b.p.fs.readText(`${DATA}/prefs.json`)), { githubStars: 1234, githubStarsAt: b.p.clock.now });

  b.p.clock.now += 3600;
  assert.equal(await b.native('githubStars'), 1234);
  await settle();
  assert.equal(asked(), 1);
  // Later, offline or rate-limited: the old count stays and the next ask tries again.
  b.p.clock.now += 1;
  b.p.web.set(STARS, '{"message":"API rate limit exceeded"}');
  assert.equal(await b.native('githubStars'), 1234);
  await settle();
  b.p.web.delete(STARS);
  assert.equal(await b.native('githubStars'), 1234);
  await settle();
  assert.equal(asked(), 3);
  assert.deepEqual(b.p.ui.takePages('githubStars'), []);
  b.p.web.set(STARS, '{"stargazers_count":1300}');
  await b.native('githubStars');
  await settle();
  assert.deepEqual(b.p.ui.takePages('githubStars'), ['githubStars(1300)']);
  assert.equal(await b.native('githubStars'), 1300);
});

test('updates: the feed decides, the page shows the button, the person confirms in the dialog', async (t) => {
  const p = memoryPlatform();
  p.web.set(FEED_URL, '<rss><v>2.0.0</v></rss>');
  const b = boot(t, { platform: p, updates: true });
  await settle();
  // Asked quietly at launch: only the button appears.
  assert.deepEqual(b.p.fetched.map((f) => [f.url, f.headers]), [[FEED_URL, { 'User-Agent': 'OpenPixel/1.0.0' }]]);
  assert.deepEqual(b.p.ui.takePages('updateAvailable'), ['updateAvailable("2.0.0")']);
  assert.equal((await b.native('version')).available, '2.0.0');
  assert.deepEqual(b.p.ui.updateDialogs, []);

  // An agent asks: the feed's answer (kept for ten minutes), and with install=true the dialog opens.
  const answer = await b.agent({ tool: 'check_for_updates', args: {} });
  assert.deepEqual(answer.json, {
    running_version: '1.0.0', latest_version: '2.0.0', update_available: true, download: 'https://example.test/v2.0.0/OpenPixel.dmg',
    release_notes: 'https://example.test/notes/v2.0.0', next: 'Tell the person OpenPixel 2.0.0 is out.',
  });
  assert.equal(b.p.fetched.length, 1);
  const install = await b.agent({ tool: 'check_for_updates', args: { install: 'yes', refresh: true } });
  assert.equal(install.json.install, 'The update dialog is open in OpenPixel. The person confirms; OpenPixel then restarts with the new version. Reconnect the OpenPixel MCP server afterwards.');
  assert.equal(b.p.fetched.length, 2);
  await settle();
  assert.deepEqual(b.p.ui.updateDialogs, [{ version: '2.0.0', url: 'https://example.test/v2.0.0/OpenPixel.dmg', notes: 'https://example.test/notes/v2.0.0' }]);
  assert.equal(FakeEngine.calls.includes('agent:check_for_updates'), false, 'the window answers this one itself');

  // The Update button and the menu item do the same.
  assert.equal(await b.native('checkUpdates'), true);
  await settle();
  assert.equal(b.p.ui.updateDialogs.length, 2);

  // Up to date: the button goes away; install has nothing to do.
  b.p.web.set(FEED_URL, '<rss><v>1.0.0</v></rss>');
  b.p.clock.now += 601;
  const current = await b.agent({ tool: 'check_for_updates', args: { install: true } });
  assert.deepEqual([current.json.update_available, current.json.install], [false, 'Nothing to install.']);
  assert.deepEqual(b.p.ui.takePages('updateAvailable').at(-1), 'updateAvailable(null)');
  await b.native('checkUpdates');
  await settle();
  assert.equal(b.p.ui.log.at(-1), 'alert Updates: OpenPixel 1.0.0 is currently the newest version available.');

  // A feed without a release, or no network, is an error, never "up to date".
  b.p.web.set(FEED_URL, '<rss></rss>');
  assert.deepEqual(await b.agent({ tool: 'check_for_updates', args: { refresh: true } }), { ok: false, error: 'the update feed lists no release' });
  b.p.web.delete(FEED_URL);
  assert.deepEqual(await b.agent({ tool: 'check_for_updates', args: { refresh: 1 } }), { ok: false, error: 'the update feed did not answer (offline?)' });
  await b.native('checkUpdates');
  await settle();
  assert.equal(b.p.ui.log.at(-1), 'alert Updates: OpenPixel could not check for updates: the update feed did not answer (offline?).');
});

test('updates with a core that cannot read the feed yet: "unknown", not a guess', async (t) => {
  const p = memoryPlatform();
  p.web.set(FEED_URL, '<rss><v>2.0.0</v></rss>');
  const b = boot(t, { platform: p });
  await settle();
  assert.deepEqual(b.p.ui.takePages('updateAvailable'), ['updateAvailable(null)']);
  const answer = await b.agent({ tool: 'check_for_updates', args: { install: true } });
  assert.deepEqual(answer.json, { running_version: '1.0.0', latest_version: 'unknown', update_available: 'unknown', install: 'Nothing to install.' });
  await b.native('checkUpdates');
  await settle();
  assert.equal(b.p.ui.log.at(-1), 'alert Updates: OpenPixel could not tell whether a newer version is out.');
  assert.deepEqual(b.p.ui.updateDialogs, []);
});

test('the editor screenshot is for agents: the window takes it, and it does not wait for ever', async (t) => {
  const b = boot(t);
  b.p.socket!.handlers.opened(1);
  assert.deepEqual(await b.agent({ tool: 'get_editor_screenshot', args: {} }), {
    ok: true, json: { note: 'The OpenPixel editor as the person sees it.' }, images: [Buffer.from([137, 80, 78, 71]).toString('base64')],
  });
  b.p.ui.png = null;
  assert.deepEqual(await b.agent({ tool: 'get_editor_screenshot' }), { ok: false, error: 'could not capture the window' });
  b.p.ui.png = new Uint8Array();
  assert.deepEqual(await b.agent({ tool: 'get_editor_screenshot' }), { ok: false, error: 'could not capture the window' });
  b.p.ui.screenshot = () => new Promise(() => undefined);
  const waiting = b.agent({ tool: 'get_editor_screenshot' });
  await settle();
  b.tick(10_000);
  assert.deepEqual(await waiting, { ok: false, error: 'the window did not answer' });
  assert.equal((await b.native('agents', { setup: false })).sessions[0].last_tool, 'get_editor_screenshot');
  assert.equal(FakeEngine.calls.some((c) => c.includes('screenshot')), false);
});

test('Agent Chat goes to the runner the shell passed in; without one nothing starts', async (t) => {
  const none = boot(t);
  const chat = (b: Booted, action: string, more: Record<string, unknown> = {}): Promise<any> => b.host.handle({ kind: 'chat', action, ...more });
  assert.deepEqual(await chat(none, 'providers'), []);
  assert.equal(await chat(none, 'send', { chat: 'c1' }), false);
  assert.equal(await chat(none, 'history', { key: '/a' }), false);

  const made: { chat?: FakeChat } = {};
  const b = boot(t, { chat: (o) => (made.chat = new FakeChat(o)) });
  assert.equal('chat' in made, false, 'made when the chat is first used');
  assert.deepEqual(await chat(b, 'providers'), [{ id: 'claude-code', ready: true }]);
  assert.deepEqual([made.chat?.options.mcpCommand, made.chat?.options.workDir, made.chat?.options.fs], ['/opt/OpenPixel/openpixel', `${DATA}/Chat`, b.p.fs]);
  assert.equal(await chat(b, 'send', { chat: 'c1', provider: 'claude-code', prompt: 'draw a fox' }), true);
  assert.deepEqual(b.p.ui.takePages('chatEvent'), ['chatEvent({"t":"done","chat":"c1","ok":true})']);
  assert.equal(await chat(b, 'stop', { chat: 'c1' }), true);
  assert.equal(await chat(b, 'stop'), true);
  assert.deepEqual(await chat(b, 'skills', { provider: 'codex' }), [{ name: 'pixel-tips', provider: 'codex' }]);
  assert.equal(await chat(b, 'login', { provider: 'cursor' }), true);
  assert.equal(await chat(b, 'login'), 'Nothing to sign in to.');
  assert.deepEqual(await chat(b, 'history', { key: '/a.openpixel' }), { key: '/a.openpixel' });
  assert.equal(await chat(b, 'history'), null);
  assert.equal(await chat(b, 'saveHistory', { key: '/a.openpixel', data: { threads: [] } }), true);
  assert.deepEqual(made.chat?.log, ['start c1', 'stop c1', 'stop ', 'save /a.openpixel {"threads":[]}']);
  await assert.rejects(chat(b, 'dance'), { message: 'unknown chat action' });
  await assert.rejects(chat(b, ''), { message: 'unknown chat action' });
  b.host.dispose();
  assert.equal(made.chat?.log.at(-1), 'stopAll');
});

test('a UI test run: its own empty library and files, a private socket, no network, no real agents', async (t) => {
  const p = memoryPlatform();
  p.fs.addModel('/home/me/.local/share/OpenPixel/recents.json', 'not really a library');
  p.fs.addModel('/runs/7/Files/Left over.openpixel', 'Left over');
  p.fs.write('/runs/7/recents.json', '[{"path":"/x.openpixel","name":"x","kind":"2d","size":[1,1,1],"touched":1}]');
  p.web.set(STARS, '{"stargazers_count":5}');
  p.web.set(FEED_URL, '<rss><v>9.0.0</v></rss>');
  const made: { chat?: FakeChat } = {};
  const b = boot(t, { platform: p, uiTest: '/runs/7/', updates: true, chat: (o) => (made.chat = new FakeChat(o)) });
  await settle();
  assert.equal(b.host.recents.entries.length === 0, true, 'last run’s library is not read');
  assert.deepEqual(p.fs.list('/runs/7/Files'), []);
  assert.equal(p.socket?.path, '/runs/7/op.sock');
  assert.equal(await b.native('socketPath'), '/runs/7/op.sock');
  assert.equal((await newSprite(b, 'Fox')).tabs[0].path, '/runs/7/Files/Fox.openpixel');
  assert.ok(p.fs.exists('/runs/7/recents.json') && p.fs.exists(`/runs/7/thumbs/${b.host.recents.entries[0]?.thumb}`));

  assert.equal(await b.native('githubStars'), null);
  assert.deepEqual(await b.native('version'), { version: '1.0.0', build: '', updates: false, automatic: false, available: null });
  await b.native('checkUpdates');
  await settle();
  assert.equal(p.ui.log.at(-1), 'alert Updates: Updates are checked by the installed OpenPixel app (in Applications). This copy was started on its own.');
  assert.deepEqual(p.fetched, [], 'nothing went to the network');

  assert.deepEqual(await b.host.handle({ kind: 'chat', action: 'providers' }), []);
  assert.equal(await b.host.handle({ kind: 'chat', action: 'send', chat: 'c' }), false);
  assert.equal('chat' in made, false);

  // The test's own agents: the real MCP program, pointed at this window's socket.
  const spawn = b.host.handle({ kind: 'spawnAgent', client: 'cursor-vscode', call: false });
  await settle();
  assert.deepEqual(p.spawned, [{ command: '/opt/OpenPixel/openpixel', socketPath: '/runs/7/op.sock', client: 'cursor-vscode', call: false }]);
  let answered = false;
  void spawn.then(() => { answered = true; });
  b.tick(1499);
  await settle();
  assert.equal(answered, false, 'it answers once the agent has had time to connect');
  b.tick(1);
  assert.equal(await spawn, true);
  const second = b.host.handle({ kind: 'spawnAgent' });
  await settle();
  b.tick(1500);
  await second;
  assert.deepEqual(p.spawned[1], { command: '/opt/OpenPixel/openpixel', socketPath: '/runs/7/op.sock', client: 'test-agent', call: true });
  const stop = b.host.handle({ kind: 'stopAgents' });
  await settle();
  b.tick(500);
  assert.equal(await stop, true);
  assert.deepEqual(p.spawned, []);

  // Quitting never asks in a test run.
  raw(b.host.engine).lockFile();
  assert.equal(await b.host.quitting(), true);
  assert.deepEqual(p.ui.log.filter((l) => l.startsWith('askToSave')), []);
});

test('a screenshot run leaves no trace: no socket, no autosave, a throwaway library', async (t) => {
  const p = memoryPlatform();
  p.fs.addModel('/art/Fox.openpixel', 'Fox');
  const b = boot(t, { platform: p, screenshot: true, open: '/art/Fox.openpixel' });
  assert.equal(b.host.start(), 'editor');
  assert.equal(p.socket, null);
  assert.match(b.host.recents.folder, /^\/tmp\/OpenPixel-screenshot-[0-9A-F-]{36}$/);
  assert.equal(p.fs.exists(`${DATA}/recents.json`), false);
  await b.host.handle({ kind: 'tool', name: 'set_pixels' });
  b.tick(5000);
  assert.equal(JSON.parse(p.fs.readText('/art/Fox.openpixel')).pixels, 3, 'the file is as it was');
  assert.equal((await b.native('agents', { setup: false })).bridge, false);
  assert.equal(await b.host.quitting(), true);
});

test('a file to open at launch is the first tab; one that will not open is passed over', (t) => {
  const p = memoryPlatform();
  p.fs.addModel('/art/Fox.openpixel', 'Fox');
  const b = boot(t, { platform: p, open: '/art/Fox.openpixel' });
  assert.equal(b.host.start(), 'editor');
  assert.deepEqual(tabsOf(b), { tabs: [{ id: 1, name: 'Fox', kind: '2d', dirty: false, path: '/art/Fox.openpixel' }], active: 1 });
  assert.deepEqual(p.ui.title, { title: 'OpenPixel — Fox', path: '/art/Fox.openpixel', edited: false });
  assert.deepEqual(b.host.recents.entries.map((e) => e.name), ['Fox']);
  assert.equal(FakeEngine.made - FakeEngine.freed, 1);

  const missing = boot(t, { open: '/art/Nope.openpixel' });
  assert.equal(missing.host.start(), 'home');
  assert.equal(FakeEngine.made - FakeEngine.freed, 1);
});

test('without a desktop around it (a browser), the same logic runs: no socket, no agents’ command', async (t) => {
  const b = boot(t, { platform: memoryPlatform({ desktop: false }) });
  assert.equal(b.host.bridge, null);
  assert.equal(await b.native('socketPath'), '');
  assert.equal(await b.native('mcpCommand'), '');
  assert.deepEqual([(await b.native('agents', { setup: false })).bridge, (await b.native('agents', { setup: false })).command], [false, '']);
  assert.equal((await newSprite(b, 'Fox')).tabs[0].path, `${FILES}/Fox.openpixel`);
});

test('closing down stops the socket and the timers and gives every engine back', async (t) => {
  const b = boot(t);
  await newSprite(b, 'A');
  await newSprite(b, 'B');
  await b.host.handle({ kind: 'tool', name: 'set_pixels' });
  b.host.dispose();
  b.host.dispose();
  assert.equal(b.p.socket?.stopped, true);
  assert.equal(FakeEngine.made, FakeEngine.freed);
  b.tick(5000);
  assert.deepEqual(b.refreshes(), []);
  assert.equal(JSON.parse(b.p.fs.readText(`${FILES}/B.openpixel`)).pixels, 0, 'nothing is written after the window is gone');
});

test('a core that is not the package says so plainly', () => {
  assert.throws(() => new AppHost({ platform: memoryPlatform(), core: {} }), { message: 'OpenPixel could not load its core.' });
  assert.throws(() => new AppHost({ platform: memoryPlatform(), core: null }), { message: 'OpenPixel could not load its core.' });
});
