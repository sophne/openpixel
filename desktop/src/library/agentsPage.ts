/* ---------------------------------------------------------------- Agents page (app.js 2632–2640, 2726–2810, 2836–2900)
   The list of agents with their statuses, asked from the app every 2.5 seconds while the page shows, and each
   agent's set-up guide. The drawing is library/Agents.tsx; the steps are library/agentSteps.tsx. */
import { openModal } from '../kit';
import { nativeAction } from '../lib/host';
import { timeAgo } from '../lib/format';
import { changed, store } from '../lib/store';
import { AGENTS, type AgentInfo } from '../state/agents';
import { agentSteps, shq, type Step } from './agentSteps';
import { showHome } from './homePage';

/** One connection of an agent to the app (AgentRegistry.snapshot). */
interface AgentSession {
  id?: unknown; client: string; version?: string; transport?: string; agent?: string | null;
  connected: number; calls: number; last_tool?: string; last_call?: number; open?: boolean;
}
interface AgentSetup { installed?: boolean; configured?: boolean; config_file?: string | null; config_exists?: boolean }
/** What the app's `agents` action answers. */
interface AgentsData {
  sessions?: AgentSession[];
  last_seen?: Record<string, number>;
  setup?: Record<string, AgentSetup>;
  command?: string;
}
export const agentsState: { data: AgentsData | null; timer: ReturnType<typeof setInterval> | undefined } = { data: null, timer: undefined };
/** The Agents page stops asking for statuses when another page shows. */
export function stopAgentsPolling(): void { clearInterval(agentsState.timer); }

export function exeCommand(): string { return (agentsState.data && agentsState.data.command) || '/Applications/OpenPixel.app/Contents/MacOS/OpenPixel'; }

/* Every guide (but ChatGPT's, which can't change anything on this Mac) starts with a prompt to paste into the agent:
   it then adds OpenPixel to its own settings. The hint says where that agent keeps them, or the one-line command. */
const AGENT_HINTS: Record<string, (exe: string) => string> = {
  codex: (exe) => `Easiest: run \`codex mcp add openpixel -- ${shq(exe)} --mcp\` (or add it to ~/.codex/config.toml).`,
  claude: () => 'Your settings file is ~/Library/Application Support/Claude/claude_desktop_config.json (under "mcpServers").',
  'claude-code': (exe) => `Easiest: run \`claude mcp add --scope user openpixel -- ${shq(exe)} --mcp\``,
  cursor: () => 'Your MCP settings are in ~/.cursor/mcp.json (under "mcpServers").',
  openclaw: () => 'Use your MCP support (mcporter), or ~/.openclaw/openclaw.json.',
  hermes: () => 'Your MCP settings are under "mcp_servers" in ~/.hermes/config.yaml.',
  copilot: () => 'In VS Code this is the user mcp.json (Command Palette: "MCP: Open User Configuration"), under "servers", with type "stdio".',
  windsurf: () => 'Your MCP settings are in ~/.codeium/windsurf/mcp_config.json (under "mcpServers").',
  'gemini-cli': () => 'Your MCP settings are in ~/.gemini/settings.json (under "mcpServers").',
  cline: () => 'Your MCP settings are in cline_mcp_settings.json (under "mcpServers").',
  kiro: () => 'Your MCP settings are in ~/.kiro/settings/mcp.json (under "mcpServers").',
  opencode: () => 'Your settings are in ~/.config/opencode/opencode.json: add it under "mcp" as a "local" server whose command is the program followed by --mcp.',
  goose: () => 'Add it as a stdio extension under "extensions" in ~/.config/goose/config.yaml (or with goose configure).',
  'lm-studio': () => 'Your MCP settings are in ~/.lmstudio/mcp.json (under "mcpServers").',
};
export const AGENT_PROMPT_CAVEAT: Record<string, string> = {
  claude: 'Claude needs access to files on your Mac for this (for example the Filesystem extension); otherwise follow the steps below.',
  'lm-studio': 'This needs a model with file tools; otherwise follow the steps below.',
};
function agentPrompt(a: AgentInfo): string | null {
  if (a.id === 'chatgpt' || a.id === 'other') return null;
  const exe = exeCommand();
  const hint = AGENT_HINTS[a.id] ? AGENT_HINTS[a.id](exe) : '';
  return ['Please add the OpenPixel MCP server to your own MCP settings, for my user account:', '',
    '- Name: openpixel', `- Command: ${exe}`, '- Argument: --mcp',
    '- Type: local (stdio). It needs no API key or environment variables.', ...(hint ? [`- ${hint}`] : []), '',
    'Keep every MCP server that is already there. When it is done, tell me how to reload you so the openpixel tools load, then call its get_model_info tool to check that it works.'].join('\n');
}

