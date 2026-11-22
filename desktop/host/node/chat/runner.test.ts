/* The runner against stand-in tools (fake-tools.ts): finding them, what the model menu is told, the exact command
   line and environment each agent is started with, a run from start to "done", stopping one, runs that fail, and
   signing in. The real tools are not installed where this runs; what each really prints is in selftest.fixtures.ts. */
import assert from 'node:assert/strict';
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { FakeTools, Heard } from './fake-tools.ts';
import { createChatRunner } from './index.ts';
import { cases } from './selftest.fixtures.ts';
import { nodeFiles, put, timeline } from './test-support.ts';

// Stand-ins are scripts started through "#!": not on Windows, where the tools are .exe and .cmd (see launch.test.ts).
const skip = process.platform === 'win32';

const fake = new FakeTools();
const heard = new Heard();
const MCP = '/Apps/Open Pixel/openpixel'; // a space and slashes, to see them written correctly everywhere
const chat = createChatRunner({ mcpCommand: MCP, workDir: fake.workDir, emit: heard.emit, fs: nodeFiles });

const recorded = (provider: string, n = 0): string => {
  const c = cases.filter((x) => x.provider === provider)[n];
  if (!c) throw new Error(`no recorded stream ${n} for ${provider}`);
  return c.lines.trim() + '\n';
};
const inHome = (...parts: string[]): string => nodePath.join(fake.home, ...parts);
const read = (...parts: string[]): string => nodeFS.readFileSync(nodePath.join(fake.workDir, ...parts), 'utf8');
const SEARCH = `${fake.bin}:/usr/bin:/bin:`;

fake.install('claude', [{ stdout: recorded('claude-code') }]);
fake.install('codex', [{ stdout: recorded('codex') }]);
fake.install('cursor-agent', [
  { when: ['about'], stdout: '\u001B[1mAbout Cursor CLI\u001B[0m\n\nCLI Version         2026.01.23\nUser Email          me@example.com\n' },
  { when: ['models'], stdout: 'Available models\n\nauto - Auto\ngpt-5 - GPT-5  (current, default)\nsonnet-4.5 - Claude Sonnet - 4.5\n\nTip: use --model <id> to switch.\n' },
  { when: ['--help'], stdout: 'Options:\n  --trust   Trust the current folder\n' },
  { when: ['login'], exit: 0 },
  { stdout: recorded('cursor', 1) },
]);
fake.install('gemini', [
  { when: ['--list-models'], stdout: 'Loaded cached credentials.\n[{"modelId":"gemini-3-pro","displayName":"Gemini 3 Pro"},{"id":"flash"},{"modelId":""}]\n' },
  { stdout: recorded('gemini-cli') },
]);
fake.install('copilot', [{ when: ['login'], exit: 0 }, { stdout: recorded('copilot') }]);
fake.install('opencode', [
  { when: ['models'], stdout: 'opencode/big-pickle\nanthropic/claude-sonnet-5\nthis line is not a model\n' },
  { when: ['--version'], stdout: '2.1.0\n' },
  { stdout: recorded('opencode') },
]);
fake.install('goose', [{ stdout: recorded('goose') }]);
fake.install('cline', [{ stdout: recorded('cline') }]);
fake.install('hermes', [{ acp: true }]);
// Kiro is left out: an agent that is not installed.

put(inHome('.codex', 'models_cache.json'), JSON.stringify({ models: [
  { slug: 'gpt-b', display_name: 'GPT B', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }], default_reasoning_level: 'high' },
  { slug: 'gpt-hidden', visibility: 'hide', priority: 0 },
  { slug: 'gpt-a', priority: 1 },
  { slug: '', priority: 0 },
  { slug: 'gpt-c', display_name: 'GPT C', visibility: 'list' },
] }));
put(inHome('.codex', 'config.toml'), '# mine\nmodel = "gpt-b"\n\n[profiles.other]\nmodel = "not this one"\n');
put(inHome('.gemini', 'oauth_creds.json'), '{}');
put(inHome('.copilot', 'config.json'), '{"token": "…"}');
put(inHome('.cline', 'data', 'settings', 'providers.json'), '{}');
put(inHome('.hermes', 'config.yaml'), 'model:\n  default: "gpt-5.5" # the main one\n  provider: openai\ntools:\n  default: none\n');

