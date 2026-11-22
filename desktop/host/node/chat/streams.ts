/* Reading the event streams of Claude Code, Codex, Cursor's agent and Gemini CLI: each line of an agent's JSON output
   becomes the page's simple events (see runner.ts). The other agents are in agents.ts. */
import { rememberClaudeInit } from './skills.ts';
import type { ChatContext, Run } from './types.ts';
import type { Dict } from './values.ts';
import { bool, dict, dicts, firstSet, get, has, int, isDict, isSet, nsJSON, pick, prefix, str, trimAll, uuid } from './values.ts';

/** Long results are cut for the page: the first `n` characters and an ellipsis. */
export function short(s: string, n = 4000): string {
  const p = prefix(s, n);
  return p.length < s.length ? p + '…' : s;
}

/** A tool's own name, without the way each agent marks OpenPixel's server: Claude mcp__openpixel__x, Goose
    openpixel__x, opencode openpixel_x, Cursor openpixel-x, Kiro @openpixel/x. */
export function toolName(s: string): string {
  for (const p of ['mcp__openpixel__', 'mcp_openpixel_', 'openpixel__', '@openpixel/', 'openpixel/', 'openpixel.', 'openpixel_', 'openpixel-']) {
    if (s.startsWith(p)) return s.slice(p.length);
  }
  return s;
}

/** The text of a tool result, whatever shape the agent gave it. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (isDict(content) && has(content, 'content')) return textOf(content.content); // MCP results: {content: [...]}
  const items = dicts(content);
  if (items) {
    return items.map((x) => str(get(x, 'text')) ?? (str(get(x, 'type')) === 'image' ? '[image]' : undefined))
      .filter((t): t is string => t !== undefined).join('\n');
  }
  // Anything else that is an object or a list is shown as its JSON; bare numbers, true/false and null as nothing.
  if (isDict(content) || Array.isArray(content)) return nsJSON(content);
  return '';
}

/** Cursor's results: MCP content items are {"text": {"text": …}}; other cases carry error / reason / content fields. */
export function cursorText(v: unknown): string {
  const o = dict(v);
  if (!o) return textOf(v);
  const items = dicts(get(o, 'content'));
  if (items) {
    return items.map((x) => str(get(dict(get(x, 'text')), 'text')) ?? str(get(x, 'text')) ?? (has(x, 'image') ? '[image]' : undefined))
      .filter((t): t is string => t !== undefined).join('\n');
  }
  for (const k of ['error', 'reason', 'content', 'stderr', 'stdout']) {
    const s = str(get(o, k));
    if (s !== undefined && s !== '') return s;
  }
  return textOf(o);
}

/** A TOML basic string (JSON's encoder may write "/" as "\/", which TOML rejects). */
export function tomlString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const u = ch.codePointAt(0) as number;
    switch (ch) {
      case '"': out += '\\"'; break;
      case '\\': out += '\\\\'; break;
      case '\n': out += '\\n'; break;
      case '\t': out += '\\t'; break;
      case '\r': out += '\\r'; break;
      default: out += u < 0x20 || u === 0x7F ? '\\u' + u.toString(16).toUpperCase().padStart(4, '0') : ch;
    }
  }
  return out + '"';
}

/** One parsed line of the four base agents' output. */
export function baseLine(c: ChatContext, run: Run, o: Dict): void {
  switch (run.provider) {
    case 'claude-code': claude(c, run, o); break;
    case 'codex': codex(c, run, o); break;
    case 'cursor': cursor(c, run, o); break;
    default: gemini(c, run, o); break;
  }
}

// Claude's error subtypes, in words (its own message wins when there is one).
const CLAUDE_ERRORS = new Map([
  ['error_max_turns', 'It stopped after the most steps one message may take.'],
  ['error_max_budget_usd', 'It stopped at its spending limit.'],
  ['error_during_execution', 'Claude stopped with an error.'],
]);

