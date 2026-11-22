/* The editor's Chat panel. It talks to the agents the person already uses, on their own subscriptions: each message
   runs the agent's command-line tool headless (Claude Code, Codex, Cursor's agent, Gemini CLI, …) with OpenPixel's MCP
   server attached, reads its JSON event stream, and passes the page one simple stream of events:
     session (the agent's conversation id, used to continue it), text and think (deltas), tool (a call started),
     tool_input (its arguments), tool_done (its result), error, done.
   Nothing here holds API keys: each tool signs in the way it always does.
   Ported from ChatRunner in Chat.swift; what it returns and emits has the shapes the page already reads. */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as nodeFS from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { ChatRunner, ChatRunnerOptions } from '../../chat-api.ts';
import type { PlatformFS } from '../../platform';
import { acpBegin, copilotSignedIn, geminiModels, geminiSignedIn, moreArguments, moreEnvironment, moreLine, moreModels,
         moreProviderConfigured, opencodeV2, write } from './agents.ts';
import type { Message } from './agents.ts';
import { deleteHistory, loadHistory, moveHistory, pruneHistory, saveHistory } from './history.ts';
import { exitStatus, inHome, interrupt, isRunning, setEnv, terminate, Tools } from './launch.ts';
import type { Command } from './launch.ts';
import type { Model, Provider } from './providers.ts';
import { defaultModel, isMore, provider, providers } from './providers.ts';
import { promptWithSkill, readText, skillsForPage } from './skills.ts';
import { baseLine, short, tomlString } from './streams.ts';
import type { ChatContext, ChatEvent, Env, Run } from './types.ts';
import { newRun } from './types.ts';
import type { Dict } from './values.ts';
import { bool, dict, dicts, get, int, lines, nsJSON, parseObject, prettyJSON, str, stripAnsi, trimAll, trimSpaces, uuid, WORD } from './values.ts';

