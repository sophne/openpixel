/* The app's logic: the open files (one engine per tab, plus a blank spare), autosave, the library, the agents'
   socket, updates, and every message the page sends. It never touches a window itself: for the window, a panel or
   the clipboard it asks `platform.ui`. */
import { AgentRegistry } from './agents';
import { helloOf, response } from './bridge-protocol';
import type { ChatRunner } from './chat-api';
import { Core, type Engine, type ToolOutput } from './core';
import type { BridgeListener, Host, HostOptions, PageMessage, Platform } from './platform';
import { Recents, SAMPLE_IDS } from './recents';
import { Updates } from './updates';
import { type Json, argBool, bool, errorText, int, newUUID, obj, parseObject, pngDataURL, sleep, str } from './util';

/** One open file in the tab bar, with its own engine (document, undo history, activity). */
export interface DocTab {
  readonly id: number;
  readonly engine: Engine;
  /** A built-in sample or an imported .vox: it gets a file of its own only once it is changed. */
  saveOnEdit: boolean;
}

/** OpenPixel's own pages (sidebar links). The page names one; only these addresses can open. */
const LINKS: Record<string, string> = { website: 'https://openpixel.dev', github: 'https://github.com/sophne/openpixel', x: 'https://x.com/eminvkc' };

/** The repository's public data, for the star count in the tab bar. */
const STARS_API = 'https://api.github.com/repos/sophne/openpixel';

const EXPORTS: Record<string, { ext: string; tool: string }> = {
  sheet: { ext: 'png', tool: 'export_sheet' },
  gif: { ext: 'gif', tool: 'export_gif' },
  vox: { ext: 'vox', tool: 'export_vox' },
  obj: { ext: 'obj', tool: 'export_obj' },
  svg: { ext: 'svg', tool: 'export_svg' },
  html: { ext: 'html', tool: 'export_html' },
};

export class AppHost implements Host {
  readonly platform: Platform;
  readonly core: Core;
  /** Where new files are saved: ~/Documents/OpenPixel (the folder agents over HTTP can reach too). */
  readonly filesFolder: string;
  readonly uiTest: string | null;
  readonly screenshot: boolean;
  /** The open files, in tab-bar order. */
  tabs: DocTab[] = [];
  /** The engine the editor and agents work on: the active tab's, or a blank spare while no file is open
      (the spare becomes a tab as soon as an agent starts drawing in it). */
  engine: Engine;
  /** Recents and the library. UI tests use their own folder; a screenshot run uses a throwaway one, so taking a
      picture never adds the file to the person's Recents. */
  readonly recents: Recents;
  readonly agents: AgentRegistry;
  readonly updates: Updates;
  /** The newer version the feed lists, shown as the Update button; null when up to date or not checked yet. */
  availableUpdate: string | null = null;
  bridge: BridgeListener | null = null;

  private nextTabID = 1;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTool = '';
  private starsFetching = false;
  private chatRunner: ChatRunner | null = null;
  private readonly chatFactory: HostOptions['chat'];
  private disposed = false;

  constructor(options: HostOptions) {
    const platform = options.platform;
    const { paths, fs } = platform;
    this.platform = platform;
    this.core = new Core(options.core, platform);
    this.uiTest = options.uiTest === undefined ? null : paths.normalize(options.uiTest);
    this.screenshot = options.screenshot === true;
    this.chatFactory = options.chat;
    this.filesFolder = this.uiTest !== null ? paths.join(this.uiTest, 'Files') : paths.files;
    const libraryFolder = this.uiTest ?? (this.screenshot ? paths.join(paths.temp, `OpenPixel-screenshot-${newUUID()}`) : paths.data);
    this.recents = new Recents(platform, this.core, libraryFolder, !this.headless);
    this.agents = new AgentRegistry(platform, this.recents.folder);
    this.updates = new Updates(platform, this.core);

    this.engine = this.makeSpare();
    if (options.open !== undefined) {
      const e = this.core.engine();
      try {
        e.execute('open_model', { path: options.open }, 'person');
        this.wire(e);
        const spare = this.engine;
        this.engine = e;
        this.addTab(e);
        spare.free();
        this.recents.touch(e);
      } catch {
        e.free();
      }
    }
    if (this.uiTest !== null) {
      // Files the last run saved would push new ones to "Name 2": each run starts with its own empty folder.
      if (paths.basename(this.filesFolder) === 'Files' && this.filesFolder.startsWith(this.uiTest)) {
        try {
          fs.remove(this.filesFolder);
        } catch {
          // Nothing there yet.
        }
      }
      // The test drives real agent connections through a private socket in its own folder.
      this.startBridge(paths.join(this.uiTest, 'op.sock'));
    } else if (!this.screenshot) {
      this.startBridge(platform.desktop?.socketPath);
      // Ask quietly on every open whether a newer version exists (no dialog, no download), so the Update
      // button can appear in the tab bar. Not while developing: the shell says so.
      if (platform.desktop?.updates?.atLaunch !== false) void this.lookForUpdate();
    }
    this.updateTitle();
  }

