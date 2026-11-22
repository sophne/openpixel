/* `Platform` on Node, all but the window: files, paths, the clock, the network, and the agents' side of a desktop
   (the socket, the test agents). Electron adds `os`, `ui` (its dialogs, clipboard and window) and the command agents
   run, and is done. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LocalServices, Platform, PlatformFS, PlatformPaths } from '../platform';
import { listen, listenAddress, pipeName } from './bridge';
import { TestAgents } from './test-agents';

export interface NodePlatformOptions {
  /** A UI-test run: its folder is the data folder, `Files` inside it the files folder, `op.sock` there the socket. */
  uiTest?: string;
  /** A screenshot run (the host keeps its library in a throwaway folder and opens no socket). */
  screenshot?: boolean;
  /** For tests: another home folder, environment or system than this process's. */
  home?: string;
  env?: Record<string, string | undefined>;
  os?: NodeJS.Platform;
}

/** The Node half of Platform, where the agents' socket is for this run, and the agents' side (`local`). */
export type NodePlatform = Pick<Platform, 'fs' | 'paths' | 'now' | 'fetchText'> & { socketPath: string; local: LocalServices };

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const nodeFS: PlatformFS = {
  read(file) {
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch (e) {
      throw new Error(errorText(e));
    }
  },
  write(file, data) {
    // Beside the file, then over it: a crash never leaves half a file.
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw new Error(errorText(e));
    }
  },
  exists: (file) => fs.existsSync(file),
  stat(file) {
    try {
      const s = fs.statSync(file);
      return { mtimeMs: s.mtimeMs, size: s.size, isDirectory: s.isDirectory() };
    } catch {
      return null;
    }
  },
  list(folder) {
    try {
      return fs.readdirSync(folder);
    } catch {
      return [];
    }
  },
  createDirAll(folder, mode) {
    try {
      fs.mkdirSync(folder, mode === undefined ? { recursive: true } : { recursive: true, mode });
    } catch (e) {
      throw new Error(errorText(e));
    }
  },
  remove(file) {
    try {
      fs.rmSync(file, { recursive: true, force: true });
    } catch (e) {
      throw new Error(errorText(e));
    }
  },
  rename(from, to) {
    try {
      fs.renameSync(from, to);
    } catch (e) {
      throw new Error(errorText(e));
    }
  },
};

/** The per-user data folder, by the same rules as the MCP program (core/app/src/paths.rs):
    macOS ~/Library/Application Support/OpenPixel, Windows %APPDATA%\OpenPixel, Linux $XDG_DATA_HOME/OpenPixel
    (~/.local/share/OpenPixel when that is not set to a full path). */
export function dataFolder(system: NodeJS.Platform, home: string, env: Record<string, string | undefined>): string {
  const p = system === 'win32' ? path.win32 : path.posix;
  if (system === 'darwin') return p.join(home, 'Library', 'Application Support', 'OpenPixel');
  if (system === 'win32') return p.join(env.APPDATA || p.join(home, 'AppData', 'Roaming'), 'OpenPixel');
  const xdg = env.XDG_DATA_HOME;
  return p.join(xdg !== undefined && p.isAbsolute(xdg) ? xdg : p.join(home, '.local', 'share'), 'OpenPixel');
}

/** Where the window listens for agents: `OPENPIXEL_SOCKET` when set, else `openpixel.sock` in the data folder
    (on Windows the pipe named after the person). */
export function socketPath(system: NodeJS.Platform, data: string, env: Record<string, string | undefined>, user: () => string): string {
  if (env.OPENPIXEL_SOCKET) return env.OPENPIXEL_SOCKET;
  if (system === 'win32') return pipeName(env.USERNAME ?? user());
  return path.posix.join(data, 'openpixel.sock');
}

/** The person's Documents folder: `~/Documents`, or on Linux what `~/.config/user-dirs.dirs` names (as the MCP
    program finds it). On Windows a Documents folder moved elsewhere is not followed. */
export function documentsFolder(system: NodeJS.Platform, home: string, env: Record<string, string | undefined>): string {
  const p = system === 'win32' ? path.win32 : path.posix;
  const usual = p.join(home, 'Documents');
  if (system !== 'linux') return usual;
  const config = env.XDG_CONFIG_HOME !== undefined && p.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : p.join(home, '.config');
  let dirs: string;
  try {
    dirs = fs.readFileSync(p.join(config, 'user-dirs.dirs'), 'utf8');
  } catch {
    return usual;
  }
  const m = /^\s*XDG_DOCUMENTS_DIR\s*=\s*"([^"]*)"/m.exec(dirs);
  if (!m || m[1] === undefined) return usual;
  const named = m[1].startsWith('$HOME/') ? p.join(home, m[1].slice(6)) : m[1];
  // "$HOME/" alone means the person has no such folder.
  return p.isAbsolute(named) && p.resolve(named) !== p.resolve(home) ? named : usual;
}

export function nodePaths(options: NodePlatformOptions = {}): PlatformPaths {
  const system = options.os ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const p = system === 'win32' ? path.win32 : path.posix;
  const uiTest = options.uiTest === undefined ? null : p.resolve(options.uiTest);
  return {
    home,
    data: uiTest ?? dataFolder(system, home, env),
    files: uiTest !== null ? p.join(uiTest, 'Files') : p.join(documentsFolder(system, home, env), 'OpenPixel'),
    temp: os.tmpdir(),
    sep: p.sep,
    join: (...parts) => p.join(...parts),
    dirname: (file) => p.dirname(file),
    basename: (file, ext) => p.basename(file, ext),
    extname: (file) => p.extname(file),
    normalize(file) {
      const expanded = file === '~' ? home : file.startsWith('~/') || (system === 'win32' && file.startsWith('~\\')) ? p.join(home, file.slice(2)) : file;
      return p.resolve(expanded);
    },
  };
}

/** GET over the network; null when offline, blocked, slow (10 s) or not 200. */
export async function fetchText(url: string, headers?: Record<string, string>): Promise<string | null> {
  try {
    const init: RequestInit = { signal: AbortSignal.timeout(10_000), cache: 'no-store' };
    if (headers) init.headers = headers;
    const response = await fetch(url, init);
    return response.status === 200 ? await response.text() : null;
  } catch {
    return null;
  }
}

/** What Electron's main process hands to `createHost` as the Node half of its Platform:
    `createHost({ platform: { os, ...nodePlatform({ uiTest, screenshot }), ui, desktop: { mcpCommand, socketPath } }, core, … })`. */
export function nodePlatform(options: NodePlatformOptions = {}): NodePlatform {
  const system = options.os ?? process.platform;
  const env = options.env ?? process.env;
  const paths = nodePaths(options);
  const agents = new TestAgents();
  return {
    fs: nodeFS,
    paths,
    now: () => Date.now() / 1000,
    fetchText,
    // A test run's socket is its own, whatever OPENPIXEL_SOCKET says.
    socketPath: options.uiTest !== undefined
      ? listenAddress(paths.join(paths.data, 'op.sock'), system)
      : socketPath(system, paths.data, env, () => os.userInfo().username),
    local: {
      listen,
      spawnAgent: (o) => agents.spawn(o),
      stopAgents: () => agents.stop(),
      killAgents: () => agents.kill(),
    },
  };
}
