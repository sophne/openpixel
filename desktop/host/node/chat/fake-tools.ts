/* For the tests only: stand-ins for the agents' command-line tools. Each is a small Node script on a PATH of its
   own (found through a stand-in login shell), which writes down how it was called and then acts out a scenario the
   test gave it: prints recorded output, fails, hangs until stopped, or speaks ACP over stdin. The real tools are not
   installed where the tests run. */
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { put, tempFolder } from './test-support.ts';

/** What a stand-in does when its arguments include every word of `when` (the first such rule wins). */
export interface Rule {
  when?: string[];
  stdout?: string;
  /** Output as separate writes, 40 ms apart, each base64 (to break a line, or a character, in two). */
  parts?: string[];
  stderr?: string;
  exit?: number;
  /** Stay alive until stopped. `deaf`: ignore the polite stop (SIGINT) and write a mark when it comes. */
  hang?: boolean;
  deaf?: boolean;
  /** Answer the Agent Client Protocol on stdin/stdout as Hermes does. */
  acp?: boolean;
}

export interface Call { args: string[]; cwd: string; env: Record<string, string>; stdin: string }

// The stand-in itself. Kept free of anything but Node's own modules: it runs as its own program.
const SCRIPT = String.raw`
const fs = require('fs'), path = require('path');
const root = process.env.OPENPIXEL_FAKE_ROOT, name = path.basename(process.argv[1]), args = process.argv.slice(2);
const rules = JSON.parse(fs.readFileSync(path.join(root, 'scenario', name + '.json'), 'utf8'));
const rule = rules.find((r) => (r.when || []).every((w) => args.includes(w))) || {};
const st = fs.fstatSync(0); // Node hands a child its stdin as a socket pair
const stdin = process.stdin.isTTY ? 'tty' : st.isFIFO() || st.isSocket() ? 'pipe' : st.isCharacterDevice() ? 'null' : 'other';
fs.appendFileSync(path.join(root, 'calls', name + '.jsonl'), JSON.stringify({ args, cwd: process.cwd(), env: process.env, stdin }) + '\n');
if (rule.stderr) process.stderr.write(rule.stderr);
if (rule.stdout) process.stdout.write(rule.stdout);
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (rule.acp) {
  let buffer = '';
  process.stdin.on('data', (d) => {
    buffer += d;
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const m = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      fs.appendFileSync(path.join(root, 'calls', name + '.acp.jsonl'), JSON.stringify(m) + '\n');
      if (m.method === 'initialize') say({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1 } });
      if (m.method === 'session/new') say({ jsonrpc: '2.0', id: m.id, result: { sessionId: 'acp-session' } });
      if (m.method === 'session/prompt') {
        say({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'acp-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Heard: ' + m.params.prompt[0].text } } } });
        say({ jsonrpc: '2.0', id: 7, method: 'session/request_permission', params: { options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
        say({ jsonrpc: '2.0', id: 8, method: 'fs/read_text_file', params: {} });
      }
      // Once both of its own requests are answered, the turn ends.
      if (m.id === 8 && !m.method) say({ jsonrpc: '2.0', id: 3, result: { stopReason: 'end_turn' } });
    }
  });
  process.stdin.on('end', () => process.exit(0));
} else if (rule.parts) {
  let i = 0;
  const next = () => {
    if (i < rule.parts.length) { process.stdout.write(Buffer.from(rule.parts[i++], 'base64')); setTimeout(next, 40); }
    else process.exit(rule.exit || 0);
  };
  next();
} else if (rule.hang) {
  process.on('SIGINT', () => {
    if (rule.deaf) fs.appendFileSync(path.join(root, 'calls', name + '.signals'), 'SIGINT\n'); else process.exit(130);
  });
  setInterval(() => {}, 1000);
} else {
  process.exitCode = rule.exit || 0;
}
`;

/** A folder with its own home, tools and data, and the environment pointed at it. */
export class FakeTools {
  readonly root = tempFolder('chat');
  readonly home = nodePath.join(this.root, 'home');
  readonly bin = nodePath.join(this.root, 'bin');
  readonly workDir = nodePath.join(this.root, 'data', 'Chat');

  constructor() {
    for (const d of [this.home, this.bin, nodePath.join(this.root, 'calls'), nodePath.join(this.root, 'scenario')]) {
      nodeFS.mkdirSync(d, { recursive: true });
    }
    // The "login shell": says where the tools are, whatever it is asked.
    const shell = nodePath.join(this.root, 'shell');
    put(shell, `#!/bin/sh\nprintf %s "${this.bin}:/usr/bin:/bin"\n`, 0o755);
    process.env.SHELL = shell;
    process.env.HOME = this.home;
    process.env.USERPROFILE = this.home;
    process.env.OPENPIXEL_FAKE_ROOT = this.root;
    for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'NO_OPEN_BROWSER']) delete process.env[k];
  }

  /** Puts a stand-in for `name` on the PATH (or at `path`) and says what it does. */
  install(name: string, rules: Rule[] = [], path = nodePath.join(this.bin, name)): string {
    put(path, `#!${process.execPath}\n${SCRIPT}`, 0o755);
    this.script(name, rules);
    return path;
  }

  /** Changes what an installed stand-in does. */
  script(name: string, rules: Rule[]): void {
    put(nodePath.join(this.root, 'scenario', `${name}.json`), JSON.stringify(rules));
  }

  /** How `name` was called so far, oldest first. */
  calls(name: string, kind = 'jsonl'): Call[] {
    let text: string;
    try { text = nodeFS.readFileSync(nodePath.join(this.root, 'calls', `${name}.${kind}`), 'utf8'); } catch { return []; }
    return text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Call);
  }

  /** The last call whose arguments include `word` (all calls when no word is given). */
  lastCall(name: string, word?: string): Call {
    const all = this.calls(name).filter((c) => word === undefined || c.args.includes(word));
    const last = all[all.length - 1];
    if (!last) throw new Error(`${name} was not called${word === undefined ? '' : ` with ${word}`}`);
    return last;
  }

  forget(name: string): void {
    nodeFS.rmSync(nodePath.join(this.root, 'calls', `${name}.jsonl`), { force: true });
  }
}

/** The events a runner sent, and a way to wait for one. */
export class Heard {
  readonly events: Record<string, unknown>[] = [];
  private waiting: (() => void)[] = [];

  emit = (e: unknown): void => {
    this.events.push(e as Record<string, unknown>);
    for (const w of this.waiting.splice(0)) w();
  };

  /** Resolves with the events of `chat` once its "done" has arrived (or any event matching `until`). */
  async until(match: (e: Record<string, unknown>) => boolean, ms = 8000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!this.events.some(match)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out; heard ${JSON.stringify(this.events)}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiting.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }

  async done(chat: string, ms?: number): Promise<Record<string, unknown>[]> {
    await this.until((e) => e.chat === chat && e.t === 'done', ms);
    return this.of(chat);
  }

  of(chat: string): Record<string, unknown>[] { return this.events.filter((e) => e.chat === chat); }
}
