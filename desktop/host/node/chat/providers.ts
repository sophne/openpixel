/* The agents Agent Chat knows: one entry per command-line tool, with what the model menu offers before the tool itself
   is asked. Ported from ChatRunner.providers (Chat.swift) and moreProviders (ChatAgents.swift); ids, names and plans
   are read by the page and must not change. */

export interface Model {
  id: string;
  label: string;
  /** The model's own effort levels, when they differ from the agent's (Codex lists them per model). */
  efforts?: string[];
  defaultEffort?: string;
}

export interface Provider {
  id: string;            // matches the Agents page's ids (logos, set-up state)
  name: string;
  plan: string;          // whose subscription it uses
  binaries: string[];
  /** Where the tool lives when it ships inside an app instead of on the PATH (from the home folder when relative). */
  bundled: string[];
  models: Model[];
  efforts: string[];     // empty: the tool has no effort setting
  defaultEffort: string;
  /** OpenPixel can be attached on the command line; the others need it in their own MCP settings. */
  injectsMCP: boolean;
  /** The agent can continue its own session by id; otherwise each message carries a transcript instead. */
  resumes: boolean;
}

const DEFAULT_MODEL: Model = { id: '', label: 'Default model' };
export const defaultModel = (): Model => ({ ...DEFAULT_MODEL });

export const baseProviders: Provider[] = [
  // Claude: the Claude Code command-line tool, or the copy the Claude desktop app keeps (see claudeAppBinary).
  { id: 'claude-code', name: 'Claude', plan: 'Claude subscription', binaries: ['claude'], bundled: [],
    models: [{ id: 'opus', label: 'Opus 5.5' }, { id: 'sonnet', label: 'Sonnet 5.5' },
             { id: 'fable', label: 'Fable 5.2' }, { id: 'haiku', label: 'Haiku 5.5' }],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', injectsMCP: true, resumes: true },
  // Codex ships inside the ChatGPT app (and the older Codex app) on the Mac; its models come from its own cache
  // (see codexModels).
  { id: 'codex', name: 'Codex', plan: 'ChatGPT subscription', binaries: ['codex'],
    bundled: ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
              '/Applications/Codex.app/Contents/Resources/codex', 'Applications/Codex.app/Contents/Resources/codex'],
    models: [defaultModel()],
    efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', injectsMCP: true, resumes: true },
  // Cursor's agent runs in the chat's own folder, whose .cursor/mcp.json adds OpenPixel and whose .cursor/cli.json
  // allows only OpenPixel's tools (see prepareCursorFolder): it needs nothing in the person's own settings.
  { id: 'cursor', name: 'Cursor', plan: 'Cursor plan', binaries: ['cursor-agent', 'agent'], bundled: [],
    models: [{ id: '', label: 'Auto' }], efforts: [], defaultEffort: '', injectsMCP: true, resumes: true },
  // Gemini CLI reads OpenPixel from the chat folder's .gemini/settings.json (the folder is trusted for the run) and
  // --allowed-mcp-server-names approves only OpenPixel's tools (see prepareGeminiFolder).
  { id: 'gemini-cli', name: 'Gemini CLI', plan: 'Google account', binaries: ['gemini'], bundled: [],
    models: [defaultModel()], efforts: [], defaultEffort: '', injectsMCP: true, resumes: true },
];

/* The agents beyond Claude, Codex, Cursor and Gemini (see agents.ts for how each is run and read). */
export const moreProviders: Provider[] = [
  // GitHub Copilot CLI: OpenPixel added for the run (--additional-mcp-config), only its tools allowed.
  { id: 'copilot', name: 'GitHub Copilot', plan: 'Copilot subscription', binaries: ['copilot'], bundled: [],
    models: [defaultModel()],
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'medium', injectsMCP: true, resumes: true },
  { id: 'opencode', name: 'opencode', plan: 'your opencode providers', binaries: ['opencode'],
    bundled: ['.opencode/bin/opencode'], models: [defaultModel()],
    efforts: [], defaultEffort: '', injectsMCP: true, resumes: true },
  { id: 'kiro', name: 'Kiro', plan: 'Kiro subscription', binaries: ['kiro-cli'],
    bundled: ['.local/bin/kiro-cli'], models: [defaultModel()],
    efforts: [], defaultEffort: '', injectsMCP: true, resumes: true },
  { id: 'goose', name: 'Goose', plan: 'your Goose provider', binaries: ['goose'], bundled: [],
    models: [defaultModel()], efforts: [], defaultEffort: '', injectsMCP: true, resumes: true },
  { id: 'cline', name: 'Cline', plan: 'your Cline account', binaries: ['cline'], bundled: [],
    models: [defaultModel()], efforts: [], defaultEffort: '', injectsMCP: true, resumes: false },
  { id: 'hermes', name: 'Hermes Agent', plan: 'your Hermes provider', binaries: ['hermes'], bundled: [],
    models: [defaultModel()], efforts: [], defaultEffort: '', injectsMCP: true, resumes: false },
];

export const providers: Provider[] = [...baseProviders, ...moreProviders];

export const provider = (id: string): Provider | undefined => providers.find((p) => p.id === id);
export const isMore = (id: string): boolean => moreProviders.some((p) => p.id === id);
