/* Finding tools and starting them: the search order, the Mac apps' own copies, and on Windows how a .cmd file is
   started without cmd.exe reading the message (these checks are plain text work, so they run on every system). */
import assert from 'node:assert/strict';
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { FakeTools } from './fake-tools.ts';
import { claudeAppBinary, cmdArgument, parseCmdShim, Tools, windowsCommand } from './launch.ts';
import { provider } from './providers.ts';
import type { Provider } from './providers.ts';
import { cursorText, short, textOf, toolName } from './streams.ts';
import { put } from './test-support.ts';
import { bool, dicts, get, int, lines, nsJSON, pick, prefix, prettyJSON, trimAll, trimSpaces } from './values.ts';

const posix = process.platform !== 'win32';
const fake = new FakeTools();
const known = (id: string): Provider => {
  const p = provider(id);
  if (!p) throw new Error(id);
  return p;
};

test('the search path: the login shell\'s folders first, then the usual ones, each once', { skip: !posix }, async () => {
  const tools = new Tools();
  const dirs = (await tools.path()).split(':');
  assert.deepEqual(dirs.slice(0, 5), [fake.bin, '/usr/bin', '/bin', `${fake.home}/.local/bin`, `${fake.home}/.claude/local`]);
  assert.equal(new Set(dirs).size, dirs.length);
  assert.equal(tools.pathNow(), dirs.join(':'));
  assert.equal(new Tools().pathNow(), dirs.join(':'), 'asked in place, it is the same');
  // A shell that fails: the usual folders alone.
  const shell = process.env.SHELL;
  process.env.SHELL = nodePath.join(fake.root, 'no-such-shell');
  assert.equal((await new Tools().path()).split(':')[0], `${fake.home}/.local/bin`);
  process.env.SHELL = shell;
});

test('finding a tool: on the path, by either of its names, or inside an app', { skip: !posix }, async () => {
  const tools = new Tools();
  assert.equal(await tools.find(known('cursor')), null);
  const agent = fake.install('agent');
  assert.equal(await tools.find(known('cursor')), agent);
  const cursorAgent = fake.install('cursor-agent');
  assert.equal(await tools.find(known('cursor')), cursorAgent, 'the first name wins within a folder');
  assert.equal(tools.findNow(known('cursor')), cursorAgent);
  // Not a program (no permission to run), and a folder of that name: neither is the tool.
  put(nodePath.join(fake.bin, 'goose'), '#!/bin/sh\n', 0o644);
  nodeFS.mkdirSync(nodePath.join(fake.bin, 'cline'));
  assert.equal(await tools.find(known('goose')), null);
  assert.equal(await tools.find(known('cline')), null);
  // Tools kept in the home folder when they are not on the path.
  assert.equal(await tools.find(known('opencode')), null);
  const bundled = fake.install('opencode', [], nodePath.join(fake.home, '.opencode', 'bin', 'opencode'));
  assert.equal(await tools.find(known('opencode')), bundled);
  // The environment tools run with.
  const env = await tools.env();
  assert.deepEqual([env.PATH, env.NO_COLOR, env.TERM, env.FORCE_COLOR, env.HOME], [await tools.path(), '1', 'dumb', '0', fake.home]);
});

test('Claude from the Claude desktop app: the newest version that has a program', { skip: !posix }, async () => {
  const root = nodePath.join(fake.home, 'Library', 'Application Support', 'Claude', 'claude-code');
  assert.equal(claudeAppBinary(), null);
  fake.install('claude', [], nodePath.join(root, '2.9.0', 'claude'));
  const newer = fake.install('claude', [], nodePath.join(root, '2.10.1', 'build-7', 'claude.app', 'Contents', 'MacOS', 'claude'));
  nodeFS.mkdirSync(nodePath.join(root, '2.11.0'), { recursive: true });   // being downloaded: nothing in it yet
  nodeFS.mkdirSync(nodePath.join(root, 'staging'), { recursive: true });  // not a version
  assert.equal(claudeAppBinary(), newer);
  assert.equal(await new Tools().find(known('claude-code')), newer);
  const onPath = fake.install('claude');
  assert.equal(await new Tools().find(known('claude-code')), onPath, 'the command-line tool comes first');
});

test('short commands: what they print, or nothing when they fail or take too long', { skip: !posix }, async () => {
  const tools = new Tools();
  const tool = fake.install('gemini', [{ when: ['ok'], stdout: 'héllo\n', stderr: 'ignored\n' }, { when: ['bad'], stdout: 'partial', exit: 1 }, { when: ['slow'], stdout: 'late', hang: true }]);
  assert.equal(await tools.capture(tool, ['ok'], { timeout: 5 }), 'héllo\n');
  assert.equal(await tools.capture(tool, ['bad'], { timeout: 5 }), null);
  const before = Date.now();
  assert.equal(await tools.capture(tool, ['slow'], { timeout: 0.3 }), null);
  assert.ok(Date.now() - before < 3000);
  assert.equal(await tools.capture(nodePath.join(fake.bin, 'missing'), [], { timeout: 5 }), null);
});

// MARK: - Windows

