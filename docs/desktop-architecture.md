# OpenPixel desktop: Electron + React + Rust

The cross-platform app has three parts. The Mac app in `app/` (Swift + a web view) is the reference it was ported
from; file and line references below point there.

| Part | Folder | What it is | Ported from |
|---|---|---|---|
| Engine | `core/engine` (crate `openpixel-core`) | The document, undo, every tool, rendering, file formats, reviews | `app/Sources/OpenPixelCore` (all but MCP, MCPHTTP, Bridge) |
| Core program | `core/app` (crate and binary `openpixel`) | MCP server (stdio and HTTP), the socket link to the open window, tabs, autosave, the library (Recents, folders, archive), the Agents registry, Agent Chat, and `--serve`: the host the desktop app talks to | `MCP.swift`, `MCPHTTP.swift`, `Bridge.swift`, and `app/Sources/OpenPixel` minus AppKit |
| Desktop app | `desktop/` | Electron shell (`electron/`), the editor page in React + Vite (`src/`) | `AppDelegate.swift` (window, menus, dialogs) and `app/web` |

```
 React page  ──window.openpixel.post(msg)──▶  Electron main  ──JSON lines on stdin/stdout──▶  openpixel --serve
 (renderer)  ◀──── window.PC.<fn>(...) ─────  (dumb host)    ◀── events, host requests ─────  (owns all state)
                                                                                              ▲
                                    agents:  openpixel --mcp  ──local socket, one JSON per line┘
```

The core owns every piece of state and logic. Electron only does what needs the operating system: the window,
menus, file dialogs, alerts, the clipboard, opening links, revealing files, screenshots.

## 1. Page ⇄ host messages (unchanged from the Mac app)

The page posts the same messages the old page posted to `window.webkit.messageHandlers.pc` (see
`AppDelegate.userContentController` and `runNative`), and gets the same replies:

- `{kind:'tool', name, args}` → the tool's JSON; pictures arrive as `images: ["data:image/png;base64,…"]`.
  A failed tool rejects with an `Error` whose message is the tool's error text.
