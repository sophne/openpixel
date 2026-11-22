/* The agents OpenPixel knows how to connect (app.js 2613–2631): the Agents page lists them and the chat looks up
   names and logos here.
   Logos: @lobehub/icons-static-svg (MIT), see app/web/agents/ATTRIBUTION.txt. Single-colour ones are drawn as masks. */
export interface AgentInfo { id: string; name: string; by?: string; logo: string | null; mono?: boolean; generic?: boolean }
export const AGENTS: AgentInfo[] = [
  { id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI · desktop and web app', logo: 'openai.svg', mono: true },
  { id: 'codex', name: 'Codex', by: 'OpenAI · CLI, IDE extension and app', logo: 'codex-color.svg' },
  { id: 'claude', name: 'Claude', by: 'Anthropic · desktop app', logo: 'claude-color.svg' },
  { id: 'claude-code', name: 'Claude Code', by: 'Anthropic · terminal and IDE', logo: 'claudecode-color.svg' },
  { id: 'cursor', name: 'Cursor', by: 'Anysphere · code editor', logo: 'cursor.svg', mono: true },
  { id: 'openclaw', name: 'OpenClaw', by: 'Open-source personal agent', logo: 'openclaw-color.svg' },
  { id: 'hermes', name: 'Hermes Agent', by: 'Nous Research · open-source agent', logo: 'hermesagent.svg', mono: true },
  { id: 'copilot', name: 'GitHub Copilot', by: 'GitHub · agent mode in VS Code', logo: 'githubcopilot.svg', mono: true },
  { id: 'windsurf', name: 'Windsurf', by: 'Windsurf · code editor', logo: 'windsurf.svg', mono: true },
  { id: 'gemini-cli', name: 'Gemini CLI', by: 'Google · terminal', logo: 'geminicli-color.svg' },
  { id: 'cline', name: 'Cline', by: 'Open-source coding agent for VS Code', logo: 'cline.svg', mono: true },
  { id: 'kiro', name: 'Kiro', by: 'AWS · code editor', logo: 'kiro-color.svg' },
  { id: 'opencode', name: 'opencode', by: 'Open-source coding agent · terminal', logo: 'opencode.svg', mono: true },
  { id: 'goose', name: 'Goose', by: 'Block · open-source agent', logo: 'goose.svg', mono: true },
  { id: 'lm-studio', name: 'LM Studio', by: 'Local models · desktop app', logo: 'lmstudio.svg', mono: true },
  { id: 'other-mcp', name: 'Other MCP app', by: 'Any app or agent that can add an MCP server', logo: null, generic: true },
];
