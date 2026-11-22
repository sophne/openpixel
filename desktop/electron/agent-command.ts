import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* The command agents run: the native `openpixel` program (core/app) shipped inside the app.

   - `shippedAgentProgram`: where that program is in this copy of the app.
   - `agentCommand`: the path agents are told to use. On macOS and Windows that is the program inside the app. A
     Linux AppImage's own files move on every launch, so at every start a packaged Linux build keeps a copy at
     <data folder>/bin/openpixel (~/.local/share/OpenPixel/bin/openpixel) and names that one.
   - `handOverToAgentProgram`: people's agent settings may still name the app itself, as the Mac app's did
     (`/Applications/OpenPixel.app/Contents/MacOS/OpenPixel --mcp`). Started like that, this process becomes a
     stand-in for the native program: same arguments, same input and output, same exit code, and no window.

   Nothing here needs Electron: main.ts calls `handOverToAgentProgram` before it touches the app. */

export interface AppLocation {
  /** The desktop/ folder (the app's root; inside app.asar once installed). */
  desktopFolder: string;
  packaged: boolean;
  resourcesPath: string;
}

const exeName = (platform: NodeJS.Platform): string => (platform === 'win32' ? 'openpixel.exe' : 'openpixel');

/** The native program of this copy: the one named in OPENPIXEL_MCP, the one shipped inside the installed app, or a
    local build (release before debug; the release path when there is neither). */
export function shippedAgentProgram(o: AppLocation, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const exe = exeName(platform);
  if (env.OPENPIXEL_MCP) return path.resolve(env.OPENPIXEL_MCP);
  if (o.packaged) return path.join(o.resourcesPath, 'core', exe);
  const builds = ['release', 'debug'].map((kind) => path.join(o.desktopFolder, '..', 'core', 'target', kind, exe));
  return builds.find((p) => fs.existsSync(p)) ?? (builds[0] as string);
}

/** The per-user data folder on Linux, by the rule of desktop/host/node/platform-node.ts and core/app/src/paths.rs:
    $XDG_DATA_HOME/OpenPixel when that is a full path, else ~/.local/share/OpenPixel. */
export function linuxDataFolder(home: string = os.homedir(), env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  return path.posix.join(xdg !== undefined && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.local', 'share'), 'OpenPixel');
}

const sha256 = (file: string): string => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Keeps a copy of `shipped` at `<dataFolder>/bin/<its name>` and returns that path. The copy is made when it is
    missing or differs: size and time are compared first, and only when those differ the content, so a start costs
    two `stat` calls. It is written beside the old one and moved over it, so an agent that runs the old copy at
    that moment keeps running it, and it stays executable. Throws Error(text) when the copy cannot be made. */
export function stableAgentProgram(shipped: string, dataFolder: string): string {
  const folder = path.join(dataFolder, 'bin');
  const target = path.join(folder, path.basename(shipped));
  const from = fs.statSync(shipped);
  let to: fs.Stats | null = null;
  try { to = fs.statSync(target); } catch { /* not there yet */ }
  const sameLook = to !== null && to.isFile() && to.size === from.size && Math.abs(to.mtimeMs - from.mtimeMs) < 2000;
  if (!sameLook) {
    if (to !== null && to.isFile() && to.size === from.size && sha256(target) === sha256(shipped)) {
      // The same program with another date (copied by hand, restored from a backup): only the date is put right.
      fs.utimesSync(target, from.atime, from.mtime);
    } else {
      fs.mkdirSync(folder, { recursive: true });
      const tmp = path.join(folder, `.${path.basename(shipped)}.${process.pid}.tmp`);
      try {
        fs.copyFileSync(shipped, tmp);
        fs.chmodSync(tmp, 0o755);
        fs.utimesSync(tmp, from.atime, from.mtime);
        fs.renameSync(tmp, target);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
    }
  }
  // Whatever happened to its mode since: agents must be able to start it.
  if ((fs.statSync(target).mode & 0o111) !== 0o111) fs.chmodSync(target, 0o755);
  return target;
}

/** What the Agents page shows and Agent Chat starts. */
export function agentCommand(o: AppLocation, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const shipped = shippedAgentProgram(o, env, platform);
  if (!o.packaged || platform !== 'linux' || env.OPENPIXEL_MCP) return shipped;
  try {
    return stableAgentProgram(shipped, linuxDataFolder(os.homedir(), env));
  } catch (e) {
    // A home folder that cannot be written to: the program inside the app still works for this launch.
    process.stderr.write(`OpenPixel: could not keep a copy of the agent program in the data folder: ${(e as Error).message}\n`);
    return shipped;
  }
}

/** The arguments an agent started the app's own executable with, when they ask for the MCP server; else null.
    Started as `electron <app folder> …` (development), the app folder is not one of them. */
export function agentArguments(argv: string[], packaged: boolean): string[] | null {
  const list = argv.slice(1);
  if (!list.includes('--mcp') && !list.includes('--mcp-http')) return null;
  if (!packaged) {
    const i = list.findIndex((a) => !a.startsWith('-'));
    // The first plain word is the app, unless it is the port of `--mcp-http <port>`.
    if (i >= 0 && list[i - 1] !== '--mcp-http' && list[i - 1] !== '--token') list.splice(i, 1);
  }
  return list;
}

/** `OpenPixel --mcp` / `OpenPixel --mcp-http [port]`: runs the native program in this process's place and exits with
    its exit code. It never returns then. Nothing is written to standard output here (that is the MCP channel), no
    window opens, and the app is not asked whether another copy runs: an agent's server lives next to the window.
    On Windows, Electron itself writes one blank line ("\r\n") to standard output at every start, before this runs;
    nothing here can take it back. MCP clients skip or report a blank line and go on, and agents on Windows are
    given the program inside the app (agentCommand), which never writes it.
    The wait is synchronous on purpose: while it lasts, Electron does not get to start anything of its own. */
export function handOverToAgentProgram(o: AppLocation, argv: string[] = process.argv): void {
  const list = agentArguments(argv, o.packaged);
  if (list === null) return;
  const program = shippedAgentProgram(o);
  const r = spawnSync(program, list, { stdio: 'inherit', windowsHide: true });
  if (r.error) {
    process.stderr.write(`OpenPixel: could not start its agent program (${program}): ${r.error.message}\n`);
    process.exit(127);
  }
  // Ended by a signal: say so the way a shell would.
  process.exit(r.status ?? 128 + (os.constants.signals[r.signal as NodeJS.Signals] ?? 1));
}