const DEFAULT = { id: '', label: 'Default model' };
const row = (list: unknown[], id: string): unknown => list.find((p) => (p as { id: string }).id === id);

test('the model menu: every agent, what is installed, signed in and offered', { skip }, async () => {
  const list = await chat.providersForPage();
  assert.deepEqual(list.map((p) => (p as { id: string }).id),
    ['claude-code', 'codex', 'cursor', 'gemini-cli', 'copilot', 'opencode', 'kiro', 'goose', 'cline', 'hermes']);
  assert.deepEqual(row(list, 'claude-code'), {
    id: 'claude-code', name: 'Claude', plan: 'Claude subscription', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' }, { id: 'fable', label: 'Fable 5.2' }, { id: 'haiku', label: 'Haiku 5.5' }],
    default_model: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'medium',
  });
  // Codex: its own cache, hidden ones left out, in its order, each with its levels; the model its settings choose.
  assert.deepEqual(row(list, 'codex'), {
    id: 'codex', name: 'Codex', plan: 'ChatGPT subscription', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [{ id: 'gpt-a', label: 'gpt-a' }, { id: 'gpt-b', label: 'GPT B', efforts: ['low', 'high'], default_effort: 'high' }, { id: 'gpt-c', label: 'GPT C' }],
    default_model: 'gpt-b', efforts: ['low', 'medium', 'high'], default_effort: 'medium',
  });
  // Cursor: signed in (its "about" says who), the models its plan lists, the one marked default.
  assert.deepEqual(row(list, 'cursor'), {
    id: 'cursor', name: 'Cursor', plan: 'Cursor plan', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [{ id: '', label: 'Auto' }, { id: 'gpt-5', label: 'GPT-5' }, { id: 'sonnet-4.5', label: 'Claude Sonnet - 4.5' }],
    default_model: 'gpt-5', efforts: [], default_effort: '',
  });
  assert.deepEqual(row(list, 'gemini-cli'), {
    id: 'gemini-cli', name: 'Gemini CLI', plan: 'Google account', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [DEFAULT, { id: 'gemini-3-pro', label: 'Gemini 3 Pro' }, { id: 'flash', label: 'flash' }],
    default_model: '', efforts: [], default_effort: '',
  });
  assert.equal(fake.lastCall('gemini', '--list-models').env.NO_BROWSER, 'true');
  assert.deepEqual(row(list, 'copilot'), {
    id: 'copilot', name: 'GitHub Copilot', plan: 'Copilot subscription', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [DEFAULT], default_model: '', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default_effort: 'medium',
  });
  assert.deepEqual(row(list, 'opencode'), {
    id: 'opencode', name: 'opencode', plan: 'your opencode providers', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [DEFAULT, { id: 'opencode/big-pickle', label: 'opencode/big-pickle' }, { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5' }],
    default_model: '', efforts: [], default_effort: '',
  });
  // Goose is installed but has no provider chosen: it needs setting up and stays off the menu.
  assert.deepEqual(row(list, 'goose'), {
    id: 'goose', name: 'Goose', plan: 'your Goose provider', installed: true, ready: false, needs_setup: true, needs_login: false,
    models: [DEFAULT], default_model: '', efforts: [], default_effort: '',
  });
  assert.deepEqual(row(list, 'cline'), {
    id: 'cline', name: 'Cline', plan: 'your Cline account', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [DEFAULT], default_model: '', efforts: [], default_effort: '',
  });
  // Hermes: its menu entry is the model its settings name.
  assert.deepEqual(row(list, 'hermes'), {
    id: 'hermes', name: 'Hermes Agent', plan: 'your Hermes provider', installed: true, ready: true, needs_setup: false, needs_login: false,
    models: [{ id: '', label: 'gpt-5.5' }], default_model: '', efforts: [], default_effort: '',
  });
  const kiroHere = ['/usr/local/bin/kiro-cli', '/opt/homebrew/bin/kiro-cli', '/usr/bin/kiro-cli'].some((p) => nodeFS.existsSync(p));
  if (!kiroHere) {
    assert.deepEqual(row(list, 'kiro'), {
      id: 'kiro', name: 'Kiro', plan: 'Kiro subscription', installed: false, ready: false, needs_setup: false, needs_login: false,
      models: [DEFAULT], default_model: '', efforts: [], default_effort: '',
    });
    assert.equal(await chat.start({ chat: 'none', provider: 'kiro', prompt: 'Hi' }), "Kiro isn't installed on this Mac.");
  }
  // Tools are asked with the search path first and colours off.
  const about = fake.lastCall('cursor-agent', 'about');
  assert.ok(about.env.PATH?.startsWith(SEARCH), about.env.PATH);
  assert.deepEqual([about.env.NO_COLOR, about.env.TERM, about.env.FORCE_COLOR], ['1', 'dumb', '0']);
});

test('Claude: the command line, the events of a recorded run, and what it loaded is remembered', { skip }, async () => {
  const prompt = 'Draw a "heart"\nin $HOME; `ok` & done', system = 'You are in "Untitled 1".';
  assert.equal(await chat.start({ chat: 'c-claude', provider: 'claude-code', prompt, model: 'opus', effort: 'high', resume: null, system }), true);
  const id = 'toolu_01YbTBCLLFcqu2CCspKUWnVf', session = '17646487-af0c-4c6c-b565-9f36fbf0bd49';
  assert.deepEqual(await heard.done('c-claude'), [
    { t: 'session', session, model: 'claude-haiku-5-5', chat: 'c-claude' },
    { t: 'tool', id, name: 'get_model_info', chat: 'c-claude' },
    { t: 'tool_input', id, input: {}, chat: 'c-claude' },
    { t: 'tool_done', id, ok: true, out: '{\n  "active_frame" : 0,\n  "active_layer" : 0', chat: 'c-claude' },
    { t: 'text', d: 'I chec', chat: 'c-claude' },
    { t: 'text', d: 'ked the model', chat: 'c-claude' },
    { t: 'text', d: ' info.', chat: 'c-claude' },
    { t: 'done', ok: true, session, chat: 'c-claude' },
  ]);
  const call = fake.lastCall('claude');
  assert.deepEqual(call.args, [
    '-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--mcp-config', '{"mcpServers":{"openpixel":{"command":"\\/Apps\\/Open Pixel\\/openpixel","args":["--mcp"]}}}', '--strict-mcp-config',
    '--tools', 'Skill', 'Read', '--allowedTools', 'mcp__openpixel', 'Skill', 'Read', '--permission-prompts', 'none',
    '--model', 'opus', '--effort', 'high', '--append-system-prompt', system,
  ]);
  assert.equal(call.cwd, nodeFS.realpathSync(fake.workDir));
  assert.equal(call.stdin, 'null', 'no stdin: the tool must not wait for input');
  assert.ok(call.env.PATH?.startsWith(SEARCH));
  assert.equal(read('claude-init.json'), '{"slash_commands":["emil-design-eng"]}');

  // Continuing a session; an effort Claude does not have and an empty model are left out.
  assert.equal(await chat.start({ chat: 'c-claude', provider: 'claude-code', prompt: 'More', model: '', effort: 'ultra', resume: session, system: '' }), true);
  await heard.until((e) => e.chat === 'c-claude' && e.t === 'done' && heard.of('c-claude').filter((x) => x.t === 'done').length === 2);
  assert.deepEqual(fake.lastCall('claude').args.slice(18), ['--resume', session]);
});

test('Codex: settings on the command line, the system text in front of a first message only', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'c-codex', provider: 'codex', prompt: 'Hi', model: 'gpt-b', effort: 'ultra', system: 'S' }), true);
  assert.deepEqual(timeline(await heard.done('c-codex')), cases.filter((c) => c.provider === 'codex')[0]?.expect);
  const settings = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
                    '-c', 'mcp_servers={openpixel={command="/Apps/Open Pixel/openpixel",args=["--mcp"]}}'];
  assert.deepEqual(fake.lastCall('codex').args, ['exec', ...settings, '-m', 'gpt-b', '-c', 'model_reasoning_effort="ultra"', 'S\n\nHi']);
  assert.equal(heard.of('c-codex')[0]?.session, '01a1fb7a-69af-72b0-9d59-e1c54768d25f');

  assert.equal(await chat.start({ chat: 'c-codex-2', provider: 'codex', prompt: 'More', model: '', effort: 'x-high', resume: 't-1', system: 'S' }), true);
  await heard.done('c-codex-2');
  assert.deepEqual(fake.lastCall('codex').args, ['exec', 'resume', 't-1', ...settings, 'More']);
});

