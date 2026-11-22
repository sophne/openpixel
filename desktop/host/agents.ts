/* What the Agents page shows: live connections to this window (each `openpixel --mcp` process introduces
   itself with the agent's name from the MCP handshake) and, per known agent app, whether it is installed
   and whether its settings already mention OpenPixel. Settings files are only read, never changed. */
import type { Platform } from './platform';
import { type Json, int, str, text } from './util';

export interface Session {
  id: number;
  client: string;
  version: string;
  transport: string;
  pid: number;
  connected: number;
  lastCall?: number;
  lastTool: string;
  calls: number;
  open: boolean;
  closed?: number;
}

/** Where each agent keeps its MCP settings, and how to tell it is installed. Paths are from the home folder;
    `apps` are macOS app bundles, `tools` command-line programs. */
export const KNOWN: { id: string; configs: string[]; apps: string[]; tools: string[]; folders: string[] }[] = [
  { id: 'chatgpt', configs: [], apps: ['ChatGPT.app'], tools: [], folders: [] },
  { id: 'codex', configs: ['.codex/config.toml'], apps: ['Codex.app'], tools: ['codex'], folders: ['.codex'] },
  { id: 'claude', configs: ['Library/Application Support/Claude/claude_desktop_config.json'], apps: ['Claude.app'], tools: [], folders: [] },
  { id: 'claude-code', configs: ['.claude.json', '.claude/settings.json'], apps: [], tools: ['claude'], folders: ['.claude'] },
  { id: 'cursor', configs: ['.cursor/mcp.json'], apps: ['Cursor.app'], tools: ['cursor'], folders: ['.cursor'] },
  { id: 'openclaw', configs: ['.openclaw/openclaw.json', '.mcporter/mcporter.json', '.openclaw/mcp.json'], apps: [], tools: ['openclaw', 'mcporter'], folders: ['.openclaw'] },
  { id: 'hermes', configs: ['.hermes/config.yaml'], apps: [], tools: ['hermes'], folders: ['.hermes'] },
  { id: 'copilot', configs: ['Library/Application Support/Code/User/mcp.json', 'Library/Application Support/Code/User/settings.json'],
    apps: ['Visual Studio Code.app'], tools: ['code'], folders: [] },
  { id: 'windsurf', configs: ['.codeium/windsurf/mcp_config.json'], apps: ['Windsurf.app'], tools: ['windsurf'], folders: ['.codeium/windsurf'] },
  { id: 'gemini-cli', configs: ['.gemini/settings.json'], apps: [], tools: ['gemini'], folders: ['.gemini'] },
  { id: 'cline', configs: ['Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json'], apps: [], tools: [],
    folders: ['Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev'] },
  { id: 'kiro', configs: ['.kiro/settings/mcp.json'], apps: ['Kiro.app'], tools: ['kiro'], folders: ['.kiro'] },
  { id: 'opencode', configs: ['.config/opencode/opencode.json', '.config/opencode/config.json'], apps: [], tools: ['opencode'], folders: ['.config/opencode'] },
  { id: 'goose', configs: ['.config/goose/config.yaml'], apps: ['Goose.app'], tools: ['goose'], folders: ['.config/goose'] },
  { id: 'lm-studio', configs: ['.lmstudio/mcp.json'], apps: ['LM Studio.app'], tools: [], folders: ['.lmstudio'] },
];

/** Which known agent a client name belongs to. */
export function agentID(client: string): string | null {
  const c = client.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => c.includes(w));
  if (has('claude-code', 'claude code')) return 'claude-code';
  if (has('claude')) return 'claude';
  if (has('cursor')) return 'cursor';
  if (has('codex')) return 'codex';
  if (has('openclaw', 'mcporter', 'clawd')) return 'openclaw';
  if (has('hermes')) return 'hermes';
  if (has('cline')) return 'cline';
  if (has('windsurf', 'codeium')) return 'windsurf';
  if (has('gemini')) return 'gemini-cli';
  if (has('kiro')) return 'kiro';
  if (has('opencode')) return 'opencode';
  if (has('goose')) return 'goose';
  if (has('lm studio', 'lmstudio')) return 'lm-studio';
  if (has('visual studio code', 'vscode', 'copilot')) return 'copilot';
  if (has('openai', 'chatgpt')) return 'chatgpt';
  return null;
}

/** A path from `KNOWN` on this system. The Mac's `Library/Application Support/…` is where apps keep their settings
    there; on Windows that is `%APPDATA%` (the folder OpenPixel's own data folder sits in), on Linux `~/.config`. */
export function homePath(platform: Platform, relative: string): string {
  const { paths, os } = platform;
  const mac = 'Library/Application Support/';
  const parts = (p: string): string[] => p.split('/');
  if (os !== 'darwin' && relative.startsWith(mac)) {
    const base = os === 'win32' ? paths.dirname(paths.data) : paths.join(paths.home, '.config');
    return paths.join(base, ...parts(relative.slice(mac.length)));
  }
  return paths.join(paths.home, ...parts(relative));
}

