/* The "/" menu: which skills each agent has on this computer, and the message a picked one becomes. */
import assert from 'node:assert/strict';
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { FakeTools, Heard } from './fake-tools.ts';
import { createChatRunner } from './index.ts';
import { readSkillFile } from './skills.ts';
import { nodeFiles, put } from './test-support.ts';

const skip = process.platform === 'win32';
const fake = new FakeTools();
const heard = new Heard();
const chat = createChatRunner({ mcpCommand: '/bin/true', workDir: fake.workDir, emit: heard.emit, fs: nodeFiles });
const home = (...parts: string[]): string => nodePath.join(fake.home, ...parts);
const skill = (name: string, description: string, body = 'Do it.'): string => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
const names = async (provider: string): Promise<string[]> => (await chat.skillsForPage(provider)).map((s) => (s as { name: string }).name);

test('front matter: names, quoted and folded descriptions, and files without any', () => {
  const file = home('one.md');
  const read = (text: string): ReturnType<typeof readSkillFile> => { put(file, text); return readSkillFile(file); };
  assert.deepEqual(read('---\nname: "pixel-tips"\ndescription: \'Tips: for clean pixel art\'\nallowed-tools: Read\n---\nBody\n'),
    { name: 'pixel-tips', description: 'Tips: for clean pixel art', body: 'Body' });
  assert.deepEqual(read('---\ndescription: |\n  First line\n  second line\nname: x\n  not the description\n---\n\n\nBody\n\nmore\n\n'),
    { name: 'x', description: 'First line second line', body: 'Body\n\nmore' });
  assert.deepEqual(read('# Just a command\n\nRun the thing.\n'), { name: undefined, description: '', body: '# Just a command\n\nRun the thing.' });
  // No closing line: all of it is the body.
  assert.deepEqual(read('---\nname: x\nBody\n'), { name: undefined, description: '', body: '---\nname: x\nBody' });
  // Saved on Windows (CR LF): read the same.
  assert.deepEqual(read('---\r\nname: win\r\ndescription: >\r\n  Made on\r\n  Windows.\r\n---\r\n\r\nBody\r\nmore\r\n'),
    { name: 'win', description: 'Made on Windows.', body: 'Body\nmore' });
  // Too large to be a skill, or not text.
  put(file, 'x'.repeat(512_000));
  assert.equal(readSkillFile(file), null);
  nodeFS.writeFileSync(file, Buffer.from([0x2D, 0x2D, 0x2D, 0xFF, 0xFE]));
  assert.equal(readSkillFile(file), null);
  assert.equal(readSkillFile(home('missing.md')), null);
});