test('Cursor: its folder holds OpenPixel and the permission for its tools; repeated text is not doubled', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'c-cursor', provider: 'cursor', prompt: 'Hi', model: 'gpt-5', effort: '', system: 'S' }), true);
  assert.deepEqual(timeline(await heard.done('c-cursor')), cases.filter((c) => c.provider === 'cursor')[1]?.expect);
  assert.deepEqual(fake.lastCall('cursor-agent', '-p').args,
    ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps', '--trust', '--model', 'gpt-5', 'S\n\nHi']);
  assert.equal(read('.cursor', 'mcp.json'),
    '{\n  "mcpServers" : {\n    "openpixel" : {\n      "command" : "/Apps/Open Pixel/openpixel",\n      "args" : [\n        "--mcp"\n      ]\n    }\n  }\n}');
  assert.deepEqual(JSON.parse(read('.cursor', 'cli.json')), { permissions: { allow: ['Mcp(openpixel:*)'], deny: [] } });
  // The first call's input and a rejected call's reason, as the page shows them.
  const events = heard.of('c-cursor');
  assert.deepEqual(events.find((e) => e.t === 'tool_input'), { t: 'tool_input', id: 'C1', input: { x: 1, y: 2, color: '#ff0000' }, chat: 'c-cursor' });
  assert.deepEqual(events.filter((e) => e.t === 'tool_done').map((e) => [e.ok, e.out]),
    [[true, 'ok'], [false, 'bad'], [false, 'User rejected MCP: openpixel-clear']]);
  assert.deepEqual(events[events.length - 1], { t: 'done', ok: true, session: 'S', chat: 'c-cursor' });
});