/** A row's badge: its classes and words, and what the agent last did (the badge's tooltip), as plain text: it holds
 *  the name of the agent's last tool, which is the agent's to choose. */
export interface AgentStatus { cls: string; label: string; act: string }
const callsText = (calls: number): string => `${calls} call${calls === 1 ? '' : 's'}`;
function agentStatus(a: AgentInfo): AgentStatus {
  // Two states: Connected (OpenPixel is in the app's settings, or it is talking to this window now) and Disconnected.
  if (a.generic) return { cls: 'any', label: 'Any app', act: 'Add the command once in its MCP settings' };
  const d = agentsState.data || {};
  const live = (d.sessions || []).filter((s) => s.open && s.agent === a.id);
  const setup = (d.setup || {})[a.id] || {};
  const seen = (d.last_seen || {})[a.id];
  if (live.length) {
    const calls = live.reduce((n, s) => n + s.calls, 0);
    const last = Math.max(...live.map((s) => s.last_call || s.connected));
    const tool = live.map((s) => s.last_tool).find(Boolean);
    return { cls: 'connected live', label: live.length > 1 ? `Connected ×${live.length}` : 'Connected',
      act: calls ? `${callsText(calls)} · ${timeAgo(last)}${tool ? `last: ${tool}` : ''}`
        : `Ready, no calls yet · connected ${timeAgo(Math.min(...live.map((s) => s.connected)))}` };
  }
  if (setup.configured) return { cls: 'connected', label: 'Connected', act: seen ? `Last used ${timeAgo(seen)}` : 'Not used yet' };
  if (a.id === 'chatgpt') return { cls: 'disconnected', label: 'Disconnected', act: 'Needs a tunnel (see How to connect)' };
  if (setup.installed) return { cls: 'disconnected', label: 'Disconnected', act: 'Installed, not set up yet' };
  return { cls: 'missing', label: 'Not found', act: '' }; // the status says it all
}

export async function loadAgents(): Promise<void> {
  try { agentsState.data = await nativeAction('agents'); } catch (e) { agentsState.data = null; }
  renderAgents();
}
/** A row of #agents-body: `key` keeps a row the same element from one reading of the statuses to the next. */
export interface AgentRowData { key: string; a: AgentInfo; st: AgentStatus }
export const agentRows = store({ rows: [] as AgentRowData[] });
function renderAgents(): void {
  const d = agentsState.data || {};
  const rows: { a: AgentInfo; st: AgentStatus }[] = AGENTS.map((a) => ({ a, st: agentStatus(a) }));
  // Clients OpenPixel doesn't know by name still show up while connected.
  for (const s of (d.sessions || []).filter((x) => x.open && !x.agent)) {
    rows.push({ a: { id: 'other', name: s.client === 'unknown' ? 'Unknown agent' : s.client, by: `MCP client ${s.version || ''} · ${s.transport}`, logo: null },
      st: { cls: 'connected live', label: 'Connected', act: s.calls ? `${callsText(s.calls)} · ${timeAgo(s.last_call || s.connected)}` : 'Ready, no calls yet' } });
  }
  // This runs every 2.5 seconds while the page is open, so the rows are kept and only their statuses change.
  // Rebuilding them dropped keyboard focus and hover, and the list's height for a moment, which threw the
  // page's scroll back to the top.
  const seen = new Map<string, number>();
  agentRows.rows = rows.map(({ a, st }) => {
    let key = a.id === 'other' ? `other:${a.name}` : a.id;
    const n = (seen.get(key) || 0) + 1; seen.set(key, n);
    if (n > 1) key += `#${n}`;
    return { key, a, st };
  });
  changed(agentRows);
}

/** What #agent-info shows; `seq` counts its openings (0: empty, as the page starts), each one drawn anew. */
export const agentInfo = store({
  seq: 0,
  a: null as AgentInfo | null,
  st: null as AgentStatus | null,
  prompt: null as string | null,
  steps: [] as Step[],
  /** The app's own path, for Add to Cursor. */
  exe: '',
  setup: null as AgentSetup | null,
});
export function showAgentInfo(a: AgentInfo): void {
  Object.assign(agentInfo, {
    seq: agentInfo.seq + 1, a, st: agentStatus(a), prompt: agentPrompt(a), steps: agentSteps(a.id, exeCommand()), exe: exeCommand(),
    setup: ((agentsState.data || {}).setup || {})[a.id] || null,
  });
  changed(agentInfo);
  openModal('#agent-info');
}
export function showAgentHelp(): Promise<void> { return showHome('agents'); }
