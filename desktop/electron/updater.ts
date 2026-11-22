import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppUpdater } from 'electron-updater';
import type { UpdateSettings } from '../host/platform';

/* Updates inside the app (electron-updater).

   Whether a newer version is out is the host's question (desktop/host/updates.ts reads the release feed through the
   core). This file is what happens when the person, or an agent with install=true, asks for the update dialog:

   - Where this copy can install an update by itself, the dialog offers to download it. The download runs in the
     background (progress on the window's taskbar or Dock icon, and in words when the dialog is asked for again);
     when it is there and verified, a second dialog offers "Restart to Update". Only that button installs: nothing
     is installed on quitting, and nothing without the person confirming.
   - Everywhere else the dialog offers the download page.

   A copy installs by itself when the release build said it may (`openpixel.selfUpdate` in the packaged
   package.json, stamped by desktop/scripts/release-build.mjs) and the system agrees:
     Windows: the NSIS installer (always).  Linux: only when started from the AppImage (a .deb belongs to the
     system's package manager).  macOS: only builds signed with a Developer ID (macOS refuses to swap in an update
     whose signature it cannot check), which is why the release build decides.

   Which release electron-updater picks (its defaults, kept): a stable build is only ever offered the newest
   stable release; a pre-release build (a version with "-", e.g. 1.3.0-beta.1) is offered the newest release of
   any kind that is newer than itself (`allowPrerelease` is on exactly for pre-release builds), never an older one
   (`allowDowngrade` is off). The dialog names the version electron-updater will install, not the feed's.

   OPENPIXEL_UPDATE_FEED: the address of a folder (http://127.0.0.1:8123/) that holds `latest*.yml` and the
   installers. When set, both the host's check and electron-updater read that folder instead of GitHub's newest
   release, in packaged and development builds alike. It is for testing the update path (tests/update-e2e.mjs);
   whoever can set a program's environment can already run anything as that person, so it opens nothing new. */

export const UPDATE_FEED_ENV = 'OPENPIXEL_UPDATE_FEED';
/** OPENPIXEL_NO_UPDATE_CHECK=1 (anything but empty or 0): this copy does not look for a newer version at launch.
    "Check for Updates…" and an agent's check_for_updates still ask when the person or the agent says so. */
export const NO_UPDATE_CHECK_ENV = 'OPENPIXEL_NO_UPDATE_CHECK';

/** The header electron-updater would fill with an ID of this installation, and the value it gets instead. */
export const STAGING_ID_HEADER = 'x-user-staging-id';
export const SAME_FOR_EVERYONE = '00000000-0000-0000-0000-000000000000';
/** Headers electron-updater's requests get on top of its own (see `createUpdater`). */
export const UPDATER_HEADERS: Readonly<Record<string, string>> = { [STAGING_ID_HEADER]: SAME_FOR_EVERYONE, 'accept-language': '*' };

export interface UpdateFacts {
  packaged: boolean;
  /** `openpixel.selfUpdate` in the app's package.json. */
  stamped: boolean;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** The program that runs (process.execPath). */
  execPath: string;
}

/** A folder address from OPENPIXEL_UPDATE_FEED, ending in "/"; undefined when unset or not http(s). */
export function feedOverride(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[UPDATE_FEED_ENV]?.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
    return u.href.endsWith('/') ? u.href : `${u.href}/`;
  } catch {
    return undefined;
  }
}

/** Whether this copy can replace itself with a downloaded update. */
export function canSelfInstall(f: UpdateFacts): boolean {
  if (!f.packaged || !f.stamped) return false;
  if (f.platform === 'win32' || f.platform === 'darwin') return true;
  if (f.platform !== 'linux') return false;
  // Started from the AppImage itself: its runtime names the file (APPIMAGE) and where it is mounted (APPDIR). A
  // .deb install that merely inherited APPIMAGE from another program is not one.
  const { APPIMAGE: file, APPDIR: mounted } = f.env;
  return !!file && !!mounted && path.resolve(f.execPath).startsWith(path.resolve(mounted) + path.sep);
}

/** `openpixel.selfUpdate` of the package.json the app was packed with (false when it says nothing). */
export function selfUpdateStamp(appPath: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(appPath, 'package.json'), 'utf8')) as { openpixel?: { selfUpdate?: unknown } };
    return pkg.openpixel?.selfUpdate === true;
  } catch {
    return false;
  }
}

