/* Finding the person's agent tools and starting them, on each system.

   macOS and Linux: apps opened from the Finder or a launcher
   don't get the shell's PATH, where these tools usually live, so a login shell is asked for it once and the usual
   install folders are added.

   Windows: an app does get the person's PATH there, so that is searched (with the folders installers use) for
   .exe and .cmd files. Tools installed with npm are .cmd files, which Node will not start without a shell, and a
   message cannot be handed safely through cmd.exe (it reads quotes, &, |, % and ^ itself and stops at a line break).
   So the .cmd is read: npm writes it in a fixed form that names the script it runs, and that script is started with
   node directly, arguments passed as a list and never as shell text. Only a .cmd of another form goes through cmd.exe,
   with every argument escaped for it; a message with line breaks is refused there instead of being cut short. */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as nodeFS from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { Provider } from './providers.ts';
import type { Env } from './types.ts';

const windows = process.platform === 'win32';

/** The person's home folder (%USERPROFILE% on Windows). Asked each time: tests point it at a folder of their own. */
export const home = (): string => os.homedir();

/** A path inside the home folder, written with "/" as in the Swift app ("~/.codex/config.toml"). */
export const inHome = (relative: string): string => nodePath.join(home(), ...relative.split('/'));

function isFile(path: string): boolean {
  try { return nodeFS.statSync(path).isFile(); } catch { return false; }
}

/** FileManager.isExecutableFile, for a file (the Swift app's also said yes to a folder one may enter; no tool is one). */
export function isExecutableFile(path: string): boolean {
  if (!isFile(path)) return false;
  if (windows) return true;
  try { nodeFS.accessSync(path, nodeFS.constants.X_OK); return true; } catch { return false; }
}

/** The kinds of file Windows can start that this module knows how to start, in PATHEXT's order. */
function windowsExtensions(): string[] {
  const ours = ['.com', '.exe', '.bat', '.cmd'];
  const listed = (envValue(process.env, 'PATHEXT') ?? '').toLowerCase().split(';').filter((e) => ours.includes(e));
  return listed.length ? listed : ours;
}

/** The file a tool's name stands for in a folder: itself, or on Windows the name with one of the extensions. */
function executableAt(base: string): string | null {
  if (!windows) return isExecutableFile(base) ? base : null;
  const exts = windowsExtensions();
  if (exts.includes(nodePath.extname(base).toLowerCase()) && isFile(base)) return base;
  for (const ext of exts) if (isFile(base + ext)) return base + ext;
  return null;
}

