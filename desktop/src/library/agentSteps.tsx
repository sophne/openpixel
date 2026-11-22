/* Set-up steps per agent. Each step: text, optional code (copyable), optional note.
   The texts are markup (bold names, monospace paths) written as JSX; the things from outside are `exe`, the command
   agents run (the host's own `mcpCommand`), which only ever lands in `code`, shown as text, and `file`, where that
   agent keeps its MCP settings on this computer, shown as text too.

   `file` is what the host's detection found or looks for (desktop/host/agents.ts, `config_file`), so the guide and
   the status badge always speak of the same file; on macOS it is the path these guides have always named. Without
   one (the page opened without the app, off the Mac) a step names the file without saying where it is. */
import type { ReactNode } from 'react';
import { isMac, platform, THIS_COMPUTER } from '../lib/platform';
import { COMPUTER, TERMINAL } from './wording';

export interface Step { text?: ReactNode; code?: string; note?: string }

/** A path as one word of a command line. Windows' shells take a path as it is, or in double quotes when it has a
 *  space (backslashes are not escapes there); the others get double quotes with the shell's own characters escaped. */
export const shq = (p: string): string => (platform === 'win32'
  ? (/^[\w.:\\/~-]+$/.test(p) ? p : `"${p}"`)
  : `"${p.replace(/(["\\$`])/g, '\\$1')}"`);

/** The settings file as the step shows it: its path when one is known, else `name` (the file's name, or what to call it). */
const where = (file: string | null, name: ReactNode): ReactNode => (file ? <span className="mono">{file}</span> : name);

