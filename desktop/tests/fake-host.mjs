// A stand-in for the app's logic (desktop/host), for working on the Electron shell without it and without the
// core: `OPENPIXEL_FAKE_HOST=tests/fake-host.mjs`. It exports the same `createHost`, answers the handful of messages
// a page needs to start (tabs, library, agents, version, githubStars), fails every tool with a clear error, uses the
// platform for the things the real host uses it for (panels, the clipboard, the title, calls into the page), and
// has test hooks (`kind: "fake"`):
//
//   {kind:'fake', do:'refresh', tool}                  → platform.ui.page('refresh', tool), answers true
//   {kind:'fake', do:'page', fn, args}                 → platform.ui.page(fn, ...args), answers true
//   {kind:'fake', do:'title', title, path, edited}     → platform.ui.setTitle(…), answers true
//   {kind:'fake', do:'ui', method, args}               → platform.ui[method](...args), answers with its result
//                                                        (a screenshot comes back as {png: base64})
//   {kind:'fake', do:'log'}                            → everything that happened so far
//   {kind:'fake', do:'platform'}                       → what the platform looks like (os, which parts are there)
//   {kind:'fake', do:'dirty', on}                      → from now on quitting asks to save first
//
// FAKE_HOST_LOG=<file> also appends every entry of that log there, one JSON per line, so a test can read what
// happened after the app has quit (`created`, `handle`, `openFile`, `quitting`, `dispose`).
import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** @param {{ platform: any, core?: unknown, uiTest?: string, screenshot?: boolean, open?: string }} options */
export function createHost(options) {
  const { platform } = options;
  const ui = platform.ui;
  const log = [];
  const note = (entry) => {
    log.push(entry);
    if (process.env.FAKE_HOST_LOG) appendFileSync(process.env.FAKE_HOST_LOG, JSON.stringify(entry) + '\n');
  };
  note({ created: { uiTest: options.uiTest ?? null, screenshot: !!options.screenshot, open: options.open ?? null, core: options.core === undefined ? null : typeof options.core,
    os: platform.os, mcpCommand: platform.desktop?.mcpCommand ?? null } });

  const tabs = [];
  let active = null, nextTab = 1, dirty = false;
  const tabsForPage = () => ({ tabs, active });
  function openTab(file) {
    let t = tabs.find((x) => x.path === file);
    if (!t) { t = { id: nextTab++, name: path.basename(file).replace(/\.[^.]+$/, ''), kind: '2d', dirty: false, path: file }; tabs.push(t); }
    active = t.id;
    ui.setTitle(`OpenPixel — ${t.name}`, file, false);
  }
  if (options.open) openTab(path.resolve(options.open));
  else ui.setTitle('OpenPixel — Untitled', null, false);

  async function native(m) {
    switch (m.action) {
      case 'tabs': return tabsForPage();
      case 'switchTab': if (tabs.some((t) => t.id === m.id)) active = m.id; return tabsForPage();
      case 'closeTab': {
        const i = tabs.findIndex((t) => t.id === m.id);
        if (i >= 0) tabs.splice(i, 1);
        if (active === m.id) active = tabs.length ? tabs[Math.min(i, tabs.length - 1)].id : null;
        return { ...tabsForPage(), closed: true };
      }
      case 'library': return { files: [], folders: [] };
      case 'agents': return { agents: [], connected: [], command: platform.desktop?.mcpCommand ?? '', bridge: false };
      case 'version': return { version: '0.0.0-fake', build: '0', updates: false, automatic: false, available: null };
      case 'githubStars': return 1234;
      case 'mcpCommand': return platform.desktop?.mcpCommand ?? '';
      case 'socketPath': return platform.desktop?.socketPath ?? '';
      case 'copyText': ui.copyText(String(m.text ?? '')); return true;
      case 'reveal': return ui.reveal(String(m.path ?? ''));
      case 'open': {
        const file = await ui.openPanel({ extensions: ['openpixel', 'vox'] });
        if (file) { openTab(file); ui.page('refresh', 'open_model'); }
        return true;
      }
      case 'save': case 'saveAs': {
        const file = await ui.savePanel({ name: 'Untitled.openpixel', extension: 'openpixel' });
        note({ saved: file });
        return !!file;
      }
      case 'export': {
        const file = await ui.savePanel({ name: `Untitled.${m.format}`, extension: String(m.format ?? 'png') });
        if (!file) return true;
        throw new Error(`fake host: no engine (export ${m.format})`);
      }
      case 'checkUpdates': await ui.showUpdateDialog({ version: '9.9.9', url: 'https://openpixel.dev', notes: 'The fake host has nothing new.' }); return true;
      default: return false; // what the real host answers to an action it does not know
    }
  }

  return {
    async handle(m) {
      if (!(m && m.kind === 'fake' && m.do === 'log')) note({ handle: m });
      if (!m || typeof m.kind !== 'string') throw new Error('bad message');
      switch (m.kind) {
        case 'native': return native(m);
        case 'tool': throw new Error(`fake host: no engine (tool ${m.name})`);
        case 'chat': return m.action === 'providers' || m.action === 'skills' ? [] : m.action === 'history' ? null : false;
        case 'spawnAgent': case 'stopAgents': return true;
        case 'fake':
          switch (m.do) {
            case 'refresh': ui.page('refresh', m.tool ?? 'set_voxels'); return true;
            case 'page': ui.page(String(m.fn), ...(Array.isArray(m.args) ? m.args : [])); return true;
            case 'title': ui.setTitle(m.title ?? 'OpenPixel — Fake', m.path ?? null, !!m.edited); return true;
            case 'ui': {
              const r = await ui[m.method](...(Array.isArray(m.args) ? m.args : []));
              return m.method === 'screenshot' ? { png: Buffer.from(r).toString('base64') } : r ?? null;
            }
            case 'log': return log;
            case 'platform': return { os: platform.os, parts: Object.keys(platform).sort(), ui: Object.keys(ui).sort(), now: platform.now(), desktop: platform.desktop };
            case 'dirty': dirty = m.on !== false; return true;
          }
          throw new Error(`fake host: unknown hook ${m.do}`);
        default: throw new Error('unknown message');
      }
    },
    start: () => (tabs.length ? 'editor' : 'home'),
    openFile(file) {
      note({ openFile: file });
      openTab(file);
      ui.page('refresh', 'open_model');
    },
    async quitting() {
      let ok = true;
      if (dirty) {
        const choice = await ui.askToSave('Untitled');
        ok = choice === 'discard' || (choice === 'save' && !!(await ui.savePanel({ name: 'Untitled.openpixel', extension: 'openpixel' })));
        if (ok) dirty = false;
        note({ askToSave: choice });
      }
      note({ quitting: ok });
      return ok;
    },
    dispose() { note({ dispose: true }); },
  };
}