test('Gemini: a trusted folder with OpenPixel, no browser, only OpenPixel allowed', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'c-gemini', provider: 'gemini-cli', prompt: 'Hi', model: 'flash', effort: '', resume: 'g-1', system: 'S' }), true);
  assert.deepEqual(timeline(await heard.done('c-gemini')), cases.filter((c) => c.provider === 'gemini-cli')[0]?.expect);
  const call = fake.lastCall('gemini', '-p');
  assert.deepEqual(call.args, ['-p', 'Hi', '--output-format', 'stream-json', '--allowed-mcp-server-names', 'openpixel', '-m', 'flash', '--resume', 'g-1']);
  assert.deepEqual([call.env.GEMINI_CLI_TRUST_WORKSPACE, call.env.NO_BROWSER], ['true', 'true']);
  assert.deepEqual(JSON.parse(read('.gemini', 'settings.json')), { mcpServers: { openpixel: { command: MCP, args: ['--mcp'] } } });
  // Other agents are not given Gemini's variables.
  assert.equal(fake.lastCall('claude').env.GEMINI_CLI_TRUST_WORKSPACE, undefined);
});

test('Copilot, opencode, Goose and Cline: how each is started and what each is given', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'c-copilot', provider: 'copilot', prompt: 'Hi', model: 'gpt-5', effort: 'xhigh', resume: 'cp-1', system: 'S' }), true);
  assert.deepEqual(timeline(await heard.done('c-copilot')), cases.filter((c) => c.provider === 'copilot')[0]?.expect);
  const file = nodePath.join(fake.workDir, 'copilot-mcp.json');
  assert.deepEqual(fake.lastCall('copilot').args, ['-p', 'Hi', '--output-format', 'json', '--no-auto-update', '--no-color', '--no-ask-user',
    '--additional-mcp-config', `@${file}`, '--allow-tool=openpixel', '--disable-builtin-mcps', '--model', 'gpt-5', '--effort', 'xhigh', '--resume=cp-1']);
  assert.equal(read('copilot-mcp.json'), '{"mcpServers":{"openpixel":{"type":"local","command":"/Apps/Open Pixel/openpixel","args":["--mcp"],"tools":["*"]}}}');
  assert.deepEqual(heard.of('c-copilot').map((e) => e.session).filter((s) => s !== undefined), ['<session-id>', '<session-id>']);

  // opencode 2: --standalone and the ordered permission rules.
  assert.equal(await chat.start({ chat: 'c-opencode', provider: 'opencode', prompt: 'Hi', model: 'opencode/big-pickle', effort: '', system: 'S' }), true);
  assert.deepEqual(timeline(await heard.done('c-opencode')), cases.filter((c) => c.provider === 'opencode')[0]?.expect);
  let call = fake.lastCall('opencode', 'run');
  assert.deepEqual(call.args, ['run', '--standalone', '--format', 'json', '--thinking', '-m', 'opencode/big-pickle', 'S\n\nHi']);
  assert.equal(call.env.OPENCODE_CONFIG_CONTENT, '{"mcp":{"servers":{"openpixel":{"type":"local","command":["/Apps/Open Pixel/openpixel","--mcp"],"codemode":false}}},'
    + '"permissions":[{"action":"*","resource":"*","effect":"deny"},{"action":"openpixel_*","resource":"*","effect":"allow"},{"action":"skill","resource":"*","effect":"allow"}]}');
  // opencode 1: its older settings, and continuing a session.
  fake.script('opencode', [{ when: ['--version'], stdout: 'opencode v1.14.3\n' }, { stdout: recorded('opencode') }]);
  assert.equal(await chat.start({ chat: 'c-opencode-1', provider: 'opencode', prompt: 'More', model: '', effort: '', resume: 'ses_1', system: 'S' }), true);
  await heard.done('c-opencode-1');
  call = fake.lastCall('opencode', 'run');
  assert.deepEqual(call.args, ['run', '--format', 'json', '--thinking', '-s', 'ses_1', 'More']);
  assert.equal(call.env.OPENCODE_CONFIG_CONTENT, '{"mcp":{"openpixel":{"type":"local","command":["/Apps/Open Pixel/openpixel","--mcp"],"enabled":true}},'
    + '"permission":{"*":"deny","openpixel_*":"allow","skill":"allow"}}');

  // Goose: the session is the chat's own name, since its stream never says one.
  assert.equal(await chat.start({ chat: 'c-goose', provider: 'goose', prompt: 'Hi', model: '', effort: '', system: 'S' }), true);
  const goose = await heard.done('c-goose');
  assert.deepEqual(timeline(goose), cases.filter((c) => c.provider === 'goose')[0]?.expect);
  assert.deepEqual(goose[0], { t: 'session', session: 'c-goose', chat: 'c-goose' });
  assert.deepEqual(goose[goose.length - 1], { t: 'done', ok: true, session: 'c-goose', chat: 'c-goose' });
  call = fake.lastCall('goose');
  assert.deepEqual(call.args, ['run', '-t', 'S\n\nHi', '--output-format', 'stream-json', '--with-extension', '"/Apps/Open Pixel/openpixel" --mcp', '--name', 'c-goose']);
  assert.equal(call.env.GOOSE_MODE, 'auto');
  assert.equal(await chat.start({ chat: 'c-goose-2', provider: 'goose', prompt: 'More', resume: 'c-goose', system: 'S' }), true);
  await heard.done('c-goose-2');
  assert.deepEqual(fake.lastCall('goose').args.slice(1, 3).concat(fake.lastCall('goose').args.slice(7)), ['-t', 'More', '--resume', '--name', 'c-goose']);

  // Cline cannot continue a session: it reports none, and "resume" changes nothing.
  assert.equal(await chat.start({ chat: 'c-cline', provider: 'cline', prompt: 'Hi', model: 'sonnet', effort: '', resume: 'ignored', system: 'S' }), true);
  const cline = await heard.done('c-cline');
  assert.deepEqual(timeline(cline), cases.filter((c) => c.provider === 'cline')[0]?.expect);
  assert.equal(cline.some((e) => e.t === 'session'), false);
  call = fake.lastCall('cline');
  assert.deepEqual(call.args, ['--json', '-m', 'sonnet', 'S\n\nHi']);
  assert.equal(call.env.CLINE_MCP_SETTINGS_PATH, nodePath.join(fake.workDir, 'cline-mcp.json'));
  assert.equal(read('cline-mcp.json'), '{"mcpServers":{"openpixel":{"type":"stdio","command":"/Apps/Open Pixel/openpixel","args":["--mcp"]}}}');
});

