/* The Agent Chat part of the Mac app's `OpenPixel --selftest` (ChatSelfTest.swift): replays each agent's own output
   through the parser the chat uses and checks what the page would show: the session, the reply text (once, not
   doubled), every tool call with the right result (a call that worked must never show as failed, a failed one must),
   errors, and the end of the run. The streams are in selftest.fixtures.ts. */
import assert from 'node:assert/strict';
import * as nodeFS from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { replay } from './runner.ts';
import { cases } from './selftest.fixtures.ts';
import { readSkillFile } from './skills.ts';
import { tomlString } from './streams.ts';
import { nodeFiles, timeline } from './test-support.ts';
import { trimSpaces } from './values.ts';

assert.equal(cases.length, 24, 'every case of ChatSelfTest.swift is here');

for (const c of cases) {
  test(`agent chat · ${c.provider} · ${c.name}`, () => {
    const lines = c.lines.split('\n').filter((l) => trimSpaces(l) !== '');
    const events = replay(nodeFiles, c.provider, lines, c.exitStatus ?? 0, c.stderr ?? '');
    assert.deepEqual(timeline(events), c.expect);
    for (const e of events) assert.equal(e.chat, 't', 'every event names its chat');
  });
}

test('agent chat · skills · front matter and body are read', () => {
  // Skill files: front matter is read, the body is what other agents get.
  const tmp = nodePath.join(os.tmpdir(), `openpixel-skill-${process.pid}.md`);
  nodeFS.writeFileSync(tmp, '---\nname: pixel-tips\ndescription: >\n  Tips for clean\n  pixel art.\n---\n\n# Do this\nUse ramps.\n');
  try {
    assert.deepEqual(readSkillFile(tmp), { name: 'pixel-tips', description: 'Tips for clean pixel art.', body: '# Do this\nUse ramps.' });
  } finally { nodeFS.rmSync(tmp, { force: true }); }
});

test('agent chat · codex · paths are written as TOML strings', () => {
  assert.equal(tomlString('/Users/a b/O"P\\x'), String.raw`"/Users/a b/O\"P\\x"`);
});