// A line that is not UTF-8 is not JSON (Foundation refused it too); it is skipped like any other noise.
const utf8 = new TextDecoder('utf-8', { fatal: true });

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class Runner implements ChatRunner, ChatContext {
  readonly mcpCommand: string;
  readonly workDir: string;
  readonly fs: PlatformFS;
  /** Sends one event object to the page. */
  private readonly emit: (event: unknown) => void;
  private readonly tools = new Tools();
  private readonly runs = new Map<string, Run>();
  private cursorModels: Model[] | null = null;
  private cursorDefault = '';
  private cursorTrust: Promise<boolean> | null = null;

  /** `background`: look for the tools' folders and clear stale history right away (not for a replay). */
  constructor(options: ChatRunnerOptions, background = true) {
    this.mcpCommand = options.mcpCommand;
    this.workDir = options.workDir;
    this.fs = options.fs;
    this.emit = options.emit;
    try { this.fs.createDirAll(this.workDir); } catch { /* shows when a chat is saved or started */ }
    if (background) {
      // Apps opened from the Finder or a launcher don't get the shell's PATH, where these tools usually live. Ask a
      // login shell once, ahead of the first question.
      void this.tools.path();
      try { pruneHistory(this); } catch { /* next launch */ }
    }
  }

  // MARK: - finding the tools

  find(p: Provider): Promise<string | null> { return this.tools.find(p); }
  env(): Promise<Env> { return this.tools.env(); }
  capture(exe: string, args: string[], options: { env?: Env; timeout: number }): Promise<string | null> {
    return this.tools.capture(exe, args, options);
  }

  /** Cursor's newer builds want --trust to work in a folder without asking; older ones don't know the flag. */
  private cursorTrustFlag(): Promise<boolean> {
    this.cursorTrust ??= (async () => {
      const p = provider('cursor');
      const exe = p ? await this.find(p) : null;
      if (exe === null) return false;
      return (await this.capture(exe, ['--help'], { env: await this.env(), timeout: 6 }))?.includes('--trust') ?? false;
    })();
    return this.cursorTrust;
  }

  /** Whether Cursor's command-line agent is signed in (it keeps its own login, apart from the Cursor editor). */
  private async cursorSignedIn(exe: string): Promise<boolean> {
    const out = await this.capture(exe, ['about'], { env: await this.env(), timeout: 8 });
    if (out === null) return false;
    const line = lines(stripAnsi(out)).find((l) => l.includes('User Email'));
    return line !== undefined && !line.toLowerCase().includes('not logged in');
  }

  /** Cursor lists the models the person's plan offers. */
  private async listCursorModels(exe: string): Promise<Model[]> {
    if (this.cursorModels && this.cursorModels.length > 1) return this.cursorModels;
    const models: Model[] = [{ id: '', label: 'Auto' }];
    const out = await this.capture(exe, ['models'], { env: await this.env(), timeout: 8 });
    if (out !== null) {
      // "<id> - <name>" or "<id> - <name>  (current, default)"; headings and the "Tip:" line have no " - ".
      const shape = new RegExp(`^[A-Za-z0-9][${WORD}.\\-]* - \\S`, 'u');
      for (const line of lines(stripAnsi(out))) {
        const s = trimSpaces(line);
        if (!shape.test(s)) continue;
        const parts = s.split(' - ');
        const id = trimSpaces(parts[0] as string);
        if (id.toLowerCase() === 'auto') continue;
        const rest = parts.slice(1).join(' - ');
        const label = rest.replace(/\s*\([^)]*\)\s*$/, '');
        if (rest.includes('default)') || rest.includes('(default')) this.cursorDefault = id;
        if (!models.some((m) => m.id === id)) models.push({ id, label });
      }
    }
    this.cursorModels = models;
    return models;
  }

  /** The models the person's ChatGPT plan offers in Codex, as Codex itself last fetched them
      (~/.codex/models_cache.json: the ones it shows in its own picker, in its order, each with its effort levels),
      and the model their Codex settings choose. */
  static codexModels(): { models: Model[]; chosen: string } {
    let models: Model[] = [];
    const cache = readText(inHome('.codex/models_cache.json'));
    const list = cache === null ? undefined : dicts(get(parseObject(cache), 'models'));
    if (list) {
      const priority = (m: Dict): number => int(get(m, 'priority')) ?? 999;
      const shown = list.filter((m) => (str(get(m, 'visibility')) ?? 'list') !== 'hide').sort((a, b) => priority(a) - priority(b));
      for (const m of shown) {
        const slug = str(get(m, 'slug'));
        if (slug === undefined || slug === '') continue;
        const efforts = (dicts(get(m, 'supported_reasoning_levels')) ?? []).flatMap((x) => str(get(x, 'effort')) ?? []);
        const model: Model = { id: slug, label: str(get(m, 'display_name')) ?? slug };
        if (efforts.length) model.efforts = efforts;
        const level = str(get(m, 'default_reasoning_level'));
        if (level !== undefined) model.defaultEffort = level;
        models.push(model);
      }
    }
    let chosen = '';
    const toml = readText(inHome('.codex/config.toml'));
    if (toml !== null) {
      // Only the top-level `model = "…"` (before the first [table]).
      for (const line of lines(toml)) {
        const t = trimSpaces(line);
        if (t.startsWith('[')) break;
        const m = /^model\s*=\s*"([^"]+)"/.exec(t);
        if (m) chosen = m[1] as string;
      }
    }
    if (!models.length) models = [defaultModel()];
    return { models, chosen };
  }

  /** What the model menu offers: every known agent, whether its tool is on this computer, and whether it can reach
      OpenPixel. The agents are asked side by side (the Swift asked one after another; the answers are the same). */
  providersForPage(): Promise<unknown[]> {
    return Promise.all(providers.map((p) => this.providerForPage(p)));
  }

  private async providerForPage(p: Provider): Promise<Dict> {
    const exe = await this.find(p);
    const installed = exe !== null;
    const more = isMore(p.id);
    // For Claude, Codex, Cursor and Gemini the Swift took "configured" from the Agents page's look at their own MCP
    // settings. All four get OpenPixel on the command line (injectsMCP), so it never changed an answer below; it is
    // not looked up here.
    const configured = more ? installed && moreProviderConfigured(p.id) : false;
    let models = p.models, chosen = '';
    // Cursor's agent has its own sign-in: connected but signed out, it offers to sign in instead of models.
    let signedIn = true;
    if (p.id === 'cursor') signedIn = exe !== null && await this.cursorSignedIn(exe);
    else if (p.id === 'gemini-cli') signedIn = geminiSignedIn();
    else if (p.id === 'copilot') signedIn = await copilotSignedIn(this);
    if (exe !== null && p.id === 'cursor' && signedIn) { models = await this.listCursorModels(exe); chosen = this.cursorDefault; }
    if (exe !== null && p.id === 'codex') ({ models, chosen } = Runner.codexModels());
    if (exe !== null && p.id === 'gemini-cli' && signedIn) models = await geminiModels(this, exe);
    if (exe !== null && more) models = await moreModels(this, p.id, exe);
    return {
      id: p.id, name: p.name, plan: p.plan, installed,
      ready: installed && (more ? configured : (p.injectsMCP || configured)) && signedIn,
      needs_setup: installed && (more ? !configured : (!p.injectsMCP && !configured)),
      // Only agents whose sign-in can start from here (Cursor, Copilot open the browser) offer it.
      needs_login: installed && (p.injectsMCP || configured) && !signedIn && ['cursor', 'copilot'].includes(p.id),
      models: models.map((m) => {
        const o: Dict = { id: m.id, label: m.label };
        if (m.efforts !== undefined) o.efforts = m.efforts;
        if (m.defaultEffort !== undefined) o.default_effort = m.defaultEffort;
        return o;
      }),
      default_model: chosen,
      efforts: p.efforts, default_effort: p.defaultEffort,
    };
  }

  // MARK: - history (each file's chats; see history.ts)

  loadHistory(key: string): unknown { return loadHistory(this, key); }
  saveHistory(key: string, data: unknown): unknown { return saveHistory(this, key, data); }
  deleteHistory(id: string): void { deleteHistory(this, id); }
  moveHistory(from: string, to: string): void { moveHistory(this, from, to); }

  // MARK: - skills (see skills.ts)

  skillsForPage(provider: string): Promise<unknown[]> { return Promise.resolve(skillsForPage(this, provider)); }

  // MARK: - running a message

  /** Starts the agent on one message. True when it is running; otherwise the sentence the page shows. */
  async start(body: Record<string, unknown>): Promise<unknown> {
    const chat = str(get(body, 'chat')) ?? uuid();
    const p = provider(str(get(body, 'provider')) ?? '');
    if (!p) return 'Unknown agent';
    const exe = await this.find(p);
    if (exe === null) return `${p.name} isn't installed on this Mac.`;
    const typed = str(get(body, 'prompt')) ?? '';
    const model = str(get(body, 'model')) ?? '';
    const effort = str(get(body, 'effort')) ?? '';
    const resume = str(get(body, 'resume')) || null;
    const system = str(get(body, 'system')) ?? '';
    let prompt = typed;
    const skill = str(get(body, 'skill'));
    if (skill !== undefined && skill !== '') {
      // Claude runs "/skill" itself, unless a transcript from another agent has to come first.
      const p2 = promptWithSkill(this, p.id, skill, prompt, !(bool(get(body, 'transcript')) ?? false));
      if (p2 === null) return `${p.name} has no skill called “${skill}”.`;
      prompt = p2;
    }
    this.stop(chat);

    const run = newRun(chat, p.id);
    const more = isMore(p.id);
    const v2 = p.id === 'opencode' ? await opencodeV2(this) : true;
    const message: Message = { prompt, model, effort, resume: more && !p.resumes ? null : resume, system, chat };
    const args = more ? moreArguments(this, p, message, v2) : await this.arguments(p, message);
    // Gemini: trust the chat folder (so its settings load) and never open a browser mid-run (a signed-out run would
    // otherwise print a consent question into the JSON stream).
    const extra: Env = more ? moreEnvironment(this, p, v2)
      : p.id === 'gemini-cli' ? { GEMINI_CLI_TRUST_WORKSPACE: 'true', NO_BROWSER: 'true' } : {};
    const env = await this.env();
    for (const [k, v] of Object.entries(extra)) setEnv(env, k, v);
    // ACP (Hermes): requests go in over stdin; the prompt is sent once the session exists. The others get no stdin.
    const acp = p.id === 'hermes';
    if (acp) run.prompt = system === '' ? prompt : `${system}\n\n${prompt}`;

    let child: ChildProcess;
    try {
      const command: Command = this.tools.command(exe, args);
      child = spawn(command.file, command.args, { cwd: this.workDir, env, stdio: [acp ? 'pipe' : 'ignore', 'pipe', 'pipe'],
                                                  windowsHide: true, windowsVerbatimArguments: command.verbatim });
    } catch (e) { return `Couldn't start ${p.name}: ${reason(e)}`; }
    run.child = child;
    child.on('error', () => { /* answered below when it never started; later ones (a failed kill) change nothing */ });
    child.stdout?.on('data', (d: Buffer) => this.consume(run, d));
    child.stderr?.on('data', (d: Buffer) => {
      if (run.stderrSize < 64_000) { run.stderr.push(d); run.stderrSize += d.length; }
    });
    if (acp && child.stdin) {
      run.input = child.stdin;
      child.stdin.on('error', () => { /* it quit while being written to: the exit tells the rest */ });
    }

    // Started, or not (no such file, not allowed): Node says which a moment later.
    const failed = await new Promise<Error | null>((resolve) => {
      child.once('spawn', () => resolve(null));
      child.once('error', (e) => resolve(e));
    });
    if (failed) return `Couldn't start ${p.name}: ${failed.message}`;

    // The run closes when the tool has exited and its output has been read to the end. Should something it started
    // keep the output open, two seconds after the exit is long enough to wait (the Swift read on after 0.15 s).
    let status = 0, closed = false;
    let late: NodeJS.Timeout | undefined;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearTimeout(late);
      if (run.stopTimer) clearTimeout(run.stopTimer);
      if (run.buffer.length) { const rest = run.buffer; run.buffer = Buffer.alloc(0); this.line(run, rest); }
      this.finish(run, status);
    };
    child.once('exit', (code, signal) => { status = exitStatus(code, signal); late = setTimeout(close, 2000); });
    child.once('close', (code, signal) => { status = exitStatus(code, signal); close(); });

    this.runs.set(chat, run);
    if (acp) acpBegin(run);
    return true;
  }

  /** Starts an agent's own sign-in (Cursor's opens the browser). The page hears when it ends and looks again. */
  login(id: string): unknown {
    const p = ['cursor', 'copilot'].includes(id) ? provider(id) : undefined;
    const exe = p ? this.tools.findNow(p) : null;
    if (!p || exe === null) return 'Nothing to sign in to.';
    const env = this.tools.envNow();
    delete env.NO_OPEN_BROWSER;
    let child: ChildProcess;
    try {
      const command = this.tools.command(exe, ['login']);
      child = spawn(command.file, command.args, { env, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: command.verbatim });
    } catch (e) { return `Couldn't start ${p.name}'s sign-in: ${reason(e)}`; }
    let told = false;
    const ended = (): void => {
      if (told) return;
      told = true;
      this.cursorModels = null;
      this.emit({ t: 'providers' });
    };
    child.once('exit', ended);
    child.once('error', ended);
    return true;
  }

  stop(chat: string): void {
    const run = this.runs.get(chat);
    const child = run?.child ?? null;
    if (!run || !child || !isRunning(child)) return;
    run.stopped = true;
    interrupt(child);
    run.stopTimer = setTimeout(() => { if (isRunning(child)) terminate(child); }, 1500);
  }

  stopAll(): void {
    for (const run of this.runs.values()) if (run.child && isRunning(run.child)) terminate(run.child);
  }

  /** The chat's folder as a Gemini workspace with OpenPixel's server (trusted through GEMINI_CLI_TRUST_WORKSPACE). */
  private prepareGeminiFolder(): void {
    write(this, nodePath.join(this.workDir, '.gemini', 'settings.json'),
          prettyJSON({ mcpServers: { openpixel: { command: this.mcpCommand, args: ['--mcp'] } } }));
  }

  /** The chat's folder as a Cursor project: OpenPixel's server, and permission for its tools only. */
  private prepareCursorFolder(): void {
    const dir = nodePath.join(this.workDir, '.cursor');
    write(this, nodePath.join(dir, 'mcp.json'), prettyJSON({ mcpServers: { openpixel: { command: this.mcpCommand, args: ['--mcp'] } } }));
    write(this, nodePath.join(dir, 'cli.json'), prettyJSON({ permissions: { allow: ['Mcp(openpixel:*)'], deny: [] } }));
  }

  private async arguments(p: Provider, m: Message): Promise<string[]> {
    const { prompt, model, effort, resume, system } = m;
    const mcpJSON = nsJSON({ mcpServers: { openpixel: { command: this.mcpCommand, args: ['--mcp'] } } });
    const text = resume === null && system !== '' ? `${system}\n\n${prompt}` : prompt;
    switch (p.id) {
      case 'claude-code': {
        // OpenPixel's tools, plus Skill and Read so Claude can use the person's skills (and read their files):
        // no shell, no file edits, no other MCP servers; nothing waits for a permission prompt.
        const a = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
                   '--mcp-config', mcpJSON, '--strict-mcp-config', '--tools', 'Skill', 'Read',
                   '--allowedTools', 'mcp__openpixel', 'Skill', 'Read', '--permission-prompts', 'none'];
        if (model !== '') a.push('--model', model);
        if (p.efforts.includes(effort)) a.push('--effort', effort);
        if (system !== '') a.push('--append-system-prompt', system);
        if (resume !== null) a.push('--resume', resume);
        return a;
      }
      case 'codex': {
        // `codex exec resume` takes its own flags and has no --sandbox, so the sandbox goes in as a setting.
        // mcp_servers is replaced as a whole: only OpenPixel, none of the person's other servers (like Claude's
        // --strict-mcp-config). Values are TOML, so the path is written as a TOML string.
        const a = ['exec', ...(resume !== null ? ['resume', resume] : []), '--json', '--skip-git-repo-check',
                   '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"',
                   '-c', `mcp_servers={openpixel={command=${tomlString(this.mcpCommand)},args=["--mcp"]}}`];
        if (model !== '') a.push('-m', model);
        // Each Codex model has its own levels (up to ultra), so any plain level name the menu offered goes through.
        if (/^[a-z]+$/.test(effort)) a.push('-c', `model_reasoning_effort="${effort}"`);
        a.push(text);
        return a;
      }
      case 'cursor': {
        this.prepareCursorFolder();
        // --approve-mcps loads the folder's OpenPixel server; its cli.json allows OpenPixel's tools (and nothing else).
        const a = ['-p', '--output-format', 'stream-json', '--stream-partial-output', '--approve-mcps'];
        if (await this.cursorTrustFlag()) a.push('--trust');
        if (model !== '') a.push('--model', model);
        if (resume !== null) a.push('--resume', resume);
        a.push(text);
        return a;
      }
      default: { // gemini-cli
        this.prepareGeminiFolder();
        // Headless Gemini denies anything not allowed (shell, writes); this allows OpenPixel's server only.
        const a = ['-p', text, '--output-format', 'stream-json', '--allowed-mcp-server-names', 'openpixel'];
        if (model !== '') a.push('-m', model);
        if (resume !== null) a.push('--resume', resume);
        return a;
      }
    }
  }

  // MARK: - reading the event stream

  private consume(run: Run, data: Buffer): void {
    let buffer = run.buffer.length ? Buffer.concat([run.buffer, data]) : data;
    const found: Buffer[] = [];
    for (let nl = buffer.indexOf(0x0A); nl >= 0; nl = buffer.indexOf(0x0A)) {
      found.push(buffer.subarray(0, nl));
      buffer = buffer.subarray(nl + 1);
    }
    run.buffer = buffer;
    for (const l of found) this.line(run, l);
  }

  send(run: Run, e: ChatEvent): void {
    // Agents that can't continue a session by id don't report one: the next message brings a transcript instead.
    if (e.t === 'session' && provider(run.provider)?.resumes === false) return;
    if (e.t === 'error') run.reportedError = true;
    this.emit({ ...e, chat: run.id });
  }

  line(run: Run, data: Uint8Array): void {
    let text: string;
    try { text = utf8.decode(data); } catch { return; }
    const o = parseObject(text);
    if (!o) return;
    if (isMore(run.provider)) moreLine(this, run, o); else baseLine(this, run, o);
  }

  finish(run: Run, status: number): void {
    if (run.finished) return;
    run.finished = true;
    if (this.runs.get(run.id) === run) this.runs.delete(run.id);
    if (run.gotResult) return;
    if (run.stopped) { this.send(run, { t: 'done', ok: false, stopped: true }); return; }
    run.input?.end();
    if (status !== 0 && !run.reportedError) { // an error the stream already reported isn't repeated from stderr
      const err = trimAll(stripAnsi(Buffer.concat(run.stderr).toString('utf8')));
      const all = lines(err);
      let last = all.slice(-6).join('\n');
      // Some agents (Cline) write their error to stderr as JSON: {"type":"error","message":…}.
      const json = [...all].reverse().find((l) => l.startsWith('{'));
      const o = json === undefined ? undefined : parseObject(json);
      const m = o ? (str(get(o, 'message')) ?? str(get(dict(get(o, 'error')), 'message'))) : undefined;
      if (m !== undefined) last = m;
      if (run.provider === 'cursor' && last.includes('Authentication required')) {
        last = "Cursor's agent isn't signed in. Choose Sign in to Cursor… in the agent menu, then send again.";
      }
      this.send(run, { t: 'error', message: last === '' ? `The agent quit (exit code ${status}).` : short(last, 1200) });
    }
    this.send(run, { t: 'done', ok: status === 0 });
  }
}

/** What the page would hear for these lines of an agent's output (for the checks ported from ChatSelfTest.swift). */
export function replay(fs: PlatformFS, id: string, output: string[], status = 0, stderr = ''): Dict[] {
  const out: Dict[] = [];
  const workDir = nodePath.join(os.tmpdir(), `openpixel-chat-replay-${process.pid}`);
  const r = new Runner({ mcpCommand: nodeFS.existsSync('/bin/true') ? '/bin/true' : 'true', workDir, fs, emit: (e) => out.push(e as Dict) }, false);
  const run = newRun('t', id);
  for (const l of output) r.line(run, Buffer.from(l, 'utf8'));
  run.stderr = [Buffer.from(stderr, 'utf8')];
  r.finish(run, status);
  return out;
}