const NPM_SHIM = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', 'SETLOCAL', 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*', '',
].join('\r\n');
const OLD_NPM_SHIM = [
  '@IF EXIST "%~dp0\\node.exe" (', '  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*', ') ELSE (',
  '  @SETLOCAL', '  @SET PATHEXT=%PATHEXT:;.JS;=;%', '  node  "%~dp0\\node_modules\\@google\\gemini-cli\\dist\\index.js" %*', ')',
].join('\r\n');

test('Windows: an npm command file names the script it runs', () => {
  assert.deepEqual(parseCmdShim(NPM_SHIM), { node: true, target: 'node_modules\\@openai\\codex\\bin\\codex.js' });
  assert.deepEqual(parseCmdShim(OLD_NPM_SHIM), { node: true, target: 'node_modules\\@google\\gemini-cli\\dist\\index.js' });
  assert.deepEqual(parseCmdShim('@ECHO off\r\n"%~dp0\\node_modules\\tool\\bin\\tool.exe"   %*\r\n'), { node: false, target: 'node_modules\\tool\\bin\\tool.exe' });
  // Anything else is not taken apart: another interpreter, settings of its own, two different scripts, no script.
  assert.equal(parseCmdShim('@"%~dp0\\python.exe" "%~dp0\\tool.py" %*\r\n'), null);
  assert.equal(parseCmdShim('@SET NODE_PATH=C:\\x\r\n@"%~dp0\\node.exe" "%~dp0\\tool.js" %*\r\n'), null);
  assert.equal(parseCmdShim(NPM_SHIM.replace('SET "_prog=node"', 'SET "_prog=bun"')), null);
  assert.equal(parseCmdShim('node "%~dp0\\a.js" %*\r\nnode "%~dp0\\b.js" %*\r\n'), null);
  assert.equal(parseCmdShim('@echo off\r\necho hello %*\r\n'), null);
});