  /** Screenshot and UI-test runs never ask to save and never go to the network. */
  get headless(): boolean {
    return this.screenshot || this.uiTest !== null;
  }

  // MARK: - Host

  start(): 'home' | 'editor' {
    return this.tabs.length === 0 ? 'home' : 'editor';
  }

  /** Files opened from the system. */
  openFile(path: string): void {
    try {
      this.openPath(path);
    } catch (e) {
      void this.showError(e);
    }
  }

  /** The window is closing: everything is saved by itself; what could not be is asked about. */
  async quitting(): Promise<boolean> {
    if (this.headless) return true;
    this.autosaveAll();
    for (const tab of [...this.tabs]) {
      if (!tab.engine.dirty) continue;
      if (!(await this.askToSave(tab))) return false;
    }
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.autosaveTimer !== null) clearTimeout(this.autosaveTimer);
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.autosaveTimer = this.refreshTimer = null;
    this.bridge?.stop();
    this.bridge = null;
    this.chatRunner?.stopAll();
    this.platform.local?.killAgents();
    const spare = this.tabs.some((t) => t.engine === this.engine) ? [] : [this.engine];
    for (const e of [...this.tabs.map((t) => t.engine), ...spare]) e.free();
    this.tabs = [];
  }

  async handle(msg: PageMessage): Promise<unknown> {
    const body = obj(msg);
    const kind = str(body?.kind);
    if (!body || kind === undefined) throw new Error('bad message');
    switch (kind) {
      case 'tool': {
        const out = this.engine.execute(str(body.name) ?? '', obj(body.args) ?? {}, 'person');
        const json = out.json;
        if (out.images.length > 0) json.images = out.images.map(pngDataURL);
        return json;
      }
      case 'native':
        return this.runNative(str(body.action) ?? '', body);
      case 'chat':
        return this.handleChat(body);
      case 'spawnAgent': {
        if (this.uiTest === null) break;
        // UI test: start `openpixel --mcp` like an agent would, introduce it as `client`, make one call.
        // `call: false` starts an agent that connects but hasn't done anything yet.
        const { local, desktop } = this.platform;
        if (!local) throw new Error('agents cannot be started here');
        local.spawnAgent({ command: desktop?.mcpCommand ?? '', socketPath: this.socketPath, client: str(body.client) ?? 'test-agent', call: bool(body.call) ?? true });
        await sleep(1500);
        return true;
      }
      case 'stopAgents':
        if (this.uiTest === null) break;
        await this.platform.local?.stopAgents();
        await sleep(500);
        return true;
      default:
        break;
    }
    throw new Error('unknown message');
  }

  // MARK: - tabs

  /** Engines tell the window when they change; only the active one redraws the page. */
  wire(e: Engine): void {
    e.onChange = (tool) => {
      if (tool === 'open_model' || tool === 'save_model' || tool === 'autosave') this.recents.touch(e);
      if (e.dirty || (e.path === null && tool !== 'autosave')) this.scheduleAutosave();
      if (e !== this.engine) return;
      // An agent drawing while no file is open: what it makes becomes a tab.
      if (!this.tabs.some((t) => t.engine === e)) this.addTab(e);
      this.scheduleRefresh(tool);
    };
    // The picture is taken by the window, which an agent's call waits for on its own connection (see `agentLine`);
    // asked for any other way, there is nobody to wait.
    e.setHostTool('get_editor_screenshot', () => {
      throw new Error('get_editor_screenshot must come from an agent');
    });
  }

  /** A blank canvas for while no file is open. */
  makeSpare(): Engine {
    const e = this.core.engine();
    try {
      e.execute('new_sprite', { width: 32, height: 32, name: 'Untitled' }, 'sample');
    } catch {
      // The core's own blank model serves as well.
    }
    e.markClean();
    this.wire(e);
    return e;
  }

  addTab(e: Engine): DocTab {
    const t: DocTab = { id: this.nextTabID, engine: e, saveOnEdit: false };
    this.nextTabID += 1;
    this.tabs.push(t);
    return t;
  }

  activate(tab: DocTab): void {
    this.switchTo(tab.engine);
    this.updateTitle();
  }

  /** Makes `e` the engine the editor and agents work on. A spare left behind has nothing in it: it goes. */
  private switchTo(e: Engine): void {
    const previous = this.engine;
    this.engine = e;
    if (previous !== e && !this.tabs.some((t) => t.engine === previous)) previous.free();
  }

  private activeTab(): DocTab | undefined {
    return this.tabs.find((t) => t.engine === this.engine);
  }

  /** Opens a new tab with a fresh engine and runs `setup` in it; the tab goes away again if that fails. */
  openInNewTab(setup: (e: Engine) => void): void {
    const e = this.core.engine();
    this.wire(e);
    const previous = this.engine;
    const tab = this.addTab(e);
    this.engine = e;
    try {
      setup(e);
    } catch (error) {
      this.tabs = this.tabs.filter((t) => t !== tab);
      this.engine = previous;
      e.free();
      throw error;
    }
    if (!this.tabs.some((t) => t.engine === previous)) previous.free();
    this.updateTitle();
    this.scheduleRefresh('open_model');
  }

  /** Opens a file, or switches to its tab when it is already open. */
  openPath(path: string): void {
    const { paths } = this.platform;
    const std = paths.normalize(path);
    const open = this.tabs.find((t) => t.engine.path !== null && paths.normalize(t.engine.path) === std);
    if (open) {
      this.activate(open);
      this.scheduleRefresh('open_model');
      return;
    }
    this.openInNewTab((e) => {
      e.execute('open_model', { path }, 'person');
    });
    const t = this.activeTab();
    if (t && t.engine.path === null) t.saveOnEdit = true;
  }

  openSampleTab(threeD: boolean): void {
    try {
      this.openInNewTab((e) => this.core.buildSample(e, threeD));
    } catch {
      return;
    }
    const t = this.activeTab();
    if (t && t.engine.path === null) t.saveOnEdit = true;
  }

  // MARK: - autosave

  /** Changes are written to the file a moment after they happen (at most every 1.5 s while edits keep
      coming), so nothing is lost: a file that has none yet gets one in `filesFolder`. */
  scheduleAutosave(): void {
    if (this.screenshot || this.autosaveTimer !== null || this.disposed) return;
    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      this.autosaveAll();
    }, 1500);
  }

  /** Saves every tab that needs it. False when one could not be saved. */
  autosaveAll(): boolean {
    let saved = false;
    let ok = true;
    for (const tab of [...this.tabs]) {
      if (!(tab.engine.dirty || (tab.engine.path === null && !tab.saveOnEdit))) continue;
      if (this.autosave(tab)) saved = true;
      else ok = false;
    }
    if (saved) this.scheduleRefresh('autosave');
    return ok;
  }

  autosave(tab: DocTab): boolean {
    try {
      if (tab.engine.path === null) tab.engine.autosave(this.newFilePath(tab.engine.name));
      else tab.engine.autosave();
      tab.saveOnEdit = false;
      return true;
    } catch (e) {
      console.error(`OpenPixel could not autosave ${tab.engine.name}: ${errorText(e)}`);
      return false;
    }
  }

  /** A name a file can have: no path separators (and, on Windows, none of the characters its files cannot hold). */
  private cleanFileName(name: string): string {
    const clean = name.replaceAll('/', '-').replaceAll(':', '-');
    return (this.platform.os === 'win32' ? clean.replace(/[\\*?"<>|]/g, '-') : clean).trim();
  }

  /** Renames a file (by its path, or the file open in a tab): on disk next to where it is, in Recents, and in its
      tab. A document without a file yet only changes its name; autosave then gives it a file by that name.
      True, or a message to show. */
  renameFile(path: string | undefined, tabID: number | undefined, name: string): true | string {
    const { paths, fs } = this.platform;
    const clean = this.cleanFileName(name);
    if (clean === '' || clean.startsWith('.')) return 'Give the file a name';
    const std = path === undefined ? undefined : paths.normalize(path);
    const tab = (tabID === undefined ? undefined : this.tabs.find((t) => t.id === tabID))
      ?? (std === undefined ? undefined : this.tabs.find((t) => t.engine.path !== null && paths.normalize(t.engine.path) === std));
    const old = tab?.engine.path ?? path;
    if (old === undefined) {
      if (!tab) return 'Could not find that file';
      tab.engine.rename(null, clean);
      tab.saveOnEdit = false;
      this.scheduleRefresh('rename');
      return true;
    }
    const ext = paths.extname(old).replace(/^\./, '') || 'openpixel';
    const to = paths.join(paths.dirname(old), `${clean}.${ext}`);
    if (paths.normalize(to) !== paths.normalize(old)) {
      // Only the letter case changes: a disk that ignores case sees the same name, so go through a temporary one.
      const caseOnly = to.toLowerCase() === old.toLowerCase();
      if (!caseOnly && fs.exists(to)) return `There is already a file called “${clean}” in that folder`;
      if (!fs.exists(old)) return 'The file is not there any more';
      try {
        if (caseOnly) {
          const tmp = paths.join(paths.dirname(old), `.${newUUID()}.${ext}`);
          fs.rename(old, tmp);
          fs.rename(tmp, to);
        } else {
          fs.rename(old, to);
        }
      } catch (e) {
        return `Could not rename it: ${errorText(e)}`;
      }
      this.recents.renamePath(old, to);
      // Its Agent Chat history follows the new name (on disk, and in the open page).
      this.chat()?.moveHistory(old, to);
      this.platform.ui.page('chatMoved', old, to);
    }
    if (tab) {
      tab.engine.rename(to, clean);
      this.autosave(tab);
    }
    this.scheduleRefresh('rename');
    return true;
  }

  /** A free name for a new file in `filesFolder`: "Name.openpixel", then "Name 2.openpixel" and so on. */
  newFilePath(name: string): string {
    const { paths, fs } = this.platform;
    fs.createDirAll(this.filesFolder);
    let base = this.cleanFileName(name);
    if (base === '' || base.startsWith('.')) base = 'Untitled' + base;
    const taken = (u: string): boolean => fs.exists(u) || this.tabs.some((t) => t.engine.path !== null && paths.normalize(t.engine.path) === paths.normalize(u));
    let u = paths.join(this.filesFolder, base + '.openpixel');
    for (let n = 2; taken(u); n += 1) u = paths.join(this.filesFolder, `${base} ${n}.openpixel`);
    return u;
  }

  /** Closes a tab, asking about unsaved changes unless `force`. False when the person cancelled. */
  async closeTab(id: number, force = false): Promise<boolean> {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return true;
    if (!force && tab.engine.dirty) this.autosave(tab);
    if (!force && tab.engine.dirty && !(await this.askToSave(tab))) return false;
    const i = this.tabs.indexOf(tab);
    if (i < 0) return true;
    this.tabs.splice(i, 1);
    if (tab.engine === this.engine) {
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      this.engine = next ? next.engine : this.makeSpare();
      this.updateTitle();
    }
    tab.engine.free();
    return true;
  }

  tabsForPage(): Json {
    const { paths } = this.platform;
    return {
      tabs: this.tabs.map((t) => ({
        id: t.id,
        name: t.engine.path !== null ? paths.basename(t.engine.path, paths.extname(t.engine.path)) : t.engine.name,
        kind: t.engine.isSprite ? '2d' : '3d',
        dirty: t.engine.dirty,
        path: t.engine.path,
      })),
      active: this.activeTab()?.id ?? null,
    };
  }

  /** Asks whether to save a tab's unsaved changes. False when the person cancels (or the save fails). */
  async askToSave(tab: DocTab): Promise<boolean> {
    if (tab.engine !== this.engine) this.activate(tab);
    switch (await this.platform.ui.askToSave(tab.engine.name)) {
      case 'save': return this.saveDocument(false, tab.engine);
      case 'discard': return true;
      default: return false;
    }
  }

  // MARK: - Chat panel (the person's own agents, run headless)

  chat(): ChatRunner | null {
    if (this.chatRunner) return this.chatRunner;
    if (!this.chatFactory) return null;
    const { platform } = this;
    this.chatRunner = this.chatFactory({
      mcpCommand: platform.desktop?.mcpCommand ?? '',
      workDir: platform.paths.join(this.recents.folder, 'Chat'),
      emit: (event) => platform.ui.page('chatEvent', event),
      fs: platform.fs,
    });
    return this.chatRunner;
  }

  /** Chat messages from the page. UI tests never look for or start the person's agents. */
  async handleChat(body: Json): Promise<unknown> {
    const action = str(body.action) ?? '';
    if (this.uiTest !== null) return action === 'providers' ? [] : false;
    const c = this.chat();
    if (!c) return action === 'providers' ? [] : false;
    switch (action) {
      case 'providers': return c.providersForPage();
      case 'send': return c.start(body);
      case 'stop': c.stop(str(body.chat) ?? ''); return true;
      case 'skills': return c.skillsForPage(str(body.provider) ?? '');
      case 'login': return c.login(str(body.provider) ?? '');
      case 'history': return c.loadHistory(str(body.key) ?? '');
      case 'saveHistory': return c.saveHistory(str(body.key) ?? '', body.data);
      default: throw new Error('unknown chat action');
    }
  }

  // MARK: - agents

  /** Where agents reach this window (also when nothing listens there). */
  get socketPath(): string {
    return this.bridge?.path ?? (this.uiTest !== null ? this.platform.paths.join(this.uiTest, 'op.sock') : this.platform.desktop?.socketPath ?? '');
  }

  private startBridge(path: string | undefined): void {
    const local = this.platform.local;
    if (!local || path === undefined || path === '') return;
    try {
      this.bridge = local.listen(path, {
        line: (line, connection) => this.agentLine(line, connection),
        opened: (id) => this.agents.opened(id),
        closed: (id) => this.agents.closed(id),
        failed: (error) => {
          this.bridge = null;
          console.error(`OpenPixel: agent bridge unavailable: ${error}`);
        },
      });
    } catch (e) {
      console.error(`OpenPixel: agent bridge unavailable: ${errorText(e)}`);
    }
  }

  /** One line from an agent's `openpixel --mcp`, and the line that answers it. */
  async agentLine(line: string, connection: number): Promise<string> {
    // Each agent's MCP process first says who it is.
    const hello = helloOf(line);
    if (hello) {
      this.agents.hello(connection, hello);
      return '{"ok":true}';
    }
    // The editor screenshot waits for the window to take the picture.
    if (line.includes('"get_editor_screenshot"')) {
      this.agents.called(connection, 'get_editor_screenshot');
      return response(line, () => this.editorScreenshot());
    }
    // The update check reads the feed over the network.
    if (line.includes('"check_for_updates"')) {
      this.agents.called(connection, 'check_for_updates');
      return response(line, (_, args) => this.checkForUpdatesForAgent(args));
    }
    return response(line, (tool, args) => {
      this.agents.called(connection, tool);
      return this.engine.execute(tool, args, 'agent');
    });
  }

  async editorScreenshot(): Promise<ToolOutput> {
    const timedOut = Symbol('timed out');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = new Promise<typeof timedOut>((done) => {
      timer = setTimeout(() => done(timedOut), 10_000);
    });
    let png: Uint8Array | typeof timedOut | null;
    try {
      png = await Promise.race([this.platform.ui.screenshot().catch(() => null), wait]);
    } finally {
      clearTimeout(timer);
    }
    if (png === timedOut) throw new Error('the window did not answer');
    if (!png || png.length === 0) throw new Error('could not capture the window');
    return { json: { note: 'The OpenPixel editor as the person sees it.' }, images: [png] };
  }

  // MARK: - GitHub stars (tab bar)

  private get prefsFile(): string {
    const { paths } = this.platform;
    // Checks and tests keep to their own folder.
    return paths.join(this.headless ? this.recents.folder : paths.data, 'prefs.json');
  }

  private readPrefs(): Json {
    try {
      return parseObject(this.platform.fs.read(this.prefsFile)) ?? {};
    } catch {
      return {};
    }
  }

  /** The repository's public star count for the tab bar. The page asks; the answer is the last known count (kept in
      the app's preferences), and at most once an hour the app asks GitHub's public API again in the background and
      sends the new count to the page. Only the repository's public data is read; nothing about the person is sent. */
  githubStars(): number | null {
    const prefs = this.readPrefs();
    const at = typeof prefs.githubStarsAt === 'number' ? prefs.githubStarsAt : null;
    // Checks and tests stay offline.
    if (!this.headless && !this.starsFetching && (at === null || this.platform.now() - at > 3600)) void this.fetchGitHubStars();
    return int(prefs.githubStars) ?? null;
  }

  private async fetchGitHubStars(): Promise<void> {
    this.starsFetching = true;
    let n: number | undefined;
    try {
      const body = await this.platform.fetchText(STARS_API, { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenPixel' });
      n = body === null ? undefined : int(parseObject(body)?.stargazers_count);
    } catch {
      n = undefined;
    }
    this.starsFetching = false;
    if (n === undefined || n < 0 || this.disposed) return; // offline or rate-limited: keep the last count, try again next time
    try {
      this.platform.fs.createDirAll(this.platform.paths.dirname(this.prefsFile));
      this.platform.fs.write(this.prefsFile, JSON.stringify({ ...this.readPrefs(), githubStars: n, githubStarsAt: this.platform.now() }));
    } catch {
      // Asked again next time.
    }
    this.platform.ui.page('githubStars', n);
  }

  // MARK: - title bar

  updateTitle(): void {
    const e = this.engine;
    this.platform.ui.setTitle(`OpenPixel — ${e.name}${e.dirty ? ' •' : ''}`, e.path, e.dirty);
  }

  /** One redraw of the page for a burst of changes, after whatever caused them has been answered. */
  scheduleRefresh(tool: string): void {
    this.lastTool = tool;
    if (this.refreshTimer !== null || this.disposed) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.updateTitle();
      this.platform.ui.page('refresh', this.lastTool);
    }, 0);
  }

  // MARK: - messages from the page

  async runNative(action: string, body: Json): Promise<unknown> {
    const { platform, recents } = this;
    const { ui, fs, paths } = platform;
    switch (action) {
      case 'new': return true;
      case 'open': void this.openDocument(); return true;
      case 'save': return this.saveDocument(false);
      case 'saveAs': return this.saveDocument(true);
      case 'export': void this.exportDocument(str(body.format) ?? 'png', obj(body.options) ?? {}); return true;
      case 'copyText': ui.copyText(str(body.text) ?? ''); return true;
      case 'agents': return { ...this.agents.snapshot(bool(body.setup) ?? true), command: platform.desktop?.mcpCommand ?? '', bridge: this.bridge !== null };
      case 'githubStars': return this.githubStars();
      case 'openLink': {
        const key = str(body.link) ?? '';
        return Object.hasOwn(LINKS, key) ? ui.openExternal(LINKS[key] as string) : false;
      }
      case 'openURL': {
        // Only app links the Agents page uses (Cursor's install link); never web pages.
        const s = str(body.url);
        return s !== undefined && s.startsWith('cursor://') ? ui.openExternal(s) : false;
      }
      case 'revealConfig': {
        const raw = str(body.path) ?? '';
        const p = raw === '~' ? paths.home : raw.startsWith('~/') ? paths.join(paths.home, raw.slice(2)) : raw;
        if (!fs.exists(p)) return false;
        ui.reveal(p);
        return true;
      }
      case 'checkUpdates': void this.checkForUpdates(); return true;
      case 'version':
        return { version: this.core.version(), build: '', updates: this.canUpdate, automatic: false, available: this.availableUpdate };
      case 'library': return recents.listForPage();
      case 'removeRecent': recents.remove(str(body.path) ?? ''); return true;
      case 'reveal': {
        const p = str(body.path);
        if (p !== undefined) ui.reveal(p);
        return true;
      }
      case 'openPath':
        try {
          this.openPath(str(body.path) ?? '');
          return true;
        } catch (e) {
          return errorText(e);
        }
      case 'sample2d': this.openSampleTab(false); return true;
      case 'sample3d': this.openSampleTab(true); return true;
      case 'createFolder': return recents.createFolder(str(body.name), str(body.parent)) ?? false;
      case 'renameFolder': return recents.renameFolder(str(body.id) ?? '', str(body.name));
      case 'renameFile': return this.renameFile(str(body.path), int(body.tab), str(body.name) ?? '');
      case 'moveFolder': return recents.moveFolder(str(body.id) ?? '', str(body.parent));
      case 'deleteFolder': return recents.deleteFolder(str(body.id) ?? '');
      case 'moveItem': return recents.moveItem(str(body.id) ?? '', str(body.folder));
      case 'archiveItem': return recents.setArchived(str(body.id) ?? '', bool(body.archived) ?? true);
      case 'deleteItem': {
        const id = str(body.id) ?? '';
        // An open file is closed first; one with unsaved changes stays until the person deals with it.
        const t = this.tabs.find((x) => x.engine.path === id);
        if (t) {
          if (t.engine.dirty) this.autosave(t);
          if (t.engine.dirty) return `“${t.engine.name}” is open with unsaved changes. Close its tab first.`;
          await this.closeTab(t.id, true);
          this.scheduleRefresh('close_tab');
        }
        const why = await recents.deleteForever(id);
        if (why !== null) return why;
        // A file deleted for good takes its Agent Chat history with it.
        if (!SAMPLE_IDS.includes(id)) this.chat()?.deleteHistory(id);
        return true;
      }
      case 'tabs': return this.tabsForPage();
      case 'switchTab': {
        const id = int(body.id);
        const t = id === undefined ? undefined : this.tabs.find((x) => x.id === id);
        if (t) this.activate(t);
        return this.tabsForPage();
      }
      case 'closeTab': {
        const closed = await this.closeTab(int(body.id) ?? -1);
        return { ...this.tabsForPage(), closed };
      }
      case 'moveTab': {
        const id = int(body.id);
        const to = int(body.index);
        const i = id === undefined ? -1 : this.tabs.findIndex((x) => x.id === id);
        if (to !== undefined && i >= 0) {
          const [t] = this.tabs.splice(i, 1) as [DocTab];
          this.tabs.splice(Math.max(0, Math.min(this.tabs.length, to)), 0, t);
        }
        return this.tabsForPage();
      }
      case 'newDocument': {
        const tool = body.tool === 'new_model' ? 'new_model' : 'new_sprite';
        try {
          this.openInNewTab((e) => {
            e.execute(tool, obj(body.args) ?? {}, 'person');
            e.markClean();
          });
        } catch (e) {
          return errorText(e);
        }
        const t = this.activeTab();
        if (t) this.autosave(t);
        return this.tabsForPage();
      }
      // The window's own business (drag regions, a tap of the trackpad): the shell sees these first.
      case 'titlebar': return true;
      case 'haptic': return true;
      case 'mcpCommand': return platform.desktop?.mcpCommand ?? '';
      case 'socketPath': return this.socketPath;
      default: return false;
    }
  }

  // MARK: - files

  private async openDocument(): Promise<void> {
    const u = await this.platform.ui.openPanel({ extensions: ['openpixel', 'vox'] });
    if (u === null || this.disposed) return;
    try {
      this.openPath(u);
    } catch (e) {
      await this.showError(e);
    }
  }

  async saveDocument(saveAs: boolean, engine: Engine = this.engine): Promise<boolean> {
    try {
      if (!saveAs && engine.path !== null) {
        engine.execute('save_model', {}, 'person');
        return true;
      }
      const u = await this.platform.ui.savePanel({ name: engine.name + '.openpixel', extension: 'openpixel' });
      if (u === null) return false;
      engine.execute('save_model', { path: u }, 'person');
      return true;
    } catch (e) {
      await this.showError(e);
      return false;
    }
  }

  private async exportDocument(format: string, options: Json): Promise<void> {
    const { ext, tool } = EXPORTS[format] ?? { ext: 'png', tool: 'export_png' };
    const engine = this.engine;
    const u = await this.platform.ui.savePanel({ name: `${engine.name}${format === 'sheet' ? '-sheet' : ''}.${ext}`, extension: ext });
    if (u === null) return;
    try {
      engine.execute(tool, { ...options, path: u }, 'person');
    } catch (e) {
      await this.showError(e);
    }
  }

  private showError(error: unknown): Promise<void> {
    return this.platform.ui.alert('OpenPixel', errorText(error)).catch(() => undefined);
  }

  // MARK: - updates

  /** This copy looks at the release feed and can show the update dialog. Checks and tests leave updates alone, and
      a page in a browser is always the newest there is. */
  get canUpdate(): boolean {
    return !this.headless && this.platform.os !== 'web';
  }

  private async lookForUpdate(): Promise<void> {
    let o: Json;
    try {
      o = await this.updates.report(false);
    } catch {
      return; // offline: the button stays as it is
    }
    if (this.disposed) return;
    this.availableUpdate = o.update_available === true ? str(o.latest_version) ?? null : null;
    this.showUpdateButton();
  }

  /** check_for_updates from an agent: the feed's answer, the Update button kept in step, and with install=true the
      update dialog, where the person confirms. Nothing installs without them. */
  async checkForUpdatesForAgent(args: Json): Promise<ToolOutput> {
    const o = await this.updates.report(argBool(args.refresh, false));
    const available = o.update_available === true;
    const latest = str(o.latest_version);
    const install = argBool(args.install, false);
    const canUpdate = this.canUpdate;
    if (canUpdate) {
      this.availableUpdate = available ? latest ?? null : null;
      this.showUpdateButton();
    }
    if (install && available) void (canUpdate ? this.presentUpdate({ ...o }) : this.checkForUpdates());
    if (install) {
      o.install = !available ? 'Nothing to install.'
        : !canUpdate ? 'This copy of OpenPixel is not the installed app and cannot update itself; the person can download the new version from the link.'
        : this.platform.desktop?.updates?.selfInstall === false
          ? 'The update dialog is open in OpenPixel. This copy does not install updates by itself: the dialog offers the download page, and the person installs the new version from there. Reconnect the OpenPixel MCP server afterwards.'
          : 'The update dialog is open in OpenPixel. The person confirms; OpenPixel then restarts with the new version. Reconnect the OpenPixel MCP server afterwards.';
    }
    return { json: o, images: [] };
  }

  /** Tells the page; it also asks for availableUpdate itself when it loads, in case this came first. */
  showUpdateButton(): void {
    this.platform.ui.page('updateAvailable', this.availableUpdate);
  }

  /** "Check for Updates…": the update dialog when a newer version is out, else a word on where things stand. */
  async checkForUpdates(): Promise<void> {
    const { ui } = this.platform;
    const say = (words: string): Promise<void> => ui.alert('Updates', words).catch(() => undefined);
    if (!this.canUpdate) {
      return say('Updates are checked by the installed OpenPixel app. This copy was started on its own.');
    }
    let o: Json;
    try {
      o = await this.updates.report(true);
    } catch (e) {
      return say(`OpenPixel could not check for updates: ${errorText(e)}.`);
    }
    return this.presentUpdate(o);
  }

  /** Shows what a feed report says: the update dialog, or that there is nothing newer. */
  private async presentUpdate(o: Json): Promise<void> {
    const { ui } = this.platform;
    const say = (words: string): Promise<void> => ui.alert('Updates', words).catch(() => undefined);
    const latest = str(o.latest_version);
    if (o.update_available === true && latest !== undefined) {
      this.availableUpdate = latest;
      this.showUpdateButton();
      const info: { version: string; url?: string; notes?: string } = { version: latest };
      const url = str(o.download);
      const notes = str(o.release_notes);
      if (url !== undefined) info.url = url;
      if (notes !== undefined) info.notes = notes;
      return ui.showUpdateDialog(info).catch(() => undefined);
    }
    if (o.update_available === false) {
      this.availableUpdate = null;
      this.showUpdateButton();
      return say(`OpenPixel ${str(o.running_version) ?? this.core.version()} is currently the newest version available.`);
    }
    return say('OpenPixel could not tell whether a newer version is out.');
  }
}
