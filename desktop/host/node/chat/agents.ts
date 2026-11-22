/* Agent Chat: the agents beyond Claude, Codex, Cursor and Gemini. Each one runs on the person's own sign-in or
   settings, gets OpenPixel's server for the run (none of them need it in their own settings), and its output is read
   into the same events (see runner.ts). Formats come from each tool's own source and docs; selftest.test.ts replays them.
     opencode   `opencode run --format json` (V1 and V2 lines differ: V2 needs --standalone); OpenPixel and a
                permission rule allowing only its tools go in OPENCODE_CONFIG_CONTENT.
     Kiro       `kiro-cli chat --no-interactive --v2 --output-format stream-json`: ACP session updates in an envelope;
                OpenPixel comes from the chat folder's .kiro/settings/mcp.json, trusted with --trust-tools=@openpixel.
     Goose      `goose run --output-format stream-json --with-extension …`; sessions are named after the chat, since the
                stream never says its id.
     Cline      `cline --json`, with CLINE_MCP_SETTINGS_PATH pointing at a file that holds only OpenPixel.
     Hermes     `hermes acp`: the Agent Client Protocol over stdin/stdout (its other headless mode prints only the final
                answer). OpenPixel is passed in session/new; permission requests are declined (MCP calls need none).
   Ported from ChatAgents.swift. */
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { envValue, inHome } from './launch.ts';
import type { Model, Provider } from './providers.ts';
import { defaultModel, provider } from './providers.ts';
import { readText } from './skills.ts';
import { short, textOf, toolName } from './streams.ts';
import type { ChatContext, Env, Run } from './types.ts';
import type { Dict } from './values.ts';
import { bool, dict, dicts, get, has, int, isDict, isSet, lines, pick, plainJSON, prettyJSON, str, trimAll, trimChars, trimSpaces, uuid, WORD } from './values.ts';

const read = (relative: string): string | null => readText(inHome(relative));

/** Goose keeps its settings in ~/.config/goose, and on Windows in %APPDATA%\Block\goose\config. */
function gooseConfig(): string | null {
  if (process.platform === 'win32') {
    const appData = envValue(process.env, 'APPDATA');
    return appData ? readText(nodePath.join(appData, 'Block', 'goose', 'config', 'config.yaml')) : null;
  }
  return read('.config/goose/config.yaml');
}

/** Whether the agent itself is set up (a provider chosen): installed but unset agents stay off the menu. */
export function moreProviderConfigured(id: string): boolean {
  switch (id) {
    case 'goose': return gooseConfig()?.includes('GOOSE_PROVIDER') ?? false;
    case 'cline': return nodeFS.existsSync(inHome('.cline/data/settings/providers.json'));
    case 'hermes': return hermesModel() !== null;
    default: return true;
  }
}

const envSet = (name: string): boolean => (process.env[name] ?? '') !== '';

/** Gemini CLI signs in interactively; it is ready with cached Google credentials, a chosen auth type or an API key. */
export function geminiSignedIn(): boolean {
  if (envSet('GEMINI_API_KEY') || envSet('GOOGLE_API_KEY')) return true;
  if (nodeFS.existsSync(inHome('.gemini/oauth_creds.json'))) return true;
  return read('.gemini/settings.json')?.includes('selectedType') ?? false;
}

/** Copilot's token: an environment variable, the system's password store (the item "copilot-cli"), or its own
    settings file. */
export async function copilotSignedIn(c: ChatContext): Promise<boolean> {
  if (['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'].some(envSet)) return true;
  // Only asks whether the item exists (no -w: the token itself is never read).
  if (process.platform === 'darwin'
      && await c.capture('/usr/bin/security', ['find-generic-password', '-s', 'copilot-cli'], { timeout: 4 }) !== null) return true;
  // Windows keeps it in Credential Manager; `cmdkey /list` prints the names of what is stored, never the secrets.
  if (process.platform === 'win32'
      && ((await c.capture('cmdkey.exe', ['/list'], { timeout: 4 })) ?? '').includes('copilot-cli')) return true;
  return read('.copilot/config.json')?.includes('"token') ?? false;
}