test('Hermes: the Agent Client Protocol over stdin, permission requests declined', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'c-hermes', provider: 'hermes', prompt: 'Hi', model: '', effort: '', resume: 'ignored', system: 'S' }), true);
  assert.deepEqual(await heard.done('c-hermes'), [
    { t: 'text', d: 'Heard: S\n\nHi', chat: 'c-hermes' },
    { t: 'done', ok: true, chat: 'c-hermes' },
  ]);
  const call = fake.lastCall('hermes');
  assert.deepEqual(call.args, ['acp']);
  assert.equal(call.stdin, 'pipe');
  assert.equal(call.env.HERMES_ACP_SKIP_CONFIGURED_MCP, '1');
  assert.deepEqual(fake.calls('hermes', 'acp.jsonl'), [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: fake.workDir, mcpServers: [{ name: 'openpixel', command: MCP, args: ['--mcp'], env: [] }] } },
    { jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'acp-session', prompt: [{ type: 'text', text: 'S\n\nHi' }] } },
    { jsonrpc: '2.0', id: 7, result: { outcome: { outcome: 'selected', optionId: 'no' } } },
    { jsonrpc: '2.0', id: 8, error: { code: -32601, message: 'Not supported by OpenPixel' } },
  ]);
});

test('output arrives in pieces: lines and characters broken across them, and a last line with no line break', { skip }, async () => {
  const lines = [
    '{"type":"system","subtype":"init","session_id":"s-9","model":"m"}\n',
    '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"16 × 16 ✓"}}}\n',
    'this line is not JSON\n',
    '{"type":"result","is_error":false,"session_id":"s-9"}', // no line break after the last line
  ];
  const bytes = Buffer.from(lines.join(''), 'utf8');
  const cut = bytes.indexOf(Buffer.from('×', 'utf8')) + 1; // between the two bytes of "×"
  fake.script('claude', [{ parts: [bytes.subarray(0, 10), bytes.subarray(10, cut), bytes.subarray(cut)].map((b) => b.toString('base64')) }]);
  assert.equal(await chat.start({ chat: 'c-pieces', provider: 'claude-code', prompt: 'Hi' }), true);
  assert.deepEqual(await heard.done('c-pieces'), [
    { t: 'session', session: 's-9', model: 'm', chat: 'c-pieces' },
    { t: 'text', d: '16 × 16 ✓', chat: 'c-pieces' },
    { t: 'done', ok: true, session: 's-9', chat: 'c-pieces' },
  ]);
});