/** Per known agent: installed, configured, and the settings file to show. */
export function detectSetup(platform: Platform): Json {
  const { fs, paths, os } = platform;
  const home = paths.home;
  const isFile = (p: string): boolean => fs.stat(p)?.isDirectory === false;
  const binDirs = ['/opt/homebrew/bin', '/usr/local/bin', paths.join(home, '.local', 'bin'), paths.join(home, '.npm-global', 'bin'),
    paths.join(home, '.bun', 'bin'), paths.join(home, '.claude', 'local'), paths.join(home, '.cargo', 'bin')];
  // Windows starts a tool through its extension (claude.exe, or the claude.cmd that npm puts in %APPDATA%\npm).
  const endings = os === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  if (os === 'win32') binDirs.push(paths.join(paths.dirname(paths.data), 'npm'));
  const out: Json = {};
  for (const a of KNOWN) {
    const configPaths = a.configs.map((c) => homePath(platform, c));
    let configured = false;
    let configFile: string | undefined;
    for (const p of configPaths) {
      if (!fs.exists(p)) continue;
      configFile ??= p;
      // Large files are read in full only up to 8 MB.
      if ((fs.stat(p)?.size ?? 0) > 8 << 20) continue;
      let content: string | undefined;
      try {
        content = text(fs.read(p));
      } catch {
        continue;
      }
      if (content.toLowerCase().includes('openpixel')) {
        configured = true;
        configFile = p;
        break;
      }
    }
    const installed = a.apps.some((app) => fs.exists('/Applications/' + app) || fs.exists(paths.join(home, 'Applications', app)))
      || a.tools.some((t) => binDirs.some((d) => endings.some((x) => isFile(paths.join(d, t + x)))))
      || a.folders.some((f) => fs.exists(homePath(platform, f)));
    const shown = configFile ?? configPaths[0];
    out[a.id] = {
      installed, configured,
      config_file: shown === undefined ? null : shown.replaceAll(home, '~'),
      config_exists: configFile !== undefined,
    };
  }
  return out;
}

export class AgentRegistry {
  private sessions = new Map<number, Session>();
  /** Last time each agent was seen, kept between launches. */
  private lastSeen: Record<string, number> = {};
  private readonly store: string;
  private readonly platform: Platform;

  constructor(platform: Platform, folder: string) {
    this.platform = platform;
    this.store = platform.paths.join(folder, 'agents.json');
    try {
      const o: unknown = JSON.parse(text(platform.fs.read(this.store)));
      if (typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'number')) {
        this.lastSeen = o as Record<string, number>;
      }
    } catch {
      // Nobody seen yet.
    }
  }

  opened(id: number): void {
    this.sessions.set(id, { id, client: 'unknown', version: '', transport: 'stdio', pid: 0, connected: this.platform.now(), lastTool: '', calls: 0, open: true });
  }

  closed(id: number): void {
    const s = this.sessions.get(id);
    if (s) {
      s.open = false;
      s.closed = this.platform.now();
      this.seen(s.client);
    }
    // Keep the 20 most recent closed sessions.
    const old = [...this.sessions.values()].filter((x) => !x.open).sort((a, b) => (b.closed ?? -Infinity) - (a.closed ?? -Infinity)).slice(20);
    for (const x of old) this.sessions.delete(x.id);
  }

  hello(id: number, info: Json): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.client = str(info.name) || 'unknown';
    s.version = str(info.version) ?? '';
    s.transport = str(info.transport) ?? 'stdio';
    s.pid = int(info.pid) ?? 0;
    this.seen(s.client);
  }

  called(id: number, tool: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.calls += 1;
    s.lastCall = this.platform.now();
    s.lastTool = tool;
    this.seen(s.client);
  }

  private seen(client: string): void {
    if (client === 'unknown') return;
    this.lastSeen[agentID(client) ?? client] = this.platform.now();
    try {
      this.platform.fs.write(this.store, JSON.stringify(this.lastSeen));
    } catch {
      // Remembered for this run only.
    }
  }

  snapshot(includeSetup = true): Json {
    const sessions = [...this.sessions.values()].sort((a, b) => b.connected - a.connected).map((s) => {
      const o: Json = {
        id: s.id, client: s.client, version: s.version, transport: s.transport, pid: s.pid,
        agent: agentID(s.client), connected: s.connected,
        calls: s.calls, last_tool: s.lastTool, open: s.open,
      };
      if (s.lastCall !== undefined) o.last_call = s.lastCall;
      if (s.closed !== undefined) o.closed = s.closed;
      return o;
    });
    const out: Json = { sessions, last_seen: { ...this.lastSeen } };
    if (includeSetup) out.setup = detectSetup(this.platform);
    return out;
  }
}