/** `gemini --list-models --output-format json` (0.67+): a JSON array of {modelId|id, displayName|name}; makes no model call. */
export async function geminiModels(c: ChatContext, exe: string): Promise<Model[]> {
  const env: Env = { ...await c.env(), NO_BROWSER: 'true' };
  const out = await c.capture(exe, ['--list-models', '--output-format', 'json'], { env, timeout: 15 });
  const start = out === null ? -1 : out.indexOf('[');
  let list: Dict[] | undefined;
  try { list = start < 0 ? undefined : dicts(JSON.parse((out as string).slice(start))); } catch { list = undefined; }
  if (!list) return [defaultModel()];
  const models = list.flatMap((m): Model[] => {
    const id = str(pick(m, 'modelId', 'id'));
    return id !== undefined && id !== '' ? [{ id, label: str(pick(m, 'displayName', 'name')) ?? id }] : [];
  });
  return [defaultModel(), ...models];
}

/** Hermes' model from ~/.hermes/config.yaml (model: default: …), for the menu's label. */
export function hermesModel(): string | null {
  const yaml = read('.hermes/config.yaml');
  if (yaml === null) return null;
  let inModel = false;
  for (const raw of yaml.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw; // a file saved on Windows
    if (!line.startsWith(' ') && !line.startsWith('\t')) { inModel = line.startsWith('model:'); continue; }
    const m = inModel ? /^\s+default:\s*['"]?([^'"#]+)/.exec(line) : null;
    if (m) {
      const v = trimChars(m[0].slice(m[0].indexOf(':') + 1), ' \'"');
      if (v !== '') return v;
    }
  }
  return null;
}

export async function moreModels(c: ChatContext, id: string, exe: string): Promise<Model[]> {
  switch (id) {
    case 'opencode': {
      // `opencode models`: one provider/model per line (only providers the person can use, and the free ones).
      const out = await c.capture(exe, ['models'], { env: await c.env(), timeout: 12 });
      if (out === null) break;
      const shape = new RegExp(`^[${WORD}.-]+/[${WORD}.:@/-]+$`, 'u');
      const ids = lines(out).map(trimSpaces).filter((l) => shape.test(l));
      if (ids.length) return [defaultModel(), ...ids.slice(0, 120).map((m) => ({ id: m, label: m }))];
      break;
    }
    case 'kiro': {
      // `kiro-cli chat --list-models --format json`: read loosely (a list of ids, or objects with an id/name).
      const out = await c.capture(exe, ['chat', '--list-models', '--format', 'json'], { env: await c.env(), timeout: 12 });
      if (out === null) break;
      let o: unknown;
      try { o = JSON.parse(out); } catch { break; }
      if (!isDict(o) && !Array.isArray(o)) break;
      const inner = get(dict(o), 'models');
      const list: unknown[] = Array.isArray(o) ? o : Array.isArray(inner) ? inner : [];
      const models = list.flatMap((x): Model[] => {
        if (typeof x === 'string') return [{ id: x, label: x }];
        const m = dict(x);
        const mid = str(pick(m, 'modelId', 'id', 'model_id', 'name'));
        return mid !== undefined ? [{ id: mid, label: str(pick(m, 'modelName', 'name', 'displayName')) ?? mid }] : [];
      });
      if (models.length) return [defaultModel(), ...models];
      break;
    }
    case 'hermes': {
      const m = hermesModel();
      if (m !== null) return [{ id: '', label: m }];
      break;
    }
    default: break;
  }
  return [defaultModel()];
}

// MARK: - arguments and environment

/** opencode's two lines: 2.x is the new one (needs --standalone, mcp.servers, ordered permission rules). */
export async function opencodeV2(c: ChatContext): Promise<boolean> {
  const p = provider('opencode');
  const exe = p ? await c.find(p) : null;
  const v = exe === null ? null : await c.capture(exe, ['--version'], { env: await c.env(), timeout: 6 });
  if (v === null) return true;
  const first = trimAll(v).split('.').find((part) => part !== '');
  const digits = first === undefined ? '' : first.replace(/[^\p{N}]/gu, '');
  const major = /^[0-9]+$/.test(digits) ? Number(digits) : undefined;
  return (major ?? 2) >= 2;
}

export interface Message { prompt: string; model: string; effort: string; resume: string | null; system: string; chat: string }

export function moreArguments(c: ChatContext, p: Provider, m: Message, v2: boolean): string[] {
  const text = m.resume === null && m.system !== '' ? `${m.system}\n\n${m.prompt}` : m.prompt;
  switch (p.id) {
    case 'copilot': {
      const file = nodePath.join(c.workDir, 'copilot-mcp.json');
      write(c, file, plainJSON({ mcpServers: { openpixel: { type: 'local', command: c.mcpCommand, args: ['--mcp'], tools: ['*'] } } }));
      // Non-interactive runs deny anything not allowed; --allow-tool=openpixel allows OpenPixel's server only.
      const a = ['-p', text, '--output-format', 'json', '--no-auto-update', '--no-color', '--no-ask-user',
                 '--additional-mcp-config', `@${file}`, '--allow-tool=openpixel', '--disable-builtin-mcps'];
      if (m.model !== '') a.push('--model', m.model);
      if (p.efforts.includes(m.effort)) a.push('--effort', m.effort);
      if (m.resume !== null) a.push(`--resume=${m.resume}`);
      return a;
    }
    case 'opencode': {
      const a = ['run', ...(v2 ? ['--standalone'] : []), '--format', 'json', '--thinking'];
      if (m.model !== '') a.push('-m', m.model);
      if (m.resume !== null) a.push('-s', m.resume);
      return [...a, text];
    }
    case 'kiro': {
      prepareKiroFolder(c);
      const a = ['chat', '--no-interactive', '--v2', '--output-format', 'stream-json', '--trust-tools=@openpixel'];
      if (m.model !== '') a.push('--model', m.model);
      if (m.resume !== null) a.push('--resume-id', m.resume);
      return [...a, text];
    }
    case 'goose': {
      // The extension string is a command line: quote the path in case it has spaces.
      const a = ['run', '-t', text, '--output-format', 'stream-json', '--with-extension', `"${c.mcpCommand}" --mcp`];
      a.push(...(m.resume !== null ? ['--resume', '--name', m.resume] : ['--name', m.chat]));
      return a;
    }
    case 'cline':
      return ['--json', ...(m.model === '' ? [] : ['-m', m.model]), text];
    default: // hermes: the prompt goes in over ACP
      return ['acp'];
  }
}

export function moreEnvironment(c: ChatContext, p: Provider, v2: boolean): Env {
  switch (p.id) {
    case 'opencode': {
      const cmd = [c.mcpCommand, '--mcp'];
      // Only OpenPixel's tools (and skills): no shell, edits or web; explicit denies hold even when auto-approving.
      const config = v2
        ? { mcp: { servers: { openpixel: { type: 'local', command: cmd, codemode: false } } },
            permissions: [{ action: '*', resource: '*', effect: 'deny' },
                          { action: 'openpixel_*', resource: '*', effect: 'allow' },
                          { action: 'skill', resource: '*', effect: 'allow' }] }
        : { mcp: { openpixel: { type: 'local', command: cmd, enabled: true } },
            permission: { '*': 'deny', 'openpixel_*': 'allow', skill: 'allow' } };
      return { OPENCODE_CONFIG_CONTENT: plainJSON(config) };
    }
    case 'goose': return { GOOSE_MODE: 'auto' }; // headless runs in approve modes abort
    case 'cline': {
      const file = nodePath.join(c.workDir, 'cline-mcp.json');
      write(c, file, plainJSON({ mcpServers: { openpixel: { type: 'stdio', command: c.mcpCommand, args: ['--mcp'] } } }));
      return { CLINE_MCP_SETTINGS_PATH: file };
    }
    case 'hermes': return { HERMES_ACP_SKIP_CONFIGURED_MCP: '1' }; // only the OpenPixel server we pass
    default: return {};
  }
}

/** Writes one of the chat folder's own files; a failure shows up as the agent not finding OpenPixel. */
export function write(c: ChatContext, file: string, text: string): void {
  try {
    c.fs.createDirAll(nodePath.dirname(file));
    c.fs.write(file, text);
  } catch { /* as the Swift's try? */ }
}

/** The chat folder as a Kiro workspace whose MCP settings hold OpenPixel. */
export function prepareKiroFolder(c: ChatContext): void {
  write(c, nodePath.join(c.workDir, '.kiro', 'settings', 'mcp.json'),
        prettyJSON({ mcpServers: { openpixel: { command: c.mcpCommand, args: ['--mcp'] } } }));
}

// MARK: - reading their output

export function moreLine(c: ChatContext, run: Run, o: Dict): void {
  switch (run.provider) {
    case 'copilot': copilot(c, run, o); break;
    case 'opencode': opencode(c, run, o); break;
    case 'kiro': kiro(c, run, o); break;
    case 'goose': goose(c, run, o); break;
    case 'cline': cline(c, run, o); break;
    case 'hermes': acp(c, run, o); break;
    default: break;
  }
}

function once(c: ChatContext, run: Run, session: string | undefined): void {
  if (session === undefined || session === '' || run.session !== null) return;
  run.session = session;
  c.send(run, { t: 'session', session });
}

const nonEmpty = (v: unknown): string | undefined => {
  const s = str(v);
  return s !== undefined && s !== '' ? s : undefined;
};

/** Copilot: session events ({type, data}); text and reasoning stream as deltas and arrive whole once more (skipped
    when the deltas came); tool.execution_complete's "success" is the signal; a synthetic "result" ends the run. */
function copilot(c: ChatContext, run: Run, o: Dict): void {
  const d = dict(get(o, 'data')) ?? {};
  switch (str(get(o, 'type'))) {
    case 'session.start': once(c, run, str(get(d, 'sessionId'))); break;
    case 'assistant.message_delta': {
      const t = nonEmpty(get(d, 'deltaContent'));
      if (t === undefined) return;
      const mid = str(get(d, 'messageId')) ?? '';
      const gap = run.segment !== '' && run.segment !== mid ? '\n\n' : '';
      run.segment = mid;
      run.tools.set('msg:' + mid, 'streamed');
      c.send(run, { t: 'text', d: gap + t });
      break;
    }
    case 'assistant.message': {
      const mid = str(get(d, 'messageId')) ?? '';
      const t = nonEmpty(get(d, 'content'));
      if (!run.tools.has('msg:' + mid) && t !== undefined) {
        const gap = run.segment !== '' && run.segment !== mid ? '\n\n' : '';
        run.segment = mid;
        c.send(run, { t: 'text', d: gap + t });
      }
      break;
    }
    case 'assistant.reasoning_delta': {
      const t = nonEmpty(get(d, 'deltaContent'));
      if (t !== undefined) {
        run.tools.set('rsn:' + (str(get(d, 'reasoningId')) ?? ''), 'streamed');
        c.send(run, { t: 'think', d: t });
      }
      break;
    }
    case 'assistant.reasoning': {
      const t = nonEmpty(get(d, 'content'));
      if (!run.tools.has('rsn:' + (str(get(d, 'reasoningId')) ?? '')) && t !== undefined) c.send(run, { t: 'think', d: t });
      break;
    }
    case 'tool.execution_start': {
      const id = str(get(d, 'toolCallId')) ?? uuid();
      const name = toolName(nonEmpty(get(d, 'mcpToolName')) ?? str(get(d, 'toolName')) ?? 'tool');
      run.tools.set(id, name);
      c.send(run, { t: 'tool', id, name });
      if (isSet(get(d, 'arguments'))) c.send(run, { t: 'tool_input', id, input: d.arguments });
      break;
    }
    case 'tool.execution_complete': {
      const ok = bool(get(d, 'success')) ?? false;
      const result = dict(get(d, 'result'));
      const out = ok ? textOf(get(result, 'content')) : (str(get(dict(get(d, 'error')), 'message')) ?? textOf(get(result, 'content')));
      c.send(run, { t: 'tool_done', id: str(get(d, 'toolCallId')) ?? '', ok, out: short(out) });
      break;
    }
    case 'session.error': {
      const signIn = str(get(d, 'remediation')) === 'sign_in' || str(get(d, 'errorType')) === 'authentication';
      c.send(run, { t: 'error', message: signIn ? "GitHub Copilot isn't signed in. Choose Sign in to GitHub Copilot… in the agent menu, then send again."
                                                : (str(get(d, 'message')) ?? 'Copilot stopped with an error.') });
      break;
    }
    case 'result': {
      run.gotResult = true;
      once(c, run, str(get(o, 'sessionId')));
      const code = int(get(o, 'exitCode')) ?? 0;
      if (code !== 0 && !run.reportedError) c.send(run, { t: 'error', message: `Copilot stopped (exit code ${code}).` });
      c.send(run, { t: 'done', ok: code === 0, session: run.session });
      break;
    }
    default: break;
  }
}

/** opencode: text arrives once per finished block, tools only when finished (completed / error). */
function opencode(c: ChatContext, run: Run, o: Dict): void {
  once(c, run, str(get(o, 'sessionID')));
  const part = dict(get(o, 'part')) ?? {};
  switch (str(get(o, 'type'))) {
    case 'text': {
      const t = nonEmpty(get(part, 'text'));
      if (t !== undefined) c.send(run, { t: 'text', d: t + '\n\n', whole: true });
      break;
    }
    case 'reasoning': {
      const t = nonEmpty(get(part, 'text'));
      if (t !== undefined) c.send(run, { t: 'think', d: t + '\n' });
      break;
    }
    case 'tool_use': {
      const id = str(get(part, 'callID')) ?? str(get(part, 'id')) ?? uuid();
      const state = dict(get(part, 'state')) ?? {};
      const name = toolName(str(get(part, 'tool')) ?? 'tool');
      c.send(run, { t: 'tool', id, name });
      if (has(state, 'input')) c.send(run, { t: 'tool_input', id, input: state.input });
      const ok = str(get(state, 'status')) === 'completed';
      c.send(run, { t: 'tool_done', id, ok, out: short(textOf(get(state, ok ? 'output' : 'error'))) });
      break;
    }
    case 'error': {
      const e = dict(get(o, 'error')) ?? {};
      const msg = str(get(e, 'message')) ?? str(get(dict(get(e, 'data')), 'message')) ?? str(get(e, 'name')) ?? 'opencode stopped with an error.';
      c.send(run, { t: 'error', message: msg });
      break;
    }
    default: break;
  }
}

/** Kiro: an envelope around ACP session updates, ending in runFinished or runError. */
function kiro(c: ChatContext, run: Run, o: Dict): void {
  const data = dict(get(o, 'data')) ?? {};
  switch (str(get(o, 'type'))) {
    case 'metadata': once(c, run, str(get(data, 'sessionId'))); break;
    case 'sessionUpdate': {
      once(c, run, str(get(data, 'sessionId')));
      const u = dict(get(data, 'update'));
      if (u) acpUpdate(c, run, u);
      break;
    }
    case 'runFinished': {
      run.gotResult = true;
      const t = nonEmpty(get(data, 'finalText'));
      if (!run.sentText && bool(get(data, 'finalTextTruncated')) !== true && t !== undefined) c.send(run, { t: 'text', d: t });
      const ok = (str(get(data, 'status')) ?? 'success') === 'success';
      if (!ok) c.send(run, { t: 'error', message: `Kiro stopped (${str(get(data, 'stopReason')) ?? str(get(data, 'status')) ?? 'error'}).` });
      c.send(run, { t: 'done', ok, session: run.session });
      break;
    }
    case 'runError':
      run.gotResult = true;
      c.send(run, { t: 'error', message: str(get(data, 'message')) ?? 'Kiro stopped with an error.' });
      c.send(run, { t: 'done', ok: false });
      break;
    default: break;
  }
}

/** One ACP session update (Kiro's stream, Hermes over ACP): text, thinking, tool calls and their updates. */
export function acpUpdate(c: ChatContext, run: Run, u: Dict): void {
  const content = get(u, 'content');
  switch (str(get(u, 'sessionUpdate'))) {
    case 'agent_message_chunk': {
      const t = nonEmpty(get(dict(content), 'text'));
      if (t !== undefined) { run.sentText = true; c.send(run, { t: 'text', d: t }); }
      break;
    }
    case 'agent_thought_chunk': {
      const t = nonEmpty(get(dict(content), 'text'));
      if (t !== undefined) c.send(run, { t: 'think', d: t });
      break;
    }
    case 'tool_call': case 'tool_call_update': {
      const id = str(get(u, 'toolCallId')) ?? uuid();
      if (!run.tools.has(id)) {
        const kiroName = str(get(dict(get(dict(get(u, '_meta')), 'kiro')), 'toolName'));
        const name = toolName(kiroName ?? str(get(u, 'title')) ?? 'tool');
        run.tools.set(id, name);
        c.send(run, { t: 'tool', id, name });
      }
      if (isSet(get(u, 'rawInput'))) c.send(run, { t: 'tool_input', id, input: u.rawInput });
      const status = str(get(u, 'status')) ?? '';
      if (status !== 'completed' && status !== 'failed') return;
      const out = acpText(content) ?? textOf(get(u, 'rawOutput'));
      // Hermes reports an MCP tool's error as a completed call whose output is {"error": …}.
      const looksFailed = run.provider === 'hermes' && trimSpaces(out).startsWith('{"error"');
      c.send(run, { t: 'tool_done', id, ok: status === 'completed' && !looksFailed, out: short(out) });
      break;
    }
    default: break; // plans, command lists, usage and session info
  }
}

/** ACP tool-call content: [{"type":"content","content":{"type":"text","text":…}}, {"type":"diff",…}]. */
export function acpText(v: unknown): string | undefined {
  const items = dicts(v);
  if (!items) return undefined;
  const texts = items.map((item) => {
    const inner = dict(get(item, 'content'));
    return inner ? str(get(inner, 'text')) : str(get(item, 'text'));
  }).filter((t): t is string => t !== undefined);
  return texts.length ? texts.join('\n') : undefined;
}

/** Goose: messages whose content items are text, thinking, toolRequest and toolResponse. */
function goose(c: ChatContext, run: Run, o: Dict): void {
  once(c, run, run.id); // Goose's stream never names its session: it is the chat's own name (--name)
  switch (str(get(o, 'type'))) {
    case 'message': {
      const m = dict(get(o, 'message')) ?? {};
      const assistant = (str(get(m, 'role')) ?? 'assistant') === 'assistant';
      for (const item of dicts(get(m, 'content')) ?? []) {
        switch (str(get(item, 'type'))) {
          case 'text': {
            const t = nonEmpty(get(item, 'text'));
            if (assistant && t !== undefined) c.send(run, { t: 'text', d: t });
            break;
          }
          case 'thinking': {
            const t = nonEmpty(get(item, 'thinking'));
            if (t !== undefined) c.send(run, { t: 'think', d: t });
            break;
          }
          case 'toolRequest': {
            const id = str(get(item, 'id')) ?? uuid();
            const call = dict(get(item, 'toolCall')) ?? {};
            const value = dict(get(call, 'value')) ?? {};
            const name = toolName(str(get(value, 'name')) ?? 'tool');
            run.tools.set(id, name);
            c.send(run, { t: 'tool', id, name });
            if (has(value, 'arguments')) c.send(run, { t: 'tool_input', id, input: value.arguments });
            if (str(get(call, 'status')) === 'error') c.send(run, { t: 'tool_done', id, ok: false, out: textOf(get(call, 'error')) });
            break;
          }
          case 'toolResponse': {
            const id = str(get(item, 'id')) ?? '';
            const r = dict(get(item, 'toolResult')) ?? {};
            const value = dict(get(r, 'value'));
            // Two ways to fail: the call itself errored, or the tool answered with isError.
            const ok = str(get(r, 'status')) === 'success' && bool(get(value, 'isError')) !== true;
            const out = textOf(has(value, 'content') ? (value as Dict).content : get(r, 'error'));
            c.send(run, { t: 'tool_done', id, ok, out: short(out) });
            break;
          }
          default: break;
        }
      }
      break;
    }
    case 'error':
      run.gotResult = true;
      c.send(run, { t: 'error', message: str(get(o, 'error')) ?? 'Goose stopped with an error.' });
      c.send(run, { t: 'done', ok: false });
      break;
    case 'complete':
      run.gotResult = true;
      c.send(run, { t: 'done', ok: true, session: run.session });
      break;
    default: break;
  }
}

/** Cline: agent events (content_start per text delta, content_end closes a tool; its "error" key appears only on
    failure), then run_result or run_aborted. */
function cline(c: ChatContext, run: Run, o: Dict): void {
  switch (str(get(o, 'type'))) {
    case 'agent_event': {
      const e = dict(get(o, 'event')) ?? {};
      const kind = str(get(e, 'contentType'));
      switch (str(get(e, 'type'))) {
        case 'content_start': {
          const text = nonEmpty(get(e, 'text')), reasoning = nonEmpty(get(e, 'reasoning'));
          if (kind === 'text' && text !== undefined) c.send(run, { t: 'text', d: text });
          if (kind === 'reasoning' && reasoning !== undefined) c.send(run, { t: 'think', d: reasoning });
          if (kind === 'tool') {
            const id = str(get(e, 'toolCallId')) ?? uuid();
            const name = toolName(str(get(e, 'toolName')) ?? 'tool');
            run.tools.set(id, name);
            c.send(run, { t: 'tool', id, name });
            if (has(e, 'input')) c.send(run, { t: 'tool_input', id, input: e.input });
          }
          break;
        }
        case 'content_end':
          if (kind === 'tool') {
            const failed = isSet(get(e, 'error'));
            c.send(run, { t: 'tool_done', id: str(get(e, 'toolCallId')) ?? '', ok: !failed,
                          out: short(textOf(get(e, failed ? 'error' : 'output'))) });
          }
          break;
        case 'error':
          if (bool(get(e, 'recoverable')) !== true) {
            c.send(run, { t: 'error', message: str(get(dict(get(e, 'error')), 'message')) ?? textOf(get(e, 'error')) });
          }
          break;
        default: break;
      }
      break;
    }
    case 'run_result': {
      run.gotResult = true;
      const reason = str(get(o, 'finishReason')) ?? 'completed';
      const ok = !['error', 'aborted', 'failed'].includes(reason);
      if (!ok && !run.reportedError) c.send(run, { t: 'error', message: `Cline stopped (${reason}).` });
      c.send(run, { t: 'done', ok });
      break;
    }
    case 'run_aborted':
      run.gotResult = true;
      c.send(run, { t: 'done', ok: false, stopped: true });
      break;
    default: break;
  }
}

// MARK: - Hermes over ACP (JSON-RPC 2.0 over stdin/stdout)

export function acpBegin(run: Run): void {
  acpSend(run, { jsonrpc: '2.0', id: 1, method: 'initialize',
                 params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } });
}

