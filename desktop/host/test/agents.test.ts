// The Agents page's data (host/agents.ts): who is connected, who was, and which agent apps are set up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentRegistry, KNOWN, agentID, detectSetup, homePath } from '../agents';
import { memoryPlatform } from './fakes';

const DATA = '/home/me/.local/share/OpenPixel';

test('client names from the MCP handshake map to the known agents', () => {
  const cases: [string, string | null][] = [
    ['claude-code', 'claude-code'], ['Claude Code', 'claude-code'], ['claude-ai', 'claude'], ['cursor-vscode', 'cursor'], ['codex-mcp-client', 'codex'],
    ['mcporter', 'openclaw'], ['clawdbot', 'openclaw'], ['hermes-agent', 'hermes'], ['Cline', 'cline'], ['codeium', 'windsurf'], ['gemini-cli-mcp-client', 'gemini-cli'],
    ['Kiro', 'kiro'], ['opencode', 'opencode'], ['goose', 'goose'], ['LM Studio', 'lm-studio'], ['Visual Studio Code', 'copilot'], ['github-copilot', 'copilot'],
    ['openai-mcp', 'chatgpt'], ['ChatGPT', 'chatgpt'], ['my-custom-agent', null], ['', null],
  ];
  for (const [client, id] of cases) assert.equal(agentID(client), id, client);
  assert.deepEqual(KNOWN.map((k) => k.id), ['chatgpt', 'codex', 'claude', 'claude-code', 'cursor', 'openclaw', 'hermes', 'copilot', 'windsurf', 'gemini-cli', 'cline', 'kiro', 'opencode', 'goose', 'lm-studio']);
});

test('sessions: opened, introduced, counted, closed, and the snapshot the page reads', () => {
  const p = memoryPlatform();
  p.fs.createDirAll(DATA);
  const r = new AgentRegistry(p, DATA);
  assert.deepEqual(r.snapshot(false), { sessions: [], last_seen: {} });

  r.opened(1);
  assert.deepEqual(r.snapshot(false).sessions, [{ id: 1, client: 'unknown', version: '', transport: 'stdio', pid: 0, agent: null, connected: p.clock.now, calls: 0, last_tool: '', open: true }]);
  assert.equal(p.fs.exists(`${DATA}/agents.json`), false, 'an agent that has not said who it is leaves no trace');
  p.clock.now += 1;
  r.hello(1, { name: 'claude-code', version: '2.1.0', pid: 4242, transport: 'stdio' });
  r.hello(99, { name: 'ghost' });
  p.clock.now += 1;
  r.opened(2);
  r.hello(2, { name: '', pid: 'x', transport: 'http' });
  r.called(2, 'get_model_info');
  p.clock.now += 1;
  r.opened(3);
  r.hello(3, { name: 'my-custom-agent' });
  r.called(1, 'set_pixels');
  r.called(1, 'review_model');
  r.called(77, 'nothing');
  const t = p.clock.now;
  assert.deepEqual(r.snapshot(false), {
    sessions: [
      { id: 3, client: 'my-custom-agent', version: '', transport: 'stdio', pid: 0, agent: null, connected: t, calls: 0, last_tool: '', open: true },
      { id: 2, client: 'unknown', version: '', transport: 'http', pid: 0, agent: null, connected: t - 1, calls: 1, last_tool: 'get_model_info', open: true, last_call: t - 1 },
      { id: 1, client: 'claude-code', version: '2.1.0', transport: 'stdio', pid: 4242, agent: 'claude-code', connected: t - 3, calls: 2, last_tool: 'review_model', open: true, last_call: t },
    ],
    last_seen: { 'claude-code': t, 'my-custom-agent': t },
  });

  p.clock.now += 10;
  r.closed(1);
  r.closed(55);
  const closed = r.snapshot(false).sessions as Record<string, unknown>[];
  assert.deepEqual([closed[2]?.open, closed[2]?.closed], [false, p.clock.now]);
  // Last seen is kept between launches, under the agent's id when it is a known one.
  assert.deepEqual(JSON.parse(p.fs.readText(`${DATA}/agents.json`)), { 'claude-code': p.clock.now, 'my-custom-agent': t });
  assert.deepEqual(new AgentRegistry(p, DATA).snapshot(false).last_seen, { 'claude-code': p.clock.now, 'my-custom-agent': t });
  p.fs.write(`${DATA}/agents.json`, '{"claude":"yesterday"}');
  assert.deepEqual(new AgentRegistry(p, DATA).snapshot(false).last_seen, {});
});