function claude(c: ChatContext, run: Run, o: Dict): void {
  switch (str(get(o, 'type'))) {
    case 'system':
      if (str(get(o, 'subtype')) === 'init') {
        rememberClaudeInit(c, o); // what Claude loaded: which skills the "/" menu offers
        const s = str(get(o, 'session_id'));
        if (s !== undefined) c.send(run, { t: 'session', session: s, model: has(o, 'model') ? o.model : '' });
      }
      break;
    case 'stream_event': {
      const e = dict(get(o, 'event'));
      if (!e) return;
      const b = dict(get(e, 'content_block'));
      const d = dict(get(e, 'delta'));
      if (str(get(e, 'type')) === 'content_block_start' && b && str(get(b, 'type')) === 'tool_use') {
        const id = str(get(b, 'id')) ?? uuid(), name = toolName(str(get(b, 'name')) ?? 'tool');
        run.tools.set(id, name);
        c.send(run, { t: 'tool', id, name });
      } else if (str(get(e, 'type')) === 'content_block_delta' && d) {
        const text = str(get(d, 'text')), thinking = str(get(d, 'thinking'));
        if (str(get(d, 'type')) === 'text_delta' && text !== undefined) c.send(run, { t: 'text', d: text });
        if (str(get(d, 'type')) === 'thinking_delta' && thinking !== undefined) c.send(run, { t: 'think', d: thinking });
      }
      break;
    }
    case 'assistant':
      for (const part of dicts(get(dict(get(o, 'message')), 'content')) ?? []) {
        if (str(get(part, 'type')) !== 'tool_use') continue;
        const id = str(get(part, 'id'));
        if (id !== undefined) c.send(run, { t: 'tool_input', id, input: has(part, 'input') ? part.input : {} });
      }
      break;
    case 'user':
      for (const part of dicts(get(dict(get(o, 'message')), 'content')) ?? []) {
        if (str(get(part, 'type')) !== 'tool_result') continue;
        c.send(run, { t: 'tool_done', id: str(get(part, 'tool_use_id')) ?? '', ok: !(bool(get(part, 'is_error')) ?? false),
                      out: short(textOf(get(part, 'content'))) });
      }
      break;
    case 'result': {
      run.gotResult = true;
      const bad = bool(get(o, 'is_error')) ?? false;
      if (bad) {
        const sub = str(get(o, 'subtype')) ?? '';
        const own = str(get(o, 'result'));
        c.send(run, { t: 'error', message: (own !== undefined && own !== '' ? own : undefined) ?? CLAUDE_ERRORS.get(sub) ?? 'Claude stopped with an error.' });
      }
      c.send(run, { t: 'done', ok: !bad, session: has(o, 'session_id') ? o.session_id : null });
      break;
    }
    default: break;
  }
}