function acpSend(run: Run, o: Dict): void {
  if (!run.input || run.input.destroyed || run.input.writableEnded) return;
  run.input.write(plainJSON(o) + '\n');
}

function acpEnd(run: Run): void {
  run.input?.end();
  run.input = null;
}

function acp(c: ChatContext, run: Run, o: Dict): void {
  const method = str(get(o, 'method'));
  if (method !== undefined) {
    const params = dict(get(o, 'params')) ?? {};
    const u = dict(get(params, 'update'));
    if (method === 'session/update' && u) { acpUpdate(c, run, u); return; }
    if (!has(o, 'id')) return; // other notifications
    const id = o.id;
    if (method === 'session/request_permission') {
      // OpenPixel's tools need no permission; anything that asks (a shell command, say) is declined.
      const options = dicts(get(params, 'options')) ?? [];
      const reject = options.find((x) => (str(get(x, 'kind')) ?? '').startsWith('reject'));
      const outcome = has(reject, 'optionId') ? { outcome: 'selected', optionId: (reject as Dict).optionId } : { outcome: 'cancelled' };
      acpSend(run, { jsonrpc: '2.0', id, result: { outcome } });
    } else {
      acpSend(run, { jsonrpc: '2.0', id, error: { code: -32601, message: 'Not supported by OpenPixel' } });
    }
    return;
  }
  const id = int(get(o, 'id'));
  if (id === undefined) return;
  const e = dict(get(o, 'error'));
  if (e) {
    run.gotResult = true;
    c.send(run, { t: 'error', message: str(get(e, 'message')) ?? 'Hermes stopped with an error.' });
    c.send(run, { t: 'done', ok: false });
    acpEnd(run);
    return;
  }
  const result = dict(get(o, 'result')) ?? {};
  switch (id) {
    case 1:
      acpSend(run, { jsonrpc: '2.0', id: 2, method: 'session/new',
                     params: { cwd: c.workDir, mcpServers: [{ name: 'openpixel', command: c.mcpCommand, args: ['--mcp'], env: [] }] } });
      break;
    case 2: {
      const sid = str(get(result, 'sessionId'));
      if (sid === undefined) {
        run.gotResult = true;
        c.send(run, { t: 'error', message: "Hermes didn't start a session." });
        c.send(run, { t: 'done', ok: false });
        acpEnd(run);
        return;
      }
      run.session = sid;
      acpSend(run, { jsonrpc: '2.0', id: 3, method: 'session/prompt',
                     params: { sessionId: sid, prompt: [{ type: 'text', text: run.prompt }] } });
      break;
    }
    case 3: {
      run.gotResult = true;
      const reason = str(get(result, 'stopReason')) ?? 'end_turn';
      switch (reason) {
        case 'end_turn': c.send(run, { t: 'done', ok: true }); break;
        case 'cancelled': c.send(run, { t: 'done', ok: false, stopped: true }); break;
        default:
          c.send(run, { t: 'error', message: reason === 'refusal' ? 'Hermes declined this request.' : `Hermes stopped (${reason}).` });
          c.send(run, { t: 'done', ok: false });
      }
      acpEnd(run);
      break;
    }
    default: break;
  }
}