test('Windows: tools start without cmd.exe reading the message', () => {
  const message = 'Draw a "heart" & more\n100% | done ^_^';
  const files = new Map([['C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', NPM_SHIM], ['C:\\tools\\odd.cmd', '@echo off\r\ncall other %*\r\n'],
                         ['C:\\tools\\gemini.cmd', OLD_NPM_SHIM]]);
  const scripts = new Set(['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js',
                           'C:\\tools\\node_modules\\@google\\gemini-cli\\dist\\index.js', 'C:\\tools\\node.exe']);
  const disk = { read: (p: string) => files.get(p) ?? null, isFile: (p: string) => scripts.has(p), findNode: () => 'C:\\Program Files\\nodejs\\node.exe' };
  // A program: started as it is, the arguments as a list.
  assert.deepEqual(windowsCommand('C:\\Users\\me\\.local\\bin\\claude.exe', ['-p', message], disk),
    { file: 'C:\\Users\\me\\.local\\bin\\claude.exe', args: ['-p', message], verbatim: false });
  // npm's command file: node runs its script directly (node from the PATH, or the one beside the file).
  assert.deepEqual(windowsCommand('C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd', ['exec', message], disk),
    { file: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'exec', message], verbatim: false });
  assert.deepEqual(windowsCommand('C:\\tools\\gemini.cmd', ['-p', message], disk),
    { file: 'C:\\tools\\node.exe', args: ['C:\\tools\\node_modules\\@google\\gemini-cli\\dist\\index.js', '-p', message], verbatim: false });
  // Another kind of command file has to go through cmd.exe: every argument escaped, and no line breaks.
  assert.deepEqual(windowsCommand('C:\\tools\\odd.cmd', ['about'], disk, 'C:\\Windows\\cmd.exe'),
    { file: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', '"C:\\tools\\odd.cmd ^^^"about^^^""'], verbatim: true });
  assert.throws(() => windowsCommand('C:\\tools\\odd.cmd', ['-p', message], disk), /line breaks/);
  // No node anywhere: the command file is left to say so itself.
  const noNode = { ...disk, isFile: (p: string) => p.endsWith('.js'), findNode: () => null };
  assert.equal(windowsCommand('C:\\tools\\gemini.cmd', ['--version'], noNode).verbatim, true);
});

test('Windows: an argument written for cmd.exe cannot break out of its quotes', () => {
  // Quoted for the program (a quote becomes \", backslashes before one are doubled), then every character cmd.exe
  // acts on gets ^ twice over: once for cmd.exe, once for the batch file passing it on.
  assert.equal(cmdArgument('plain'), '^^^"plain^^^"');
  assert.equal(cmdArgument(''), '^^^"^^^"');
  assert.equal(cmdArgument('a b'), '^^^"a^^^ b^^^"');
  assert.equal(cmdArgument('say "hi"'), '^^^"say^^^ \\^^^"hi\\^^^"^^^"');
  assert.equal(cmdArgument('C:\\dir\\'), '^^^"C:\\dir\\\\^^^"');
  assert.equal(cmdArgument('a\\"b'), '^^^"a\\\\\\^^^"b^^^"');
  assert.equal(cmdArgument('x & del *'), '^^^"x^^^ ^^^&^^^ del^^^ ^^^*^^^"');
  assert.equal(cmdArgument('%PATH%'), '^^^"^^^%PATH^^^%^^^"');
  // Undoing one layer of ^ (what cmd.exe does on each reading) twice leaves the quoted argument and nothing loose.
  const read = (s: string): string => s.replace(/\^(.)/g, '$1');
  for (const arg of ['x" & calc & "y', 'a|b>c<d', '(1) [2] !v! `q` ^', 'tab,semi;colon']) {
    const once = read(cmdArgument(arg));
    assert.equal(/(^|[^^])[&|<>]/.test(once), false, `after one reading nothing is loose in ${once}`);
    assert.equal(read(once), `"${arg.replace(/(\\*)"/g, '$1$1\\"')}"`);
  }
});

// MARK: - values, as the Swift app read and wrote them

test('values: casts, trimming, counting characters, and JSON as Foundation wrote it', () => {
  const o = JSON.parse('{"a":null,"b":"x","n":3,"f":1.5,"t":true,"one":1,"list":[{"k":1},"s"],"constructor":"mine"}') as Record<string, unknown>;
  assert.equal(get(o, 'a'), null);
  assert.equal(get(o, 'missing'), undefined);
  assert.equal(get({}, 'constructor'), undefined, 'only its own keys');
  assert.equal(get(o, 'constructor'), 'mine');
  assert.equal(pick(o, 'a', 'b'), null, 'a key that is there wins even when it is null');
  assert.equal(pick(o, 'zz', 'b'), 'x');
  assert.deepEqual([int(o.n), int(o.f), int(o.b), bool(o.t), bool(o.one), bool(o.n), bool(o.b)], [3, undefined, undefined, true, true, undefined, undefined]);
  assert.equal(dicts(o.list), undefined, 'one item that is not an object and the list is not a list of objects');
  assert.deepEqual(dicts([]), []);

  assert.equal(trimSpaces(' \t\u00A0x y\u3000 '), 'x y');
  assert.equal(trimSpaces('x\n'), 'x\n', 'line breaks are not spaces');
  assert.equal(trimAll('\n\r\u0085\u2028 x \t\n'), 'x');
  assert.equal(trimAll('\uFEFFx'), '\uFEFFx');
  assert.deepEqual(lines('a\r\nb\n\n\nc\u2028d\re'), ['a', 'b', 'c', 'd', 'e']);

  assert.equal(prefix('héllo', 2), 'hé');
  assert.equal(prefix('👩‍👩‍👧‍👦👍🏽e\u0301x', 3), '👩‍👩‍👧‍👦👍🏽e\u0301', 'a family, a thumb and an accented letter are three characters');
  assert.equal(short('abc', 3), 'abc');
  assert.equal(short('abcd', 3), 'abc…');
  assert.equal(short('🙂'.repeat(4000)), '🙂'.repeat(4000));
  assert.equal(short('🙂'.repeat(4001)), '🙂'.repeat(4000) + '…');

  assert.equal(nsJSON({ path: '/a/b', q: '"' }), '{"path":"\\/a\\/b","q":"\\""}');
  assert.equal(prettyJSON({ a: { b: [1, 'x/y'], c: [], d: {} }, e: null }),
    '{\n  "a" : {\n    "b" : [\n      1,\n      "x/y"\n    ],\n    "c" : [\n\n    ],\n    "d" : {\n\n    }\n  },\n  "e" : null\n}');
});

test('tool names and results, whatever shape the agent gives them', () => {
  assert.deepEqual(['mcp__openpixel__set_pixels', 'mcp_openpixel_set_pixels', 'openpixel__set_pixels', '@openpixel/set_pixels', 'openpixel/set_pixels',
                    'openpixel.set_pixels', 'openpixel_set_pixels', 'openpixel-set_pixels', 'shell', 'mcp__other__x'].map(toolName),
    [...Array<string>(8).fill('set_pixels'), 'shell', 'mcp__other__x']);
  assert.equal(textOf('plain'), 'plain');
  assert.equal(textOf({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: '…' }, { type: 'other' }, { type: 'text', text: 'b' }] }), 'a\n[image]\nb');
  assert.equal(textOf({ content: { content: 'nested' } }), 'nested');
  assert.equal(textOf([]), '');
  assert.equal(textOf(['a', 'b']), '["a","b"]');
  assert.equal(textOf({ path: '/x/y', lines: 3 }), '{"path":"\\/x\\/y","lines":3}');
  for (const v of [null, undefined, 7, true, { content: null }]) assert.equal(textOf(v), '');
  assert.equal(cursorText({ content: [{ text: { text: 'ok' } }, { text: 'plain' }, { image: {} }, { other: 1 }], isError: false }), 'ok\nplain\n[image]');
  assert.equal(cursorText({ reason: 'User rejected', isReadonly: false }), 'User rejected');
  assert.equal(cursorText({ error: '', stderr: 'boom' }), 'boom');
  assert.equal(cursorText({ linesCreated: 19 }), '{"linesCreated":19}');
  assert.equal(cursorText('text'), 'text');
});