/** An environment variable whatever its capitals (Windows calls the search path "Path"). */
export function envValue(env: NodeJS.ProcessEnv | Env, name: string): string | undefined {
  if (!windows) return env[name];
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** Sets a variable; on Windows, where names ignore capitals, in place of any other spelling of it. */
export function setEnv(env: Env, name: string, value: string): void {
  if (windows) for (const k of Object.keys(env)) if (k.toUpperCase() === name.toUpperCase()) delete env[k];
  env[name] = value;
}

/** Where these tools usually install themselves. */
function usualFolders(): string[] {
  const h = home();
  if (windows) {
    // Claude Code's installer and uv/pipx tools; npm's global folder; Bun; Cargo.
    const appData = envValue(process.env, 'APPDATA');
    return [nodePath.join(h, '.local', 'bin'), ...(appData ? [nodePath.join(appData, 'npm')] : []),
            nodePath.join(h, '.bun', 'bin'), nodePath.join(h, '.cargo', 'bin')];
  }
  return [`${h}/.local/bin`, `${h}/.claude/local`, '/opt/homebrew/bin', '/usr/local/bin', `${h}/.npm-global/bin`,
          `${h}/.bun/bin`, `${h}/.cargo/bin`, `${h}/.volta/bin`, '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/** The login shell that knows the person's PATH. */
function loginShell(): string {
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
}
const ASK_PATH = ['-lc', 'printf %s "$PATH"'];

function joinSearchPath(shellPath: string | null): string {
  let dirs = usualFolders();
  if (windows) dirs = [...(envValue(process.env, 'PATH') ?? '').split(';').filter((d) => d !== ''), ...dirs];
  else if (shellPath !== null) dirs = [...shellPath.split(':').filter((d) => d !== ''), ...dirs];
  return [...new Set(dirs)].join(nodePath.delimiter);
}

// MARK: - starting a program

/** How to start a program: the file to run and its arguments (`verbatim`: already written out for cmd.exe). */
export interface Command { file: string; args: string[]; verbatim: boolean }

/** What an npm command file (tool.cmd beside node_modules) runs: `target` relative to its folder, by node or itself.
    Null when the file is not of that form (it sets other variables, runs something else, or names two targets). */
export function parseCmdShim(text: string): { node: boolean; target: string } | null {
  // The line that passes the arguments on:   "%_prog%"  "%dp0%\node_modules\pkg\cli.js" %*
  // (older npm:   "%~dp0\node.exe"  "%~dp0\node_modules\pkg\cli.js" %*   and   node  "%~dp0\…" %*).
  const runs = [...text.matchAll(/^(.*?)"%(?:~dp0|dp0%)\\([^"%\r\n]+)"[ \t]+%\*[ \t]*\r?$/gm)];
  if (!runs.length) return null;
  // Any variable beyond the shim's own (pnpm sets NODE_PATH, say) means the script needs more than we would give it.
  for (const m of text.matchAll(/^\s*@?\s*SET\s+"?([A-Za-z_0-9]+)=/gim)) {
    if (!['dp0', '_prog', 'pathext'].includes((m[1] as string).toLowerCase())) return null;
  }
  const progs = [...text.matchAll(/SET\s+"?_prog=([^"\r\n]*)/gi)].map((m) => (m[1] as string).trim().toLowerCase());
  if (!progs.every((p) => p === 'node' || p === '%dp0%\\node.exe' || p === '%~dp0\\node.exe')) return null;
  let found: { node: boolean; target: string } | null = null;
  for (const m of runs) {
    const before = (m[1] as string).trim().toLowerCase();
    let node: boolean;
    if (/(^|[\s&(@])("%_prog%"|"%~dp0\\node\.exe"|"%dp0%\\node\.exe"|node(\.exe)?)$/.test(before)) node = true;
    else if (before === '' || /[&(@]$/.test(before)) node = false;
    else return null;
    const target = m[2] as string;
    if (found && (found.node !== node || found.target.toLowerCase() !== target.toLowerCase())) return null;
    found = { node, target };
  }
  return found;
}

// cmd.exe reads these itself; a ^ in front makes each one plain text.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument for a command line read by cmd.exe and then by the program (the escaping cross-spawn uses): quoted
    for the program first (backslashes before a quote doubled), then every character cmd.exe acts on escaped, twice,
    because a batch file reads its arguments a second time when it passes them on with %*. */
export function cmdArgument(arg: string): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  return a.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

interface Disk { read(path: string): string | null; isFile(path: string): boolean; findNode(): string | null }

/** Windows: how to start `exe` with `args` without a shell reading the arguments, whenever that is possible.
    Throws when it is not and the arguments cannot go through cmd.exe unharmed. */
export function windowsCommand(exe: string, args: string[], disk: Disk, comspec = 'cmd.exe'): Command {
  const win = nodePath.win32;
  const ext = win.extname(exe).toLowerCase();
  if (ext !== '.cmd' && ext !== '.bat') return { file: exe, args, verbatim: false };
  const text = disk.read(exe);
  const shim = text === null ? null : parseCmdShim(text);
  if (shim) {
    const target = win.resolve(win.dirname(exe), shim.target);
    const targetExt = win.extname(target).toLowerCase();
    if (!shim.node && (targetExt === '.exe' || targetExt === '.com')) return { file: target, args, verbatim: false };
    if (shim.node && disk.isFile(target)) {
      const beside = win.join(win.dirname(exe), 'node.exe');
      const node = disk.isFile(beside) ? beside : disk.findNode();
      if (node) return { file: node, args: [target, ...args], verbatim: false };
    }
  }
  if ([exe, ...args].some((a) => /[\r\n]/.test(a))) {
    throw new Error('it starts through a Windows command file, which cannot take a message with line breaks.');
  }
  const line = [exe.replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ');
  return { file: comspec, args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

// MARK: - the tools

export interface CaptureOptions { env?: Env; timeout: number }

/** Finds and starts the person's tools. One per runner: it remembers the search path once it has asked for it. */
export class Tools {
  private searchPath: string | null = null;
  private asking: Promise<string> | null = null;

  /** The folders to search, joined as a PATH. The first call asks a login shell (not on Windows); the rest reuse it. */
  path(): Promise<string> {
    if (this.searchPath !== null) return Promise.resolve(this.searchPath);
    if (!this.asking) {
      const shell = windows ? Promise.resolve(null) : captureDirect(loginShell(), ASK_PATH, { timeout: 4 });
      this.asking = shell.then((out) => (this.searchPath ??= joinSearchPath(out)));
    }
    return this.asking;
  }

  /** The same, for the one caller that cannot wait (sign-in answers at once): asks the shell in place when the path
      is not known yet, which the model menu normally settled long before. */
  pathNow(): string {
    if (this.searchPath !== null) return this.searchPath;
    let out: string | null = null;
    if (!windows) {
      const r = spawnSync(loginShell(), ASK_PATH, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000, encoding: 'utf8' });
      out = r.status === 0 && typeof r.stdout === 'string' ? r.stdout : null;
    }
    return (this.searchPath = joinSearchPath(out));
  }

  async find(p: Provider): Promise<string | null> { return findIn(await this.path(), p); }
  findNow(p: Provider): string | null { return findIn(this.pathNow(), p); }

  /** What every tool runs with: the person's environment, the search path, and no colours. */
  async env(): Promise<Env> { return environment(await this.path()); }
  envNow(): Env { return environment(this.pathNow()); }

  /** How to start `exe` here (see the top of the file for Windows). */
  command(exe: string, args: string[]): Command {
    if (!windows) return { file: exe, args, verbatim: false };
    const searchPath = this.pathNow();
    return windowsCommand(exe, args, {
      read: (p) => { try { return nodeFS.readFileSync(p, 'utf8'); } catch { return null; } },
      isFile,
      findNode: () => findNames(searchPath, ['node']),
    }, envValue(process.env, 'ComSpec') || 'cmd.exe');
  }

  /** Runs a short command and returns what it printed (null when it fails or takes too long). */
  async capture(exe: string, args: string[], options: CaptureOptions): Promise<string | null> {
    await this.path();
    let c: Command;
    try { c = this.command(exe, args); } catch { return null; }
    return captureDirect(c.file, c.args, options, c.verbatim);
  }
}

function environment(searchPath: string): Env {
  const e: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) e[k] = v;
  setEnv(e, 'PATH', searchPath);
  e.NO_COLOR = '1';
  e.TERM = 'dumb';
  e.FORCE_COLOR = '0';
  return e;
}

function findNames(searchPath: string, names: string[]): string | null {
  for (const dir of searchPath.split(nodePath.delimiter)) {
    if (dir === '') continue;
    for (const n of names) {
      const exe = executableAt(nodePath.join(dir, n));
      if (exe) return exe;
    }
  }
  return null;
}

function findIn(searchPath: string, p: Provider): string | null {
  const onPath = findNames(searchPath, p.binaries);
  if (onPath) return onPath;
  if (p.id === 'claude-code') {
    const exe = claudeAppBinary();
    if (exe) return exe;
  }
  for (const b of p.bundled) {
    const exe = executableAt(b.startsWith('/') ? b : inHome(b));
    if (exe) return exe;
  }
  return null;
}

/** The Claude desktop app on the Mac runs Claude Code from its own copy:
    ~/Library/Application Support/Claude/claude-code/<version>/<build>/claude.app/Contents/MacOS/claude (newest version wins). */
export function claudeAppBinary(): string | null {
  const root = inHome('Library/Application Support/Claude/claude-code');
  const list = (dir: string): string[] => { try { return nodeFS.readdirSync(dir); } catch { return []; } };
  const numeric = new Intl.Collator('en', { numeric: true });
  const versions = list(root).filter((v) => /^\p{N}/u.test(v)).sort((a, b) => numeric.compare(b, a));
  for (const v of versions) {
    for (const build of list(`${root}/${v}`)) {
      const exe = `${root}/${v}/${build}/claude.app/Contents/MacOS/claude`;
      if (isExecutableFile(exe)) return exe;
    }
    if (isExecutableFile(`${root}/${v}/claude`)) return `${root}/${v}/claude`;
  }
  return null;
}

/** ChatRunner.capture: stdout as text when the command ends with status 0 within `timeout` seconds; its stderr and
    stdin go nowhere. */
function captureDirect(file: string, args: string[], options: CaptureOptions, verbatim = false): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(file, args, { env: options.env, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
                                  windowsVerbatimArguments: verbatim });
    } catch { resolve(null); return; }
    const chunks: Buffer[] = [];
    let settled = false;
    const done = (value: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      // Too slow: stop it, and stop waiting for whatever else still holds its output open.
      terminate(child);
      child.stdout?.destroy();
      done(null);
    }, options.timeout * 1000);
    child.stdout?.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', () => done(null));
    child.on('close', (code) => done(code === 0 ? Buffer.concat(chunks).toString('utf8') : null));
  });
}

// MARK: - stopping

export const isRunning = (child: ChildProcess | null): boolean =>
  child !== null && child.pid !== undefined && child.exitCode === null && child.signalCode === null;

/** Windows has no signals: taskkill ends the tool and what it started (npm tools are node running the real program). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  } catch { child.kill(); }
}

/** Process.interrupt(): what Ctrl-C sends, so the agent can close its session. */
export function interrupt(child: ChildProcess): void {
  if (windows) killTree(child); else child.kill('SIGINT');
}

/** Process.terminate() */
export function terminate(child: ChildProcess): void {
  if (windows) killTree(child); else child.kill('SIGTERM');
}

/** Process.terminationStatus: the exit code, or the number of the signal that ended it. */
export function exitStatus(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return (signal && os.constants.signals[signal]) || 1;
}