test('each agent\'s own folders, by name; the first of two with one name wins', { skip }, async () => {
  put(home('.codex', 'skills', 'zebra', 'SKILL.md'), skill('zebra', 'Stripes'));
  put(home('.codex', 'skills', 'folder-name', 'SKILL.md'), 'No front matter here.\n');
  put(home('.codex', 'skills', '.hidden', 'SKILL.md'), skill('hidden', 'Not listed'));
  put(home('.codex', 'skills', 'group', 'nested', 'SKILL.md'), skill('nested', 'Too deep for Codex'));
  put(home('.codex', 'prompts', 'Review.md'), 'Look at the whole sprite first.\nThen the details.\n');
  put(home('.codex', 'prompts', 'notes.txt'), 'not a command');
  put(home('.agents', 'skills', 'shared', 'SKILL.md'), skill('shared', 'For every agent'));
  put(home('.agents', 'skills', 'zebra', 'SKILL.md'), skill('zebra', 'A second zebra'));
  assert.deepEqual(await chat.skillsForPage('codex'), [
    { name: 'folder-name', description: '', source: 'Personal', command: false },
    { name: 'Review', description: 'Look at the whole sprite first.', source: 'Personal', command: true },
    { name: 'shared', description: 'For every agent', source: 'Personal', command: false },
    { name: 'zebra', description: 'Stripes', source: 'Personal', command: false },
  ]);

  put(home('.cursor', 'skills', 'c1', 'SKILL.md'), skill('c1', 'One'));
  put(home('.cursor', 'skills-cursor', 'c2', 'SKILL.md'), skill('c2', 'Two'));
  put(home('.cursor', 'commands', 'c3.md'), '---\ndescription: Three\n---\nBody\n');
  assert.deepEqual(await names('cursor'), ['c1', 'c2', 'c3', 'shared', 'zebra']);

  // Gemini: skills, and its commands in TOML, named by their folders.
  put(home('.gemini', 'skills', 'g1', 'SKILL.md'), skill('g1', 'One'));
  put(home('.gemini', 'commands', 'plan.toml'), 'description = "Plan the work"\nprompt = "Plan: {{args}}"\n');
  put(home('.gemini', 'commands', 'git', 'commit.toml'), 'prompt = "Commit"\n');
  assert.deepEqual((await chat.skillsForPage('gemini-cli')).slice(0, 3), [
    { name: 'g1', description: 'One', source: 'Personal', command: false },
    { name: 'git:commit', description: '', source: 'Personal', command: true },
    { name: 'plan', description: 'Plan the work', source: 'Personal', command: true },
  ]);

  put(home('.copilot', 'skills', 'cp', 'SKILL.md'), skill('cp', ''));
  put(home('.config', 'opencode', 'skills', 'oc', 'SKILL.md'), skill('oc', ''));
  put(home('.config', 'opencode', 'commands', 'occ.md'), 'Go.\n');
  put(home('.kiro', 'skills', 'k', 'SKILL.md'), skill('k', ''));
  put(home('.kiro', 'prompts', 'kp.md'), 'Go.\n');
  put(home('.config', 'goose', 'skills', 'gs', 'SKILL.md'), skill('gs', ''));
  put(home('.cline', 'skills', 'cl', 'SKILL.md'), skill('cl', ''));
  put(home('.hermes', 'skills', 'art', 'pixel', 'SKILL.md'), skill('pixel', ''));
  put(home('.hermes', 'skills', 'art', 'deep', 'deeper', 'SKILL.md'), skill('deeper', ''));
  assert.deepEqual(await names('copilot'), ['cp', 'shared', 'zebra']);
  assert.deepEqual(await names('opencode'), ['oc', 'occ', 'shared', 'zebra']);
  assert.deepEqual(await names('kiro'), ['k', 'kp']);
  assert.deepEqual(await names('goose'), ['gs', 'shared', 'zebra']);
  assert.deepEqual(await names('cline'), ['cl']);
  assert.deepEqual(await names('hermes'), ['pixel']);
  assert.deepEqual(await names('nobody'), []);
});

test('Claude: personal and synced skills, plugins, and only what Claude says it switched on', { skip }, async () => {
  put(home('.claude', 'skills', 'mine', 'SKILL.md'), skill('mine', 'Personal one'));
  put(home('.claude', 'skills', 'synced', 'anthropic', 'pdf', 'SKILL.md'), skill('pdf', 'Read PDFs'));
  put(home('.claude', 'skills', 'a', 'b', 'c', 'too-deep', 'SKILL.md'), skill('too-deep', 'Four levels down'));
  put(home('.claude', 'commands', 'ship.md'), 'Ship it.\n');
  const plugin = home('.claude', 'plugins', 'synced', 'market', 'art-pack');
  put(nodePath.join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"art"}');
  put(nodePath.join(plugin, 'skills', 'palette', 'SKILL.md'), skill('palette', 'Pick colours'));
  put(nodePath.join(plugin, 'commands', 'dither.md'), '---\ndescription: Dither it\n---\nGo.\n');
  put(home('.claude', 'plugins', 'synced', 'a', 'b', 'c', 'd', '.claude-plugin', 'plugin.json'), '{"name":"too-deep"}');
  // Before the first chat: everything on disk.
  assert.deepEqual(await chat.skillsForPage('claude-code'), [
    { name: 'art:dither', description: 'Dither it', source: 'art', command: true },
    { name: 'art:palette', description: 'Pick colours', source: 'art', command: false },
    { name: 'mine', description: 'Personal one', source: 'Personal', command: false },
    { name: 'pdf', description: 'Read PDFs', source: 'Personal', command: false },
    { name: 'ship', description: 'Ship it.', source: 'Personal', command: true },
  ]);

  // A chat starts: Claude says which commands it has and where its plugins are. That list now decides.
  const elsewhere = home('plugins-elsewhere', 'voxel');
  put(nodePath.join(elsewhere, 'skills', 'stack', 'SKILL.md'), skill('stack', 'Stack voxels'));
  fake.install('claude', [{ stdout: JSON.stringify({ type: 'system', subtype: 'init', session_id: 's', model: 'm',
    slash_commands: ['mine', 'anthropic-skills:pdf', 'voxel:stack', 'compact'], plugins: [{ name: 'voxel', path: elsewhere }, { name: 'no-path' }] }) + '\n' }]);
  assert.equal(await chat.start({ chat: 'c', provider: 'claude-code', prompt: 'Hi' }), true);
  await heard.done('c');
  assert.deepEqual(JSON.parse(nodeFS.readFileSync(nodePath.join(fake.workDir, 'claude-init.json'), 'utf8')),
    { slash_commands: ['mine', 'anthropic-skills:pdf', 'voxel:stack', 'compact'], plugins: [{ name: 'voxel', path: elsewhere }] });
  assert.deepEqual(await chat.skillsForPage('claude-code'), [
    // The synced skill under the name Claude gives it, so "/anthropic-skills:pdf" is one it knows.
    { name: 'anthropic-skills:pdf', description: 'Read PDFs', source: 'anthropic-skills', command: false },
    { name: 'mine', description: 'Personal one', source: 'Personal', command: false },
    { name: 'voxel:stack', description: 'Stack voxels', source: 'voxel', command: false },
  ]);
});

