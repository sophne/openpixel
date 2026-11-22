// The agents' socket on Node (the server side of Bridge.swift) and the Node half of the platform, on real files
// and a real socket in a temporary folder; then the whole way: the MCP program → the socket → the host.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { type TestContext, test } from 'node:test';
import { AppHost } from '../documents';
import { listen, listenAddress, pipeName } from '../node/bridge';
import { dataFolder, documentsFolder, nodeFS, nodePaths, nodePlatform, socketPath } from '../node/platform-node';
import type { Platform } from '../platform';
import { RecordingUI, fakeCore } from './fakes';

function tempFolder(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-host-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** An agent's end: sends lines, reads reply lines. */
class Client {
  private socket: net.Socket;
  private pending = '';
  private waiting: ((line: string) => void)[] = [];
  private lines: string[] = [];
  closed: Promise<void>;

  constructor(address: string) {
    this.socket = net.connect(address);
    this.socket.setEncoding('utf8');
    this.socket.on('data', (chunk: string) => {
      this.pending += chunk;
      for (let nl = this.pending.indexOf('\n'); nl >= 0; nl = this.pending.indexOf('\n')) {
        const line = this.pending.slice(0, nl);
        this.pending = this.pending.slice(nl + 1);
        const next = this.waiting.shift();
        if (next) next(line);
        else this.lines.push(line);
      }
    });
    this.closed = new Promise((done) => this.socket.on('close', () => done()));
    this.socket.on('error', () => undefined);
  }
  send(text: string): void {
    this.socket.write(text);
  }
  next(): Promise<string> {
    const line = this.lines.shift();
    return line !== undefined ? Promise.resolve(line) : new Promise((done) => this.waiting.push(done));
  }
  async ask(request: unknown): Promise<any> {
    this.send(JSON.stringify(request) + '\n');
    return JSON.parse(await this.next());
  }
  end(): void {
    this.socket.end();
  }
}

const until = async (what: () => boolean, ms = 5000): Promise<void> => {
  for (const start = Date.now(); !what(); ) {
    if (Date.now() - start > ms) throw new Error('waited too long');
    await new Promise((done) => setTimeout(done, 10));
  }
};

test('the socket: owner-only, one reply line per request line, in order, per connection', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tempFolder(t);
  const address = path.join(dir, 'data', 'op.sock');
  const events: string[] = [];
  const server = listen(address, {
    line: async (line, id) => {
      // The first request takes longest: replies must still come back in the order asked.
      if (line.includes('slow')) await new Promise((done) => setTimeout(done, 40));
      if (line.includes('throw')) throw new Error('boom');
      return JSON.stringify({ id, echo: line });
    },
    opened: (id) => events.push(`open ${id}`),
    closed: (id) => events.push(`close ${id}`),
  });
  t.after(() => server.stop());
  assert.equal(server.path, address);
  await until(() => fs.existsSync(address));
  assert.equal(fs.statSync(address).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(address)).mode & 0o777, 0o700);

  const a = new Client(address);
  const b = new Client(address);
  // Two requests in one write, the second cut in half: lines are what count, not packets.
  a.send('{"n":"slow"}\n{"n":"qui');
  a.send('ck é"}\n');
  assert.deepEqual(JSON.parse(await a.next()), { id: 1, echo: '{"n":"slow"}' });
  assert.deepEqual(JSON.parse(await a.next()), { id: 1, echo: '{"n":"quick é"}' });
  assert.deepEqual(await b.ask({ n: 1 }), { id: 2, echo: '{"n":1}' });
  assert.deepEqual(await b.ask('throw'), { ok: false, error: 'boom' });
  a.end();
  await a.closed;
  await until(() => events.includes('close 1'));
  assert.deepEqual(events, ['open 1', 'open 2', 'close 1']);

  // A socket file left behind by a crash is replaced; stopping removes it and hangs up.
  const again = listen(address, { line: () => '{}', opened: () => undefined, closed: () => undefined });
  await until(() => fs.existsSync(address));
  again.stop();
  server.stop();
  await b.closed;
  assert.equal(fs.existsSync(address), false);
});

