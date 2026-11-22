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
import { nodeFiles } from './test-support.ts';
import type { Dict } from './values.ts';
import { trimAll, trimSpaces } from './values.ts';

/** A short, comparable account of the events: "session", "text:<all text of a block>", "think",
    "tool <name>", "ok <name>" / "failed <name>", "error: <message>", "done" / "done failed". */
export function timeline(events: Dict[]): string[] {
  const out: string[] = [], names = new Map<string, string>();
  const text = (v: unknown, or: string): string => (typeof v === 'string' ? v : or);
  for (const e of events) {
    const last = out[out.length - 1];
    switch (text(e.t, '')) {
      case 'session': if (last !== 'session') out.push('session'); break;
      case 'text': {
        const d = text(e.d, '');
        if (last !== undefined && last.startsWith('text:')) out[out.length - 1] = last + d; else out.push('text:' + d);
        break;
      }
      case 'think': if (last !== 'think') out.push('think'); break;
      case 'tool': {
        const id = text(e.id, ''), name = text(e.name, '?');
        names.set(id, name);
        out.push(`tool ${name}`);
        break;
      }
      case 'tool_done': {
        const name = names.get(text(e.id, '')) ?? '(unknown call)';
        out.push(`${e.ok === true ? 'ok' : 'failed'} ${name}`);
        break;
      }
      case 'error': out.push(`error: ${text(e.message, '')}`); break;
      case 'done': out.push(e.ok === true ? 'done' : 'done failed'); break;
      default: break;
    }
  }
  return out.map((s) => (s.startsWith('text:') ? 'text:' + trimAll(s.slice(5)) : s));
}

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