test('stopping a run: asked politely first, then firmly; the page hears "stopped" once', { skip }, async () => {
  const init = '{"type":"system","subtype":"init","session_id":"s-stop","model":"m"}\n';
  fake.script('claude', [{ stdout: init, hang: true }]);
  assert.equal(await chat.start({ chat: 'c-stop', provider: 'claude-code', prompt: 'Hi' }), true);
  await heard.until((e) => e.chat === 'c-stop' && e.t === 'session');
  chat.stop('c-stop');
  assert.deepEqual(await heard.done('c-stop'), [
    { t: 'session', session: 's-stop', model: 'm', chat: 'c-stop' },
    { t: 'done', ok: false, stopped: true, chat: 'c-stop' },
  ]);
  chat.stop('c-stop');           // nothing is running any more: no second "done"
  chat.stop('no such chat');

  // A tool that ignores the first signal is ended a moment later.
  fake.script('claude', [{ stdout: init, hang: true, deaf: true }]);
  assert.equal(await chat.start({ chat: 'c-deaf', provider: 'claude-code', prompt: 'Hi' }), true);
  await heard.until((e) => e.chat === 'c-deaf' && e.t === 'session');
  const asked = Date.now();
  chat.stop('c-deaf');
  const events = await heard.done('c-deaf');
  assert.deepEqual(events[events.length - 1], { t: 'done', ok: false, stopped: true, chat: 'c-deaf' });
  assert.ok(Date.now() - asked >= 1400, 'the firm stop waits a second and a half');
  assert.equal(nodeFS.readFileSync(nodePath.join(fake.root, 'calls', 'claude.signals'), 'utf8'), 'SIGINT\n');

  // Sending again in a chat that is still answering stops the earlier run.
  fake.script('claude', [{ when: ['first'], stdout: init, hang: true }, { stdout: recorded('claude-code') }]);
  assert.equal(await chat.start({ chat: 'c-again', provider: 'claude-code', prompt: 'first' }), true);
  await heard.until((e) => e.chat === 'c-again' && e.t === 'session');
  assert.equal(await chat.start({ chat: 'c-again', provider: 'claude-code', prompt: 'second' }), true);
  await heard.until(() => heard.of('c-again').filter((e) => e.t === 'done').length === 2);
  assert.deepEqual(heard.of('c-again').filter((e) => e.t === 'done').map((e) => [e.ok, e.stopped]).sort(), [[false, true], [true, undefined]]);

  // Quitting the app ends every run; one ended that way did not finish its answer.
  fake.script('claude', [{ stdout: init, hang: true }]);
  assert.equal(await chat.start({ chat: 'c-quit', provider: 'claude-code', prompt: 'Hi' }), true);
  await heard.until((e) => e.chat === 'c-quit' && e.t === 'session');
  chat.stopAll();
  assert.deepEqual((await heard.done('c-quit')).slice(1), [
    { t: 'error', message: 'The agent quit (exit code 15).', chat: 'c-quit' },
    { t: 'done', ok: false, chat: 'c-quit' },
  ]);
});