/** What the host is told about updating this copy (`Platform.desktop.updates`). */
export function updateSettings(f: UpdateFacts): UpdateSettings & { selfInstall: boolean; atLaunch: boolean } {
  const feed = feedOverride(f.env);
  return {
    ...(feed === undefined ? {} : { feed }),
    selfInstall: canSelfInstall(f),
    // Development builds leave the release feed alone, unless a test feed is named; and the person can say no.
    atLaunch: (f.packaged || feed !== undefined) && ['', '0'].includes((f.env[NO_UPDATE_CHECK_ENV] ?? '').trim()),
  };
}

/** The first line of an error, short enough for a dialog. */
export function shortReason(e: unknown): string {
  const text = (e instanceof Error ? e.message : String(e)).split('\n')[0]?.trim() ?? '';
  return text.length > 200 ? `${text.slice(0, 199)}…` : text || 'unknown error';
}

/** What the update dialog needs from the window (electron/main.ts). */
export interface UpdaterShell {
  /** Screenshot and UI-test runs: no dialogs, no downloads. */
  headless: boolean;
  /** The running version. */
  version: string;
  messageBox(options: { message: string; detail?: string; buttons: string[]; defaultId?: number; cancelId?: number; type?: 'info' | 'error' }): Promise<{ response: number }>;
  openExternal(url: string): Promise<boolean>;
  /** 0…1 while a download runs, null when none does (the taskbar or Dock progress bar). */
  progress(fraction: number | null): void;
  /** Saves everything, as quitting does. False when the person cancelled: then nothing is installed. After true,
      the app may quit without asking again. */
  prepareToQuit(): Promise<boolean>;
  /** The install did not start after all: the app stays open and asks again when it is closed. */
  stayOpen(): void;
}

export interface UpdateDialogInfo { version: string; url?: string; notes?: string }

type State =
  | { kind: 'idle' }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string };

export interface Updater {
  /** `PlatformUI.showUpdateDialog`. */
  showUpdateDialog(info: UpdateDialogInfo): Promise<void>;
  /** For tests: where the download stands. */
  state(): State;
}

/** `load` hands over electron-updater's `autoUpdater` (it is only loaded when a copy that installs by itself shows
    its dialog); tests pass their own. */