test('only the 20 most recent closed sessions are kept', () => {
  const p = memoryPlatform();
  const r = new AgentRegistry(p, DATA);
  for (let id = 1; id <= 25; id += 1) {
    r.opened(id);
    p.clock.now += 1;
    if (id !== 3) r.closed(id);
  }
  const ids = (r.snapshot(false).sessions as { id: number; open: boolean }[]).map((s) => s.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
});

test('set-up detection reads settings files and looks for the tools; it never writes', () => {
  const p = memoryPlatform();
  const fs = p.fs;
  const files = new Map(fs.files);
  let setup = detectSetup(p) as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(setup), KNOWN.map((k) => k.id));
  assert.deepEqual(setup['claude-code'], { installed: false, configured: false, config_file: '~/.claude.json', config_exists: false });
  assert.deepEqual(setup.chatgpt, { installed: false, configured: false, config_file: null, config_exists: false });
  assert.deepEqual(setup.claude?.config_file, '~/.config/Claude/claude_desktop_config.json', 'the Mac’s Application Support is ~/.config on Linux');

  fs.createDirAll('/home/me/.claude');
  fs.write('/home/me/.claude.json', '{"mcpServers":{}}');
  fs.write('/home/me/.claude/settings.json', '{"mcpServers":{"OpenPixel":{"command":"openpixel","args":["--mcp"]}}}');
  fs.createDirAll('/home/me/.cursor');
  fs.write('/home/me/.cursor/mcp.json', '{}');
  fs.createDirAll('/home/me/.local/bin');
  fs.write('/home/me/.local/bin/codex', '#!/bin/sh');
  fs.createDirAll('/home/me/.npm-global/bin/gemini');
  fs.createDirAll('/Applications/ChatGPT.app');
  fs.createDirAll('/home/me/.config/Code/User/globalStorage/saoudrizwan.claude-dev');
  const before = new Map(fs.files);
  setup = detectSetup(p) as Record<string, Record<string, unknown>>;
  assert.deepEqual(setup['claude-code'], { installed: true, configured: true, config_file: '~/.claude/settings.json', config_exists: true });
  assert.deepEqual(setup.cursor, { installed: true, configured: false, config_file: '~/.cursor/mcp.json', config_exists: true });
  assert.deepEqual(setup.codex, { installed: true, configured: false, config_file: '~/.codex/config.toml', config_exists: false });
  assert.equal(setup['gemini-cli']?.installed, false, 'a folder with the tool’s name is not the tool');
  assert.equal(setup.chatgpt?.installed, true);
  assert.equal(setup.cline?.installed, true);
  assert.deepEqual([...fs.files.keys()], [...before.keys()]);
  assert.ok(files.size < before.size);

  // The same list on the other systems: where apps keep settings, and how a tool is started.
  const mac = memoryPlatform({ os: 'darwin' });
  assert.equal(homePath(mac, 'Library/Application Support/Claude/claude_desktop_config.json'), '/home/me/Library/Application Support/Claude/claude_desktop_config.json');
  const win = memoryPlatform({ os: 'win32' });
  assert.equal(homePath(win, 'Library/Application Support/Code/User/mcp.json'), '/home/me/.local/share/Code/User/mcp.json', 'next to OpenPixel’s own data folder (%APPDATA%)');
  win.fs.createDirAll('/home/me/.local/share/npm');
  win.fs.write('/home/me/.local/share/npm/claude.cmd', '@echo off');
  assert.equal((detectSetup(win) as Record<string, Record<string, unknown>>)['claude-code']?.installed, true);
});
