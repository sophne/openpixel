/* Skills in Agent Chat: the ones each agent already has on this computer, offered when the person types "/".
     Claude Code   ~/.claude/skills (personal and synced), ~/.claude/commands, and its enabled plugins' skills and
                   commands. Claude reports what it loaded when a chat starts (its init event); that list is kept
                   (claude-init.json) and decides which plugin skills are on. A picked skill is sent as "/name …",
                   which Claude runs itself.
     Codex         ~/.codex/skills, ~/.codex/prompts, ~/.agents/skills
     Cursor        ~/.cursor/skills, ~/.cursor/skills-cursor, ~/.cursor/commands, ~/.agents/skills
     Gemini CLI    ~/.gemini/skills, ~/.gemini/commands (TOML), ~/.agents/skills
   For every agent but Claude, a picked skill's own instructions go in front of the message (with its folder, so
   the files it mentions can be found). Ported from ChatSkills.swift. "~" is the home folder on every system. */
import * as nodeFS from 'node:fs';
import * as nodePath from 'node:path';
import { inHome } from './launch.ts';
import type { ChatContext } from './types.ts';
import type { Dict } from './values.ts';
import { dicts, get, lines, parseObject, prefix, nsJSON, str, strings, trimAll, trimChars, trimSpaces } from './values.ts';

export interface Skill {
  name: string;         // what follows the "/" (Claude's plugin skills are "plugin:skill")
  description: string;
  path: string;         // its SKILL.md or command file
  source: string;       // "Personal", or the plugin's name
  command: boolean;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** A text file, or null when it is missing or not UTF-8 (the Swift's String(contentsOfFile:encoding:)). */
export function readText(path: string): string | null {
  try { return utf8.decode(nodeFS.readFileSync(path)); } catch { return null; }
}

function listDir(path: string): string[] | null {
  try { return nodeFS.readdirSync(path); } catch { return null; }
}

function isDirectory(path: string): boolean {
  try { return nodeFS.statSync(path).isDirectory(); } catch { return false; }
}

/** The name, description and body of a SKILL.md or command file (YAML front matter between --- lines). */
export function readSkillFile(path: string): { name: string | undefined; description: string; body: string } | null {
  let size: number;
  try { size = nodeFS.statSync(path).size; } catch { return null; }
  if (!(size < 512_000)) return null;
  const raw = readText(path);
  if (raw === null) return null;
  // Files saved on Windows end their lines with CR LF. The Swift split at LF only, which left a CR on every line
  // and so found no front matter in such a file; here the CR goes with the line break.
  const text = raw.replace(/\r\n/g, '\n');
  let name: string | undefined, desc = '', body = text;
  if (text.startsWith('---')) {
    const all = text.split('\n');
    const end = all.findIndex((l, i) => i > 0 && trimSpaces(l) === '---');
    if (end > 0) {
      let key = '';
      for (const line of all.slice(1, end)) {
        if (/^([A-Za-z_-]+):\s*(.*)$/.test(line)) {
          const colon = line.indexOf(':');
          key = trimSpaces(line.slice(0, colon));
          const value = trimChars(trimSpaces(line.slice(colon + 1)), '"\'');
          if (key === 'name') name = value;
          if (key === 'description' && value !== '|' && value !== '>') desc = value;
        } else if (key === 'description' && line.startsWith(' ')) {
          desc += (desc === '' ? '' : ' ') + trimSpaces(line);
        }
      }
      body = all.slice(end + 1).join('\n');
    }
  }
  return { name, description: desc, body: trimAll(body) };
}

/** Every SKILL.md under `dir` (a few levels down, for synced folders), and every .md in `commands`. */
function scan(dir: string | null, commands: string | null = null, plugin: string | null = null, depth = 1): Skill[] {
  const out: Skill[] = [];
  const named = (base: string): string => (plugin !== null ? `${plugin}:${base}` : base);
  const walk = (d: string, level: number): void => {
    const items = listDir(d);
    if (!items) return;
    for (const item of items.sort()) {
      if (item.startsWith('.')) continue;
      const sub = nodePath.join(d, item);
      if (!isDirectory(sub)) continue;
      const file = nodePath.join(sub, 'SKILL.md');
      const s = nodeFS.existsSync(file) ? readSkillFile(file) : null;
      if (s) {
        const base = s.name !== undefined && s.name !== '' ? s.name : item;
        out.push({ name: named(base), description: s.description, path: file, source: plugin ?? 'Personal', command: false });
      } else if (level < depth) {
        walk(sub, level + 1);
      }
    }
  };
  if (dir !== null) walk(dir, 1);
  const items = commands !== null ? listDir(commands) : null;
  if (commands !== null && items) {
    for (const item of items.sort()) {
      if (!item.endsWith('.md')) continue;
      const file = nodePath.join(commands, item);
      const s = readSkillFile(file);
      if (!s) continue;
      const base = item.slice(0, -3);
      const desc = s.description === '' ? (lines(s.body)[0] ?? '') : s.description;
      out.push({ name: named(base), description: prefix(desc, 240), path: file, source: plugin ?? 'Personal', command: true });
    }
  }
  return out;
}

/** Every file under `dir`, as paths from it with "/" between the parts, no deeper than `depth` levels. */
function filesUnder(dir: string, depth = Infinity): string[] {
  const out: string[] = [];
  const walk = (d: string, rel: string, level: number): void => {
    let entries: nodeFS.Dirent[];
    try { entries = nodeFS.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) { if (level < depth) walk(nodePath.join(d, e.name), r, level + 1); }
      else out.push(r);
    }
  };
  walk(dir, '', 1);
  return out;
}

/** Gemini's custom commands: every .toml file under ~/.gemini/commands; git/commit.toml is "/git:commit". They run in
    headless mode. */
function geminiCommands(dir: string): Skill[] {
  const out: Skill[] = [];
  for (const f of filesUnder(dir)) {
    if (!f.endsWith('.toml')) continue;
    const file = nodePath.join(dir, ...f.split('/'));
    const text = readText(file);
    if (text === null) continue;
    const name = f.slice(0, -5).replaceAll('/', ':');
    const m = /^\s*description\s*=\s*"([^"]*)"/m.exec(text);
    out.push({ name, description: m ? (m[1] as string) : '', path: file, source: 'Personal', command: true });
  }
  return out;
}