test('a picked skill: Claude and Gemini run their own; the others get its instructions first', { skip }, async () => {
  fake.install('claude', [{ stdout: '{"type":"result","is_error":false}\n' }]);
  fake.install('codex', [{ stdout: '{"type":"turn.completed"}\n' }]);
  fake.install('gemini', [{ stdout: '{"type":"result","status":"success"}\n' }]);
  const sent = async (body: Record<string, unknown>, tool: string): Promise<string[]> => {
    assert.equal(await chat.start({ chat: `s-${tool}`, ...body }), true);
    await heard.until((e) => e.chat === `s-${tool}` && e.t === 'done');
    heard.events.length = 0;
    return fake.lastCall(tool).args;
  };
  assert.equal((await sent({ provider: 'claude-code', prompt: 'the hero sprite', skill: 'mine' }, 'claude'))[1], '/mine the hero sprite');
  assert.equal((await sent({ provider: 'claude-code', prompt: '', skill: 'mine' }, 'claude'))[1], '/mine');
  assert.equal((await sent({ provider: 'gemini-cli', prompt: 'now', skill: 'git:commit' }, 'gemini'))[1], '/git:commit now');
  const file = home('.codex', 'skills', 'zebra', 'SKILL.md'), folder = nodePath.dirname(file);
  const withSkill = (request: string): string =>
    `Use the skill “zebra” for this request. Its instructions follow (from ${file}); files it mentions are in ${folder}.\n<skill name="zebra">\nDo it.\n</skill>\n\n${request}`;
  assert.equal((await sent({ provider: 'codex', prompt: 'the hero sprite', skill: 'zebra' }, 'codex')).pop(), withSkill('the hero sprite'));
  assert.equal((await sent({ provider: 'codex', prompt: '', skill: 'zebra' }, 'codex')).pop(), withSkill('(No further request: begin as the skill says.)'));
  // After another agent's turns the transcript has to come first, so Claude gets the instructions too.
  const mine = home('.claude', 'skills', 'mine', 'SKILL.md');
  assert.equal((await sent({ provider: 'claude-code', prompt: 'Earlier…\n\nNow:\n', skill: 'mine', transcript: true }, 'claude'))[1],
    `Use the skill “mine” for this request. Its instructions follow (from ${mine}); files it mentions are in ${nodePath.dirname(mine)}.\n<skill name="mine">\nDo it.\n</skill>\n\nEarlier…\n\nNow:\n`);
  assert.equal(await chat.start({ chat: 'x', provider: 'claude-code', prompt: '', skill: 'pdf' }), 'Claude has no skill called “pdf”.');
});