export function agentSteps(id: string, exe: string, file: string | null): Step[] {
  const json = JSON.stringify({ mcpServers: { openpixel: { command: exe, args: ['--mcp'] } } }, null, 2);
  switch (id) {
    case 'chatgpt': return [
      { text: <>ChatGPT cannot start programs on {COMPUTER}: it talks to MCP servers over the internet, as a <b>connector</b> in <b>Developer mode</b> (Settings → Apps & Connectors → Advanced; names vary a little between versions, and it needs a plan that offers Developer mode).</> },
      { text: <>Start OpenPixel's web server in {TERMINAL}. It listens on {THIS_COMPUTER} only and prints an address with a secret part:</>, code: `${shq(exe)} --mcp-http 8765` },
      // PowerShell takes a quoted path for text, not for a program to start.
      ...(platform === 'win32' && shq(exe) !== exe ? [{ note: 'In PowerShell, put & and a space in front of that command.' }] : []),
      { text: <>Make that port reachable with a tunnel you trust, for example Cloudflare's free quick tunnel:</>, code: 'cloudflared tunnel --url http://127.0.0.1:8765' },
      { text: <>In ChatGPT, create a connector with the tunnel's https address followed by the <span className="mono">/mcp/…</span> path OpenPixel printed, and choose <b>No authentication</b>.</> },
      { note: 'Anyone who has the full address can edit your open model. Keep it private and stop the tunnel (Ctrl+C) when you are done.' },
    ];
    case 'codex': return [
      { text: <>Add OpenPixel with one command:</>, code: `codex mcp add openpixel -- ${shq(exe)} --mcp` },
      { text: <>Or add it to {where(file, <>Codex's <span className="mono">config.toml</span></>)} yourself:</>, code: `[mcp_servers.openpixel]\ncommand = ${JSON.stringify(exe)}\nargs = ["--mcp"]` },
      { text: <>Restart Codex. The CLI, the IDE extension and the Codex app all read this file.</> },
    ];
    case 'claude': return [
      { text: <>In the Claude desktop app open <b>Settings → Developer → Edit Config</b>. This opens <span className="mono">claude_desktop_config.json</span>.</> },
      { text: <>Add OpenPixel under <span className="mono">mcpServers</span> (merge it with any servers already there):</>, code: json },
      { text: <>Quit and reopen Claude. OpenPixel's tools appear in the tools menu of the message box.</> },
    ];
    case 'claude-code': return [
      { text: <>Run this once in {TERMINAL} (it adds OpenPixel for all your projects):</>, code: `claude mcp add --scope user openpixel -- ${shq(exe)} --mcp` },
      { text: <>Check it with <span className="mono">claude mcp list</span>, or type <span className="mono">/mcp</span> inside Claude Code.</> },
    ];
    case 'cursor': return [
      { text: <>Click <b>Add to Cursor</b> below, or open Cursor Settings → <b>Tools & MCP</b> → New MCP server.</> },
      { text: <>Or paste this into {where(file, <>Cursor's <span className="mono">mcp.json</span></>)}:</>, code: json },
      { text: <>Turn the openpixel server on in Cursor's MCP settings if it is not already.</> },
    ];
    case 'openclaw': return [
      { text: <>OpenClaw reaches MCP servers through its MCP support (the <span className="mono">mcporter</span> tool). Add a server named <b>openpixel</b> that runs this command:</>, code: `${shq(exe)} --mcp` },
      { text: <>Most MCP settings files take the same shape:</>, code: json },
      { note: 'Where this goes depends on your OpenClaw version, so check OpenClaw\'s MCP documentation.'
        + (isMac ? ' OpenPixel looks for it in ~/.openclaw/openclaw.json and ~/.mcporter/mcporter.json to show the status here.'
          : file ? ` OpenPixel looks for it in ${file} to show the status here.` : '') },
    ];
    case 'hermes': return [
      { text: <>Add OpenPixel to {where(file, <>Hermes's <span className="mono">config.yaml</span></>)}:</>, code: `mcp_servers:\n  openpixel:\n    command: ${JSON.stringify(exe)}\n    args: ["--mcp"]` },
      { text: <>Restart Hermes so it loads the new server.</> },
      { note: 'Hermes Agent changes quickly; if this key has moved, see the MCP section of its documentation. The command and argument stay the same.' },
    ];
    case 'copilot': return [
      // The one-line command is for a shell that takes single quotes. On the Mac the `code` command has to be
      // installed first; Linux packages come with it. Windows' two shells quote differently, so there the guide
      // goes through VS Code itself.
      ...(isMac ? [{ text: <>Run this once in Terminal (it adds OpenPixel to VS Code for your user; needs the <span className="mono">code</span> command from VS Code's Command Palette → <b>Shell Command: Install 'code' command in PATH</b>):</>, code: `code --add-mcp '${JSON.stringify({ name: 'openpixel', command: exe, args: ['--mcp'] })}'` }]
        : platform === 'linux' ? [{ text: <>Run this once in a terminal (it adds OpenPixel to VS Code for your user):</>, code: `code --add-mcp '${JSON.stringify({ name: 'openpixel', command: exe, args: ['--mcp'] })}'` }]
          : []),
      { text: <>{platform === 'win32' ? 'Open' : 'Or open'} the Command Palette → <b>MCP: Open User Configuration</b> and add:</>, code: JSON.stringify({ servers: { openpixel: { type: 'stdio', command: exe, args: ['--mcp'] } } }, null, 2) },
      { text: <>In Copilot Chat switch to <b>Agent</b> mode; OpenPixel's tools appear under the tools button.</> },
    ];
    case 'windsurf': return [
      { text: <>In Windsurf open <b>Settings → Cascade → MCP servers → View raw config</b>. This opens {where(file, <span className="mono">mcp_config.json</span>)}.</> },
      { text: <>Add OpenPixel under <span className="mono">mcpServers</span>:</>, code: json },
      { text: <>Press <b>Refresh</b> in the MCP panel, or restart Windsurf.</> },
    ];
    case 'gemini-cli': return [
      { text: <>Add OpenPixel to {where(file, <>Gemini CLI's <span className="mono">settings.json</span></>)} (create the file if it isn't there):</>, code: json },
      { text: <>Start <span className="mono">gemini</span> and type <span className="mono">/mcp</span>: openpixel and its tools are listed.</> },
    ];
    case 'cline': return [
      { text: <>In VS Code open Cline, click the <b>MCP Servers</b> icon, then <b>Configure MCP Servers</b>. This opens <span className="mono">cline_mcp_settings.json</span>.</> },
      { text: <>Add OpenPixel under <span className="mono">mcpServers</span>:</>, code: json },
      { text: <>Save the file; Cline reloads it and shows openpixel in its MCP list.</> },
    ];
    case 'kiro': return [
      { text: <>Open {where(file, <>Kiro's user <span className="mono">mcp.json</span></>)} (in Kiro: Command Palette → <b>Kiro: Open user MCP config</b>) and add:</>, code: json },
      { text: <>Kiro connects new servers right away; check the <b>MCP Servers</b> panel.</> },
    ];
    case 'opencode': return [
      { text: <>Add OpenPixel to {where(file, <>opencode's <span className="mono">opencode.json</span></>)}:</>, code: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { openpixel: { type: 'local', command: [exe, '--mcp'], enabled: true } } }, null, 2) },
      { text: <>Restart opencode. The tools show up with the <span className="mono">openpixel_</span> prefix.</> },
    ];
    case 'goose': return [
      { text: <>Run <span className="mono">goose configure</span>, choose <b>Add Extension → Command-line Extension</b>, name it <b>openpixel</b> and give it this command:</>, code: `${shq(exe)} --mcp` },
      { text: <>In the Goose desktop app it is <b>Settings → Extensions → Add custom extension</b>, with the same command.</> },
    ];
    case 'lm-studio': return [
      { text: <>In LM Studio open the <b>Program</b> tab in the right sidebar, then <b>Install → Edit mcp.json</b>{file ? <> (<span className="mono">{file}</span>)</> : null}.</> },
      { text: <>Add OpenPixel under <span className="mono">mcpServers</span>:</>, code: json },
      { text: <>Save, then turn on the openpixel tools in a chat. Use a model that supports tool calls.</> },
    ];
    default: return [
      { text: <>In the app's MCP (or tools) settings, add a server named <b>openpixel</b> that runs this command:</>, code: `${shq(exe)} --mcp` },
      { text: <>If it takes a settings file instead, most use this shape:</>, code: json },
      { note: 'You do this once. After that the app starts OpenPixel by itself whenever it needs it: with this window open, the edits show up here live and can be undone; with OpenPixel closed, it works in the background.' },
    ];
  }
}