const claudeInitFile = (c: ChatContext): string => nodePath.join(c.workDir, 'claude-init.json');

/** Keeps what Claude Code says it loaded (its slash commands and plugins), from a chat's init event. */
export function rememberClaudeInit(c: ChatContext, o: Dict): void {
  const keep: Dict = {};
  const commands = strings(get(o, 'slash_commands'));
  if (commands) keep.slash_commands = commands;
  const plugins = dicts(get(o, 'plugins'));
  if (plugins) {
    keep.plugins = plugins.flatMap((x) => {
      const name = str(get(x, 'name')), path = str(get(x, 'path'));
      return name !== undefined && path !== undefined ? [{ name, path }] : [];
    });
  }
  if (Object.keys(keep).length === 0) return;
  try { c.fs.write(claudeInitFile(c), nsJSON(keep)); } catch { /* the "/" menu then shows what is on disk */ }
}

function claudeSkills(c: ChatContext): Skill[] {
  let out = scan(inHome('.claude/skills'), inHome('.claude/commands'), null, 3);
  let saved: Dict | undefined;
  try { saved = parseObject(Buffer.from(c.fs.read(claudeInitFile(c))).toString('utf8')); } catch { saved = undefined; }
  // The saved plugins count only when every one is {name, path} in text, as written above.
  const list = dicts(get(saved, 'plugins'));
  const plugins: [string, string][] = [];
  if (list && list.every((p) => Object.values(p).every((v) => typeof v === 'string'))) {
    for (const p of list) {
      const name = str(get(p, 'name')), path = str(get(p, 'path'));
      if (name !== undefined && path !== undefined) plugins.push([name, path]);
    }
  }
  if (!plugins.length) {
    // Before the first chat: the plugins on disk (the synced ones).
    const root = inHome('.claude/plugins/synced');
    for (const f of filesUnder(root, 4)) {
      if (!f.endsWith('.claude-plugin/plugin.json')) continue;
      const file = nodePath.join(root, ...f.split('/'));
      let o: Dict | undefined;
      try { o = parseObject(nodeFS.readFileSync(file, 'utf8')); } catch { o = undefined; }
      const name = str(get(o, 'name'));
      if (name !== undefined) plugins.push([name, nodePath.dirname(nodePath.dirname(file))]);
    }
  }
  for (const [name, path] of plugins) out = out.concat(scan(nodePath.join(path, 'skills'), nodePath.join(path, 'commands'), name));
  // Only what Claude has switched on, when it has told us.
  const on = strings(get(saved, 'slash_commands'));
  if (on) {
    const set = new Set(on);
    // Synced skills sit in ~/.claude/skills but Claude names them "<namespace>:<skill>" (anthropic-skills:pdf):
    // take Claude's own name, so the "/" we send is one it knows.
    const bySuffix = new Map<string, string>();
    for (const n of on) {
      const i = n.lastIndexOf(':');
      if (i >= 0 && !bySuffix.has(n.slice(i + 1))) bySuffix.set(n.slice(i + 1), n);
    }
    out = out.flatMap((s) => {
      if (set.has(s.name)) return [s];
      const full = s.name.includes(':') ? undefined : bySuffix.get(s.name);
      if (full === undefined) return [];
      return [{ name: full, description: s.description, path: s.path, source: full.split(':').filter((x) => x !== '')[0] ?? '', command: s.command }];
    });
  }
  return out;
}