test('a socket that cannot be had is reported', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tempFolder(t);
  const quiet = { line: () => '{}', opened: () => undefined, closed: () => undefined };
  // Too long for a socket: said at once (the system itself would quietly listen at a shortened path).
  assert.throws(() => listen(path.join(dir, 'x'.repeat(200), 'op.sock'), quiet), /the socket's path is too long \(\d+ bytes, \d+ at most\)/);
  assert.deepEqual(fs.readdirSync(dir), []);
  // Refused by the system (here: the folder is a file): heard through `failed`.
  fs.writeFileSync(path.join(dir, 'file'), '');
  const failures: string[] = [];
  let server;
  try {
    server = listen(path.join(dir, 'file', 'op.sock'), { ...quiet, failed: (e) => failures.push(e) });
  } catch (e) {
    failures.push(String(e));
  }
  await until(() => failures.length > 0);
  server?.stop();
  assert.match(failures[0] ?? '', /ENOTDIR|EEXIST|ENOENT/);
});

test('pipe names for Windows, the same as the MCP program makes them', () => {
  assert.equal(pipeName('Ada'), '\\\\.\\pipe\\openpixel-Ada');
  assert.equal(pipeName('ada lovelace@work'), '\\\\.\\pipe\\openpixel-ada_lovelace_work');
  assert.equal(pipeName('Zoë.K-1_x'), '\\\\.\\pipe\\openpixel-Zo_.K-1_x');
  assert.equal(pipeName(''), '\\\\.\\pipe\\openpixel-user');
  assert.equal(listenAddress('/tmp/run/op.sock', 'linux'), '/tmp/run/op.sock');
  assert.equal(listenAddress('\\\\.\\pipe\\openpixel-Ada', 'win32'), '\\\\.\\pipe\\openpixel-Ada');
  assert.match(listenAddress('C:\\runs\\7\\op.sock', 'win32'), /^\\\\\.\\pipe\\openpixel-[0-9a-f]{24}$/);
  assert.equal(listenAddress('C:\\runs\\7\\op.sock', 'win32'), listenAddress('C:\\runs\\7\\op.sock', 'win32'));
});