test('runs that fail: what the tool wrote last is the error, said once', { skip }, async () => {
  // The last six lines of what it wrote, colours removed.
  fake.script('claude', [{ stderr: 'one\ntwo\n\u001B[31mthree\u001B[0m\nfour\nfive\nsix\nseven\n\n', exit: 3 }]);
  assert.equal(await chat.start({ chat: 'c-fail', provider: 'claude-code', prompt: 'Hi' }), true);
  assert.deepEqual(await heard.done('c-fail'), [
    { t: 'error', message: 'two\nthree\nfour\nfive\nsix\nseven', chat: 'c-fail' },
    { t: 'done', ok: false, chat: 'c-fail' },
  ]);
  // Nothing written: the exit code.
  fake.script('claude', [{ exit: 2 }]);
  assert.equal(await chat.start({ chat: 'c-fail-2', provider: 'claude-code', prompt: 'Hi' }), true);
  assert.deepEqual(await heard.done('c-fail-2'), [
    { t: 'error', message: 'The agent quit (exit code 2).', chat: 'c-fail-2' },
    { t: 'done', ok: false, chat: 'c-fail-2' },
  ]);
  // An error the stream already told is not repeated from what it wrote besides.
  fake.script('opencode', [{ when: ['--version'], stdout: '2.0.0\n' }, { stdout: recorded('opencode', 1), stderr: 'should not be shown twice\n', exit: 1 }]);
  assert.equal(await chat.start({ chat: 'c-fail-3', provider: 'opencode', prompt: 'Hi' }), true);
  assert.deepEqual(timeline(await heard.done('c-fail-3')), cases.filter((c) => c.provider === 'opencode')[1]?.expect);
  // A long error is cut at 1200 characters.
  fake.script('claude', [{ stderr: 'x'.repeat(1500) + '\n', exit: 1 }]);
  assert.equal(await chat.start({ chat: 'c-fail-4', provider: 'claude-code', prompt: 'Hi' }), true);
  assert.equal((await heard.done('c-fail-4'))[0]?.message, 'x'.repeat(1200) + '…');
  // Ending without a result and without an error still ends the answer.
  fake.script('claude', [{ stdout: '', exit: 0 }]);
  assert.equal(await chat.start({ chat: 'c-quiet', provider: 'claude-code', prompt: 'Hi' }), true);
  assert.deepEqual(await heard.done('c-quiet'), [{ t: 'done', ok: true, chat: 'c-quiet' }]);
  fake.script('claude', [{ stdout: recorded('claude-code') }]);
});