function codex(c: ChatContext, run: Run, o: Dict): void {
  // `codex exec --json`: thread / turn / item events.
  const type = str(get(o, 'type'));
  if (type !== undefined) {
    const item = dict(get(o, 'item')) ?? {};
    const kind = str(get(item, 'type')) ?? str(get(item, 'item_type')) ?? '';
    const id = str(get(item, 'id')) ?? uuid();
    const begin = (): void => {
      const name = kind === 'command_execution' ? 'shell' : toolName(str(get(item, 'tool')) ?? 'tool');
      run.tools.set(id, name);
      c.send(run, { t: 'tool', id, name });
      if (has(item, 'arguments') || has(item, 'command')) c.send(run, { t: 'tool_input', id, input: pick(item, 'arguments', 'command') });
    };
    switch (type) {
      case 'thread.started': {
        const s = str(get(o, 'thread_id'));
        if (s !== undefined) c.send(run, { t: 'session', session: s });
        break;
      }
      case 'item.started': case 'item.updated':
        if ((kind === 'mcp_tool_call' || kind === 'command_execution') && !run.tools.has(id)) begin();
        break;
      case 'item.completed':
        switch (kind) {
          case 'agent_message': case 'assistant_message':
            c.send(run, { t: 'text', d: (str(get(item, 'text')) ?? '') + '\n\n', whole: true });
            break;
          case 'reasoning': {
            const t = trimAll(str(get(item, 'text')) ?? '');
            if (t !== '') c.send(run, { t: 'think', d: t + '\n' });
            break;
          }
          case 'mcp_tool_call': case 'command_execution': {
            if (!run.tools.has(id)) begin();
            // A successful call still carries "error": null, so only a real value counts as a failure.
            const code = int(get(item, 'exit_code'));
            const failed = str(get(item, 'status')) === 'failed' || isSet(get(item, 'error'))
              || (kind === 'command_execution' && code !== undefined && code !== 0);
            const out = textOf(firstSet(get(item, 'result'), get(item, 'aggregated_output'), get(item, 'error')));
            c.send(run, { t: 'tool_done', id, ok: !failed, out: short(out) });
            break;
          }
          default: break;
        }
        break;
      case 'turn.completed': run.gotResult = true; c.send(run, { t: 'done', ok: true }); break;
      case 'turn.failed':
        run.gotResult = true;
        c.send(run, { t: 'error', message: str(get(dict(get(o, 'error')), 'message')) ?? 'The turn failed.' });
        c.send(run, { t: 'done', ok: false });
        break;
      case 'error': c.send(run, { t: 'error', message: str(get(o, 'message')) ?? 'Error' }); break;
      default: break;
    }
    return;
  }
  // Older Codex: {"id": …, "msg": {"type": …}}.
  const m = dict(get(o, 'msg'));
  const kind = str(get(m, 'type'));
  if (!m || kind === undefined) return;
  switch (kind) {
    case 'session_configured': {
      const s = str(get(m, 'session_id'));
      if (s !== undefined) c.send(run, { t: 'session', session: s });
      break;
    }
    case 'agent_message_delta': c.send(run, { t: 'text', d: str(get(m, 'delta')) ?? '' }); break;
    case 'agent_reasoning_delta': c.send(run, { t: 'think', d: str(get(m, 'delta')) ?? '' }); break;
    case 'mcp_tool_call_begin': {
      const id = str(get(m, 'call_id')) ?? uuid();
      const inv = dict(get(m, 'invocation')) ?? {};
      c.send(run, { t: 'tool', id, name: toolName(str(get(inv, 'tool')) ?? 'tool') });
      c.send(run, { t: 'tool_input', id, input: has(inv, 'arguments') ? inv.arguments : {} });
      break;
    }
    case 'mcp_tool_call_end': {
      const r = dict(get(m, 'result'));
      c.send(run, { t: 'tool_done', id: str(get(m, 'call_id')) ?? '', ok: !has(r, 'Err'), out: short(textOf(pick(r, 'Ok', 'Err'))) });
      break;
    }
    case 'task_complete': run.gotResult = true; c.send(run, { t: 'done', ok: true }); break;
    case 'error': c.send(run, { t: 'error', message: str(get(m, 'message')) ?? 'Error' }); break;
    default: break;
  }
}