// Names in the "/" menu: by name, capitals aside (localizedCaseInsensitiveCompare).
const byName = new Intl.Collator(undefined, { sensitivity: 'accent' });

/** The skills an agent offers, by name, for the "/" menu. */
export function skillsFor(c: ChatContext, provider: string): Skill[] {
  const h = inHome;
  let list: Skill[];
  switch (provider) {
    case 'claude-code': list = claudeSkills(c); break;
    case 'codex': list = [...scan(h('.codex/skills'), h('.codex/prompts')), ...scan(h('.agents/skills'))]; break;
    case 'cursor':
      list = [...scan(h('.cursor/skills'), h('.cursor/commands')), ...scan(h('.cursor/skills-cursor')), ...scan(h('.agents/skills'))];
      break;
    case 'gemini-cli': list = [...scan(h('.gemini/skills')), ...geminiCommands(h('.gemini/commands')), ...scan(h('.agents/skills'))]; break;
    case 'copilot': list = [...scan(h('.copilot/skills')), ...scan(h('.agents/skills'))]; break;
    case 'opencode':
      list = [...scan(h('.config/opencode/skills'), h('.config/opencode/commands')), ...scan(h('.agents/skills'))];
      break;
    case 'kiro': list = scan(h('.kiro/skills'), h('.kiro/prompts')); break;
    case 'goose': list = [...scan(h('.agents/skills')), ...scan(h('.config/goose/skills'))]; break;
    case 'cline': list = scan(h('.cline/skills')); break;
    case 'hermes': list = scan(h('.hermes/skills'), null, null, 2); break;
    default: list = [];
  }
  const seen = new Set<string>();
  return list.filter((s) => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => byName.compare(a.name, b.name));
}

export function skillsForPage(c: ChatContext, provider: string): Dict[] {
  return skillsFor(c, provider).map((s) => ({ name: s.name, description: s.description, source: s.source, command: s.command }));
}

/** The message for a picked skill: Claude runs "/name" itself; the others get the skill's instructions first. */
export function promptWithSkill(c: ChatContext, provider: string, name: string, prompt: string, native: boolean): string | null {
  const s = skillsFor(c, provider).find((k) => k.name === name);
  if (!s) return null;
  // Claude runs its skills and commands itself, Gemini its custom commands: they get "/name …".
  if (native && (provider === 'claude-code' || (provider === 'gemini-cli' && s.path.endsWith('.toml')))) {
    return `/${s.name}${prompt === '' ? '' : ` ${prompt}`}`;
  }
  const file = readSkillFile(s.path);
  if (!file) return null;
  const folder = nodePath.dirname(s.path);
  return `Use the skill “${s.name}” for this request. Its instructions follow (from ${s.path}); files it mentions are in ${folder}.\n`
    + `<skill name="${s.name}">\n`
    + `${file.body}\n`
    + '</skill>\n'
    + '\n'
    + (prompt === '' ? '(No further request: begin as the skill says.)' : prompt);
}