test('folders on each system, by the same rules as the MCP program', (t) => {
  assert.equal(dataFolder('darwin', '/Users/ada', {}), '/Users/ada/Library/Application Support/OpenPixel');
  assert.equal(dataFolder('linux', '/home/ada', {}), '/home/ada/.local/share/OpenPixel');
  assert.equal(dataFolder('linux', '/home/ada', { XDG_DATA_HOME: '/data/xdg' }), '/data/xdg/OpenPixel');
  assert.equal(dataFolder('linux', '/home/ada', { XDG_DATA_HOME: 'relative' }), '/home/ada/.local/share/OpenPixel');
  assert.equal(dataFolder('win32', 'C:\\Users\\ada', { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' }), 'C:\\Users\\ada\\AppData\\Roaming\\OpenPixel');
  assert.equal(dataFolder('win32', 'C:\\Users\\ada', {}), 'C:\\Users\\ada\\AppData\\Roaming\\OpenPixel');

  assert.equal(socketPath('linux', '/home/ada/.local/share/OpenPixel', {}, () => 'ada'), '/home/ada/.local/share/OpenPixel/openpixel.sock');
  assert.equal(socketPath('darwin', '/Users/ada/Library/Application Support/OpenPixel', {}, () => 'ada'), '/Users/ada/Library/Application Support/OpenPixel/openpixel.sock');
  assert.equal(socketPath('linux', '/x', { OPENPIXEL_SOCKET: '/tmp/mine.sock' }, () => 'ada'), '/tmp/mine.sock');
  assert.equal(socketPath('linux', '/x', { OPENPIXEL_SOCKET: '' }, () => 'ada'), '/x/openpixel.sock');
  assert.equal(socketPath('win32', 'C:\\x', { USERNAME: 'Ada L' }, () => 'other'), '\\\\.\\pipe\\openpixel-Ada_L');
  assert.equal(socketPath('win32', 'C:\\x', {}, () => 'ada'), '\\\\.\\pipe\\openpixel-ada');

  const home = tempFolder(t);
  assert.equal(documentsFolder('linux', home, {}), path.join(home, 'Documents'));
  fs.mkdirSync(path.join(home, '.config'));
  fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), '# made by xdg-user-dirs\nXDG_DESKTOP_DIR="$HOME/Bureau"\nXDG_DOCUMENTS_DIR="$HOME/Dokumente"\n');
  assert.equal(documentsFolder('linux', home, {}), path.join(home, 'Dokumente'));
  assert.equal(documentsFolder('darwin', home, {}), path.join(home, 'Documents'));
  fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/"\n');
  assert.equal(documentsFolder('linux', home, {}), path.join(home, 'Documents'));
  fs.writeFileSync(path.join(home, '.config', 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="/srv/docs"\n');
  assert.equal(nodePaths({ os: 'linux', home, env: {} }).files, '/srv/docs/OpenPixel');

  const paths = nodePaths({ os: 'linux', home: '/home/ada', env: {} });
  assert.deepEqual([paths.data, paths.files, paths.sep], ['/home/ada/.local/share/OpenPixel', '/home/ada/Documents/OpenPixel', '/']);
  assert.equal(paths.normalize('~/art/../Fox.openpixel'), '/home/ada/Fox.openpixel');
  assert.equal(paths.normalize('~'), '/home/ada');
  assert.equal(paths.normalize('/a/./b/../c'), '/a/c');
  assert.deepEqual([paths.basename('/a/Fox.openpixel', '.openpixel'), paths.extname('/a/Fox.openpixel'), paths.dirname('/a/Fox.openpixel'), paths.join('/a', 'b', 'c.txt')], ['Fox', '.openpixel', '/a', '/a/b/c.txt']);
  const win = nodePaths({ os: 'win32', home: 'C:\\Users\\ada', env: { APPDATA: 'C:\\Users\\ada\\AppData\\Roaming' } });
  assert.deepEqual([win.files, win.sep, win.normalize('~\\x\\..\\y.openpixel')], ['C:\\Users\\ada\\Documents\\OpenPixel', '\\', 'C:\\Users\\ada\\y.openpixel']);

  // A test run keeps everything in its own folder, and its socket is its own whatever the environment says.
  const run = nodePlatform({ uiTest: '/runs/7/', os: 'linux', home: '/home/ada', env: { OPENPIXEL_SOCKET: '/tmp/real.sock' } });
  assert.deepEqual([run.paths.data, run.paths.files, run.socketPath], ['/runs/7', '/runs/7/Files', '/runs/7/op.sock']);
  assert.deepEqual(Object.keys(run).sort(), ['fetchText', 'fs', 'local', 'now', 'paths', 'socketPath']);
  assert.equal(nodePlatform({ os: 'linux', home: '/home/ada', env: { OPENPIXEL_SOCKET: '/tmp/real.sock' } }).socketPath, '/tmp/real.sock');
  assert.ok(Math.abs(run.now() - Date.now() / 1000) < 5);
});

test('files on Node: written whole, read back, listed, removed', (t) => {
  const dir = tempFolder(t);
  const file = path.join(dir, 'a', 'b', 'Fox.openpixel');
  assert.throws(() => nodeFS.read(file), /ENOENT/);
  assert.throws(() => nodeFS.write(file, 'x'), /ENOENT/);
  nodeFS.createDirAll(path.dirname(file));
  nodeFS.createDirAll(path.dirname(file));
  nodeFS.write(file, 'héllo');
  nodeFS.write(file, new Uint8Array([1, 2, 3]));
  assert.deepEqual([...nodeFS.read(file)], [1, 2, 3]);
  assert.deepEqual(nodeFS.list(path.dirname(file)), ['Fox.openpixel'], 'no temporary file is left beside it');
  assert.deepEqual(nodeFS.list(path.join(dir, 'nowhere')), []);
  assert.deepEqual([nodeFS.exists(file), nodeFS.exists(file + 'x'), nodeFS.stat(file)?.size, nodeFS.stat(file)?.isDirectory, nodeFS.stat(dir)?.isDirectory, nodeFS.stat(file + 'x')], [true, false, 3, false, true, null]);
  nodeFS.rename(file, path.join(dir, 'Owl.openpixel'));
  assert.throws(() => nodeFS.rename(file, path.join(dir, 'x')), /ENOENT/);
  nodeFS.remove(path.join(dir, 'a'));
  nodeFS.remove(path.join(dir, 'a'));
  assert.deepEqual(nodeFS.list(dir), ['Owl.openpixel']);
  if (process.platform !== 'win32') {
    nodeFS.createDirAll(path.join(dir, 'private'), 0o700);
    assert.equal(fs.statSync(path.join(dir, 'private')).mode & 0o777, 0o700);
  }
});

/** The host as Electron puts it together, on real files and a real socket, with the scripted engine. */
function realHost(t: TestContext, dir: string, mcpCommand: string): { host: AppHost; ui: RecordingUI; platform: Platform } {
  const ui = new RecordingUI();
  const { socketPath: socket, ...half } = nodePlatform({ uiTest: dir });
  const platform: Platform = { os: 'linux', ...half, ui, desktop: { mcpCommand, socketPath: socket } };
  const host = new AppHost({ platform, core: fakeCore(), uiTest: dir });
  t.after(() => host.dispose());
  return { host, ui, platform };
}

test('an agent on the real socket: hello, tool calls, a screenshot; the Agents page sees it come and go', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tempFolder(t);
  const { host } = realHost(t, dir, '/nowhere/openpixel');
  const address = path.join(dir, 'op.sock');
  assert.equal(await host.handle({ kind: 'native', action: 'socketPath' }), address);
  await until(() => fs.existsSync(address));
  const sessions = async (): Promise<any[]> => ((await host.handle({ kind: 'native', action: 'agents', setup: false })) as { sessions: any[] }).sessions;

  const agent = new Client(address);
  assert.deepEqual(await agent.ask({ hello: { name: 'cursor-vscode', version: '1.2', pid: 7, transport: 'stdio' } }), { ok: true });
  assert.deepEqual((await sessions()).map((s) => [s.client, s.agent, s.calls, s.open]), [['cursor-vscode', 'cursor', 0, true]]);
  assert.deepEqual(await agent.ask({ tool: 'set_pixels', args: {} }), { ok: true, json: { revision: 2 }, images: [] });
  assert.deepEqual(await agent.ask({ tool: 'get_model_info', args: {} }), { ok: true, json: { name: 'Untitled', size: [32, 32, 1], pixels: 1 }, images: [] });
  assert.deepEqual(await agent.ask({ tool: 'get_editor_screenshot', args: {} }), { ok: true, json: { note: 'The OpenPixel editor as the person sees it.' }, images: ['iVBORw=='] });
  assert.deepEqual(await agent.ask({ tool: 'fill_everything', args: {} }), { ok: false, error: 'unknown tool fill_everything' });
  assert.deepEqual((await sessions()).map((s) => [s.calls, s.last_tool]), [[4, 'fill_everything']]);
  // What the agent drew is a tab, and 1.5 s later a file in the run's own Files folder.
  assert.equal(host.start(), 'editor');
  await until(() => fs.existsSync(path.join(dir, 'Files', 'Untitled.openpixel')), 4000);
  agent.end();
  await agent.closed;
  await until(() => host.agents.snapshot(false).sessions !== undefined && (host.agents.snapshot(false).sessions as any[])[0].open === false);
  assert.ok(fs.existsSync(path.join(dir, 'agents.json')) && fs.existsSync(path.join(dir, 'recents.json')));
  await assert.rejects(host.handle({ kind: 'spawnAgent' }), { message: 'The program agents start is missing: /nowhere/openpixel' });
  host.dispose();
  assert.equal(fs.existsSync(address), false);
});

// The native MCP program, when it has been built (cargo build in core/): the UI test's own agents, for real.
const program = ['release', 'debug'].map((kind) => path.resolve('..', 'core', 'target', kind, process.platform === 'win32' ? 'openpixel.exe' : 'openpixel')).find((p) => fs.existsSync(p));

test('spawnAgent starts the real `openpixel --mcp`, which introduces itself to this window', { skip: program === undefined || process.platform === 'win32' ? 'needs core/target/*/openpixel (cargo build)' : false }, async (t) => {
  const dir = tempFolder(t);
  const { host } = realHost(t, dir, program as string);
  await until(() => fs.existsSync(path.join(dir, 'op.sock')));
  const open = (): any[] => (host.agents.snapshot(false).sessions as any[]).filter((s) => s.open);
  assert.equal(await host.handle({ kind: 'spawnAgent', client: 'claude-code', call: false }), true);
  await until(() => open().length === 1 && open()[0].client === 'claude-code');
  assert.deepEqual([open()[0].agent, open()[0].transport, open()[0].version, open()[0].pid > 0], ['claude-code', 'stdio', '1.0', true]);
  assert.equal(await host.handle({ kind: 'spawnAgent', client: 'my-custom-agent' }), true);
  await until(() => open().length === 2);
  assert.equal(await host.handle({ kind: 'stopAgents' }), true);
  await until(() => open().length === 0);
  assert.deepEqual(Object.keys(host.agents.snapshot(false).last_seen as object).sort(), ['claude-code', 'my-custom-agent']);
});