test('what cannot start says why', { skip }, async () => {
  assert.equal(await chat.start({ chat: 'x', provider: 'nobody', prompt: 'Hi' }), 'Unknown agent');
  assert.equal(await chat.start({ chat: 'x', prompt: 'Hi' }), 'Unknown agent');
  assert.equal(await chat.start({ chat: 'x', provider: 'codex', prompt: 'Hi', skill: 'no-such' }), 'Codex has no skill called “no-such”.');
  // A file that is there but is not a program.
  const broken = fake.install('cline', []);
  nodeFS.writeFileSync(broken, '#!/no/such/interpreter\n');
  const r = await chat.start({ chat: 'x', provider: 'cline', prompt: 'Hi' });
  assert.equal(typeof r === 'string' && r.startsWith("Couldn't start Cline: "), true, String(r));
  assert.deepEqual(heard.of('x'), []);
  fake.install('cline', [{ stdout: recorded('cline') }]);
});

test('needing to sign in: Cursor signed out offers its sign-in, which tells the page when it ends', { skip }, async () => {
  const rules = [
    { when: ['about'], stdout: 'About Cursor CLI\n\nUser Email          Not logged in\n' },
    { when: ['login'], exit: 0 },
    { stderr: "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.\n", exit: 1 },
  ];
  // A runner of its own: the first one remembers Cursor's models from when it was signed in.
  const mine = new Heard();
  const signedOut = createChatRunner({ mcpCommand: MCP, workDir: fake.workDir, emit: mine.emit, fs: nodeFiles });
  fake.script('cursor-agent', rules);
  assert.deepEqual(row(await signedOut.providersForPage(), 'cursor'), {
    id: 'cursor', name: 'Cursor', plan: 'Cursor plan', installed: true, ready: false, needs_setup: false, needs_login: true,
    models: [{ id: '', label: 'Auto' }], default_model: '', efforts: [], default_effort: '',
  });
  // Sending anyway: the tool's own complaint becomes what to do about it.
  assert.equal(await signedOut.start({ chat: 'c-out', provider: 'cursor', prompt: 'Hi' }), true);
  assert.deepEqual(await mine.done('c-out'), [
    { t: 'error', message: "Cursor's agent isn't signed in. Choose Sign in to Cursor… in the agent menu, then send again.", chat: 'c-out' },
    { t: 'done', ok: false, chat: 'c-out' },
  ]);
  // Copilot says so in its stream.
  fake.script('copilot', [{ stdout: recorded('copilot', 2), exit: 1 }]);
  assert.equal(await signedOut.start({ chat: 'c-out-2', provider: 'copilot', prompt: 'Hi' }), true);
  assert.deepEqual(timeline(await mine.done('c-out-2')), cases.filter((c) => c.provider === 'copilot')[2]?.expect);
  if (process.platform === 'linux') {
    // No token anywhere: Copilot offers its sign-in too (on a Mac the keychain is asked, which a test cannot empty).
    nodeFS.rmSync(inHome('.copilot', 'config.json'));
    const copilot = row(await signedOut.providersForPage(), 'copilot') as Record<string, unknown>;
    assert.deepEqual([copilot.ready, copilot.needs_login, copilot.models], [false, true, [DEFAULT]]);
    put(inHome('.copilot', 'config.json'), '{"token": "…"}');
  }

  assert.equal(signedOut.login('claude-code'), 'Nothing to sign in to.');
  assert.equal(signedOut.login('kiro'), 'Nothing to sign in to.');
  fake.forget('cursor-agent');
  process.env.NO_OPEN_BROWSER = '1';
  assert.equal(signedOut.login('cursor'), true);
  delete process.env.NO_OPEN_BROWSER;
  await mine.until((e) => e.t === 'providers');
  assert.deepEqual(mine.events.filter((e) => e.t === 'providers'), [{ t: 'providers' }]);
  const call = fake.lastCall('cursor-agent', 'login');
  assert.deepEqual(call.args, ['login']);
  assert.equal(call.env.NO_OPEN_BROWSER, undefined, 'the sign-in may open the browser');
  // Signed in now: the models are asked again.
  fake.script('cursor-agent', [
    { when: ['about'], stdout: 'User Email          me@example.com\n' },
    { when: ['models'], stdout: 'composer-2 - Composer 2 (default)\n' },
  ]);
  const cursor = row(await signedOut.providersForPage(), 'cursor') as Record<string, unknown>;
  assert.deepEqual([cursor.ready, cursor.needs_login, cursor.models, cursor.default_model],
    [true, false, [{ id: '', label: 'Auto' }, { id: 'composer-2', label: 'Composer 2' }], 'composer-2']);
});