export function createUpdater(shell: UpdaterShell, settings: { feed?: string; selfInstall: boolean }, load: () => AppUpdater = loadAutoUpdater): Updater {
  let state: State = { kind: 'idle' };
  let updater: AppUpdater | null = null;
  /** One dialog at a time: an agent asking twice must not stack them. */
  let showing: Promise<void> | null = null;
  /** Between "Restart to Update" and the app going away. */
  let installing: UpdateDialogInfo | null = null;

  function autoUpdater(): AppUpdater {
    if (updater) return updater;
    const u = load();
    // The person decides both steps: no download before they ask, and no install on the way out.
    u.autoDownload = false;
    u.autoInstallOnAppQuit = false;
    // Whole files only: the releases carry no block maps (the contract's file list), and a full download of a
    // file whose checksum is in the feed is the path that cannot half-work.
    u.disableDifferentialDownload = true;
    // Its notes go to the error stream; standard output stays clean.
    const say = (level: string) => (message?: unknown): void => { process.stderr.write(`[update] ${level}: ${shortReason(message)}\n`); };
    u.logger = { info: () => {}, debug: () => {}, warn: say('warning'), error: say('error') };
    // electron-updater makes up a random ID for this installation (kept in the app's data folder, `.updaterId`, for
    // staged roll-outs, which OpenPixel does not use) and sends it with every request for the feed as
    // `x-user-staging-id`. Its own headers win over that one: everyone sends the same value, so nothing in these
    // requests tells one installation from another. And Electron's network stack would add the app's language
    // (Accept-Language): "*" says nothing, as the app's own feed check (Node's fetch) already does.
    u.requestHeaders = { ...(u.requestHeaders ?? {}), ...UPDATER_HEADERS };
    if (settings.feed !== undefined) {
      u.forceDevUpdateConfig = true;
      u.setFeedURL({ provider: 'generic', url: settings.feed });
    }
    u.on('download-progress', (p: { percent: number }) => {
      if (state.kind !== 'downloading') return;
      state.percent = Math.max(0, Math.min(100, p.percent));
      shell.progress(state.percent / 100);
    });
    // Failed checks and downloads also reject their promises, which is where they are handled. An install that
    // does not start only says so here; without a listener, Node would treat the event as a crash.
    u.on('error', (e: Error) => {
      if (!installing) return;
      const info = installing;
      installing = null;
      state = { kind: 'idle' };
      shell.stayOpen();
      void dialog(() => offerDownloadPage(info, `OpenPixel could not install the update by itself (${shortReason(e)}). You can get it from the download page.`));
    });
    updater = u;
    return u;
  }

  /** Shows a dialog after the one that is open (if any) has been answered. */
  function dialog(open: () => Promise<void>): Promise<void> {
    const before = showing ?? Promise.resolve();
    const mine: Promise<void> = before.catch(() => {}).then(open).finally(() => { if (showing === mine) showing = null; });
    showing = mine;
    return mine;
  }

  const notesLine = (info: UpdateDialogInfo): string[] => (info.notes ? [`What's new: ${info.notes}`] : []);

  /** The dialog of a copy that does not install by itself (and the fallback when installing cannot work). */
  async function offerDownloadPage(info: UpdateDialogInfo, why?: string): Promise<void> {
    const got = await shell.messageBox({
      message: `OpenPixel ${info.version} is available`,
      detail: [`You have ${shell.version}.`, ...(why ? [why] : []), ...notesLine(info)].join('\n\n'),
      buttons: info.url ? ['Download…', 'Later'] : ['OK'],
      defaultId: 0,
      cancelId: info.url ? 1 : 0,
    });
    if (info.url && got.response === 0) await shell.openExternal(info.url);
  }

  async function offerRestart(info: UpdateDialogInfo): Promise<void> {
    const got = await shell.messageBox({
      message: `OpenPixel ${info.version} is ready to install`,
      detail: 'OpenPixel saves your work, closes, and opens again as the new version.',
      buttons: ['Restart to Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (got.response !== 0) return;
    // As quitting does: everything is saved first, and the person may still cancel there.
    if (!(await shell.prepareToQuit())) return;
    installing = info;
    // Quietly, and open again afterwards (Windows: the installer runs without its own window).
    autoUpdater().quitAndInstall(true, true);
  }

  async function download(info: UpdateDialogInfo): Promise<void> {
    state = { kind: 'downloading', version: info.version, percent: 0 };
    shell.progress(0);
    try {
      await autoUpdater().downloadUpdate();
    } catch (e) {
      state = { kind: 'idle' };
      shell.progress(null);
      return dialog(() => offerDownloadPage(info, `OpenPixel could not download the update by itself (${shortReason(e)}). You can get it from the download page.`));
    }
    state = { kind: 'ready', version: info.version };
    shell.progress(null);
    return dialog(() => offerRestart(info));
  }

  async function show(asked: UpdateDialogInfo): Promise<void> {
    if (!settings.selfInstall) return offerDownloadPage(asked);
    if (state.kind === 'ready') return offerRestart({ ...asked, version: state.version });
    if (state.kind === 'downloading') {
      await shell.messageBox({
        message: `OpenPixel ${state.version} is downloading`,
        detail: `${Math.round(state.percent)} % so far. OpenPixel asks before it restarts.`,
        buttons: ['OK'],
      });
      return;
    }
    // What electron-updater itself would install. When it has nothing (or cannot tell), the download page.
    let info = asked;
    try {
      const found = await autoUpdater().checkForUpdates();
      if (!found || !found.isUpdateAvailable) return offerDownloadPage(asked);
      // Another version than the feed's newest stable (someone on a pre-release): the notes link is not its.
      if (found.updateInfo.version !== asked.version) info = { version: found.updateInfo.version, ...(asked.url ? { url: asked.url } : {}) };
    } catch (e) {
      return offerDownloadPage(asked, `OpenPixel could not prepare the update by itself (${shortReason(e)}). You can get it from the download page.`);
    }
    const got = await shell.messageBox({
      message: `OpenPixel ${info.version} is available`,
      detail: [`You have ${shell.version}.`, 'OpenPixel downloads the update in the background and asks before it restarts.', ...notesLine(info)].join('\n\n'),
      buttons: ['Download Update', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (got.response !== 0) return;
    // In the background: this call answers now; the dialog that follows the download comes by itself.
    void download(info).catch((e) => { process.stderr.write(`[update] error: ${shortReason(e)}\n`); });
  }

  return {
    showUpdateDialog(info) {
      if (shell.headless) return Promise.resolve();
      // Asked again while a dialog is open: that dialog is the answer.
      return showing ?? dialog(() => show(info));
    },
    state: () => state,
  };
}

function loadAutoUpdater(): AppUpdater {
  // Loaded on first use: most launches never show the update dialog.
  return (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
}