function cursor(c: ChatContext, run: Run, o: Dict): void {
  switch (str(get(o, 'type'))) {
    case 'system': {
      const s = str(get(o, 'session_id'));
      if (s !== undefined) c.send(run, { t: 'session', session: s });
      break;
    }
    case 'thinking': {
      const t = str(get(o, 'text'));
      if (t !== undefined && t !== '') c.send(run, { t: 'think', d: t });
      break;
    }
    case 'assistant': {
      const t = (dicts(get(dict(get(o, 'message')), 'content')) ?? []).map((x) => str(get(x, 'text')) ?? '').join('');
      // With partial output the pieces arrive as deltas; before each tool call, question and the result Cursor
      // repeats the text since the last tool call (tagged model_call_id, or equal to what we have). Skip those.
      if (t === '' || has(o, 'model_call_id') || t === run.segment) return;
      run.segment += t;
      c.send(run, { t: 'text', d: t });
      break;
    }
    case 'interaction_query': run.segment = ''; break;
    case 'tool_call': {
      const id = str(get(o, 'call_id')) ?? uuid();
      const call = dict(get(o, 'tool_call')) ?? {};
      const key = Object.keys(call)[0] ?? 'tool';
      const val = dict(get(call, key)) ?? {};
      const args = dict(get(val, 'args')) ?? {};
      let name = key.replaceAll('ToolCall', '');
      // MCP: args.toolName is the tool, args.providerIdentifier the server ("name" is "<server>-<tool>").
      if (key === 'mcpToolCall') {
        const tool = str(get(args, 'toolName'));
        name = toolName((tool !== undefined && tool !== '' ? tool : undefined) ?? str(get(args, 'name')) ?? 'tool');
      }
      if (str(get(o, 'subtype')) === 'started') {
        run.segment = '';
        run.tools.set(id, name);
        c.send(run, { t: 'tool', id, name });
        c.send(run, { t: 'tool_input', id, input: has(args, 'args') ? args.args : args });
      } else {
        // A result holds exactly one case: only "success" (and, for MCP, not isError) means it worked; error,
        // rejected, permissionDenied, toolNotFound, failure, timeout, spawnError all mean it didn't.
        const r = dict(get(val, 'result')) ?? {};
        const success = dict(get(r, 'success'));
        const ok = success !== undefined && bool(get(success, 'isError')) !== true;
        c.send(run, { t: 'tool_done', id, ok, out: short(cursorText(success ?? Object.values(r)[0])) });
      }
      break;
    }
    case 'result': {
      run.gotResult = true;
      const bad = bool(get(o, 'is_error')) ?? false;
      if (bad) c.send(run, { t: 'error', message: str(get(o, 'result')) ?? 'The agent stopped with an error.' });
      c.send(run, { t: 'done', ok: !bad, session: has(o, 'session_id') ? o.session_id : null });
      break;
    }
    default: break;
  }
}

function gemini(c: ChatContext, run: Run, o: Dict): void {
  switch (str(get(o, 'type'))) {
    case 'init': {
      const s = str(get(o, 'session_id'));
      if (s !== undefined) c.send(run, { t: 'session', session: s });
      break;
    }
    case 'message': {
      const t = str(get(o, 'content'));
      if (str(get(o, 'role')) === 'assistant' && t !== undefined) c.send(run, { t: 'text', d: t });
      break;
    }
    case 'tool_use': {
      const id = str(get(o, 'tool_id')) ?? uuid();
      c.send(run, { t: 'tool', id, name: toolName(str(get(o, 'tool_name')) ?? 'tool') });
      c.send(run, { t: 'tool_input', id, input: has(o, 'parameters') ? o.parameters : {} });
      break;
    }
    case 'tool_result': {
      // status is the signal; on success "error" is absent, on failure it is {type, message}.
      const ok = (str(get(o, 'status')) ?? 'success') === 'success';
      const err = get(dict(get(o, 'error')), 'message');
      c.send(run, { t: 'tool_done', id: str(get(o, 'tool_id')) ?? '', ok, out: short(textOf(firstSet(get(o, 'output'), err))) });
      break;
    }
    case 'error':
      // Warnings (a loop it stopped, say) are not failures; errors are.
      if ((str(get(o, 'severity')) ?? 'error') === 'error') c.send(run, { t: 'error', message: str(get(o, 'message')) ?? 'Gemini stopped with an error.' });
      break;
    case 'result': {
      run.gotResult = true;
      const ok = (str(get(o, 'status')) ?? 'success') === 'success';
      if (!ok && !run.reportedError) c.send(run, { t: 'error', message: str(get(dict(get(o, 'error')), 'message')) ?? 'Gemini stopped with an error.' });
      c.send(run, { t: 'done', ok });
      break;
    }
    default: break;
  }
}