- `{kind:'native', action, ...}` → the action's value (`true`, a string to show, an object). Actions: `new, open,
  save, saveAs, export, copyText, agents, githubStars, openLink, openURL, revealConfig, checkUpdates, version,
  library, removeRecent, reveal, openPath, sample2d, sample3d, createFolder, renameFolder, renameFile, moveFolder,
  deleteFolder, moveItem, archiveItem, deleteItem, tabs, switchTab, closeTab, moveTab, newDocument, titlebar,
  haptic, mcpCommand, socketPath`.
- `{kind:'chat', action, ...}`: `providers, send, stop, skills, login, history, saveHistory`.
- Test and tooling messages: `snap, resizeWindow, spawnAgent, stopAgents, uitestDone, frames, demo`.

The host calls the page through `window.PC`: `refresh(tool)`, `chatEvent(e)`, `chatMoved(from, to)`,
`githubStars(n)`, `updateAvailable(version|null)`, `fullScreen(on)`, `showNewDialog()`, `showAgentHelp()`,
`command(cmd)`, `closeActiveTab()`, `showHome()`.

In the page, `window.openpixel` (from the preload script) is:

```ts
interface OpenPixelHost {
  post(msg: Record<string, unknown>): Promise<any>;   // rejects with Error(text) on failure
  platform: 'darwin' | 'win32' | 'linux';             // tests can force 'darwin'
  flags: { start: 'home' | 'editor'; uitest?: { folder: string }; screenshot?: boolean; demo?: unknown };
}
```

The preload also defines `window.webkit.messageHandlers.pc.postMessage` and the old `OPENPIXEL_START`,
`OPENPIXEL_UITEST`, `OPENPIXEL_SCREENSHOT` globals, so the old page in `app/web` runs unchanged in the same shell
(`--legacy-ui`). That is how old and new are compared side by side on one engine.

## 2. Electron main ⇄ `openpixel --serve` (JSON lines)

One JSON object per line, UTF-8, on the core's stdin and stdout. stderr is for logs.

- Request (Electron → core): `{"id": 7, "msg": { ...the page's message... }}`
  Reply: `{"id": 7, "ok": true, "result": <any JSON>}` or `{"id": 7, "ok": false, "error": "text"}`.
  Every `tool`, `native` and `chat` message goes to the core as it is. Electron answers only `titlebar`, `haptic`,
  `snap`, `resizeWindow`, `uitestDone`, `frames` and `demo` itself.
- Event (core → Electron): `{"event": "page", "fn": "refresh", "args": ["set_voxels"]}` → Electron runs
  `window.PC && PC.refresh("set_voxels")` in the page. Used for `refresh`, `chatEvent`, `chatMoved`, `githubStars`,
  `updateAvailable`. Also `{"event": "title", "title": "OpenPixel — Name •", "path": "/…"|null, "edited": true}`
  and `{"event": "quit"}`.
- Host request (core → Electron): `{"host": 3, "action": "...", ...}` → `{"hostReply": 3, "result": <JSON>}`.
  The core thread that asked waits for the reply. Actions:
  - `openPanel` `{extensions: ["openpixel","vox"]}` → `"/path"` or `null`
  - `savePanel` `{name: "Untitled.openpixel", extension: "openpixel"}` → `"/path"` or `null`
  - `askToSave` `{name}` → `"save" | "discard" | "cancel"`
  - `alert` `{title, text}` → `true`
  - `copyText` `{text}`, `openExternal` `{url}`, `reveal` `{path}` → `true|false`
  - `screenshot` → `{png: "<base64>"}` (the editor window as the person sees it)
  - `showUpdateDialog` `{version}` → `true`
- Electron → core, without a reply: `{"note": "quitting"}` (autosave everything; the core answers with
  `{"event": "quit"}` once it is safe to close, or asks to save through `askToSave`), `{"note": "open", "path"}`
  for files opened from the system.

`openpixel --serve` options: `--data <folder>` (Recents, chat history, socket; default: the per-user data folder),
`--files <folder>` (new files; default `~/Documents/OpenPixel`), `--ui-test <folder>` (the old `--ui-test`
behaviour: an empty library in that folder, a private socket there, no network, no real agents), `--open <file>`.

## 3. Agents ⇄ the window

`openpixel --mcp` is the MCP server agents start. It forwards each tool call to the open window over a local
socket (owner-only Unix socket in the data folder; on Windows a named-pipe-like local socket), exactly like
`Bridge.swift`: one JSON request per line, `{"tool", "args"}` → `{"ok", "json", "images"}`, with a `{"hello": info}`
line first. Without a window it works headless on its own engine. `openpixel --mcp-http [port]` serves MCP over
HTTP on this computer only, with file access confined to the files folder.

## 4. The page (React)

- Same DOM as `app/web/index.html` and what `app.js` builds: same ids, classes and attributes, so `style.css` is
  used as it is (copied to `desktop/src/style.css`; platform additions live in `desktop/src/platform.css`). Every
  breakpoint and container rule comes with it.
- State lives in small stores with the old names and shapes (`S`, `ui`, `home`, `sv`, `cam`, `pk`, `leftSide`,
  `homePrefs`, `chatState`, …): plain mutable objects from `store()` in `src/lib/store.ts`. Code changes a store and
  calls `changed(store)`; components read with `useStore(store)`.
- The canvases (WebGL 3D view, 2D slice view, colour picker square) are drawn by plain TypeScript modules driven
  from refs, as before.
- Menu-bar shortcuts arrive as `PC.command(cmd)` from Electron's menu (`CmdOrCtrl` accelerators); the page's own
  key handling ignores the menu modifier, as the old page did.
- `src/testing/compat.ts` publishes the names the old UI test (`app/web/uitest.js`) reaches for, so that same test
  runs against the React page.

## 5. Checks

- `cd core && cargo test`: the engine's self-test (port of `SelfTest.swift`, `ChatSelfTest.swift`) and golden
  files: every `.openpixel` in `web/artwork` rendered and compared with the pictures the Swift app exported.
- `cd desktop && npm run test:ui`: the old 59-case UI test against the old page and the React page in Electron, a
  picture of every checkpoint from both, a pixel comparison, and a video of the run.
