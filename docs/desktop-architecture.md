# How OpenPixel fits together: Electron + React + a Rust core in WebAssembly

One app for macOS, Windows and Linux.

| Part | Folder | What it is |
|---|---|---|
| Core | `core/engine` (crate `openpixel-core`) | The document model, undo, every tool, rendering voxels to sprites, file formats, reviews. Pure Rust: all files, time and network go through one small `HostIo` trait, so it builds natively and for `wasm32-unknown-unknown` |
| Bindings | `core/wasm` (crate `openpixel-wasm`) | The core for JavaScript, built with wasm-bindgen (`--target web`). One package, used by the app and by a browser (`desktop/web`, a preview) |
| MCP program | `core/app` (binary `openpixel`) | What agents start: `openpixel --mcp` (stdio) and `--mcp-http`. Forwards tool calls to the open window over a local socket, or works headless on the native build of the same core |
| App logic | `desktop/host` (TypeScript) | Tabs, autosave, the library (Recents, folders, archive), the Agents registry, the agents' socket, Agent Chat, updates. Runs the core through the wasm bindings. Talks to the outside only through `Platform` (`host/platform.ts`); the Node-only pieces (socket server, running the person's agent CLIs) sit in `host/node/` |
| Shell | `desktop/electron` | Window, menus, dialogs, clipboard, screenshots: the Electron `Platform` |
| Page | `desktop/src` | The editor in React + Vite: everything the window shows. Its own guide is `desktop/src/README.md` |

```
 React page ──window.openpixel.post(msg)──▶ Electron main: host (TypeScript) ──wasm-bindgen──▶ core (Rust, WASM)
 (renderer) ◀──── window.PC.<fn>(...) ─────        │  Platform: files, dialogs, clipboard, …
                                                   ▲
              agents:  openpixel --mcp (Rust, native core for headless) ──local socket, one JSON per line
```

Why this shape: the core has one JavaScript face (the wasm-bindgen package). The app loads it in Electron's main
process; a web version loads the same package in the browser and swaps `Platform` for one backed by its own storage
(`desktop/web` does this with files in memory, as a preview: a real one needs accounts and a database). Nothing else
changes. And what agents start is the same core built natively, so a tool answers the same with or without a window.

## 1. Page ⇄ host messages

The page posts messages through `window.openpixel.post(msg)` and gets the reply as the promise's value:

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

In the page, `window.openpixel` (from the preload script) is all there is of the app:

```ts
interface OpenPixelHost {
  post(msg: Record<string, unknown>): Promise<any>;   // rejects with Error(text) on failure
  platform: 'darwin' | 'win32' | 'linux';             // the system the page is shown for; a test can ask for another
  flags: { start: 'home' | 'editor'; uitest?: { folder: string }; screenshot?: boolean; demo?: unknown };
}
```

## 2. The core's JavaScript face (`core/wasm`, wasm-bindgen)

```ts
/** Files, time and network for the core; every method is synchronous. A missing method means "not here". */
interface HostIo {
  read?(path: string): Uint8Array;            write?(path: string, data: Uint8Array): void;   // write is atomic
  exists?(path: string): boolean;             createDirAll?(path: string): void;
  homeDir?(): string | undefined;             now?(): number;                                  // seconds since 1970
  httpGet?(url: string): Uint8Array;                                                           // the update feed
}
class Engine {
  constructor(io?: HostIo);
  /** Runs a tool. `args` is JSON text; the answer's `json` is JSON text. Throws Error(text). `source`: "person" | "agent" | "sample" | "home". */
  execute(name: string, args: string, source: string): { json: string; images: Uint8Array[] };
  readonly name: string;  readonly path: string | undefined;  readonly dirty: boolean;  readonly revision: number;
  readonly isSprite: boolean;  readonly size: number[];
  markClean(): void;  autosave(to?: string): void;  rename(to: string | undefined, name: string): void;
  onChange(fn: (tool: string) => void): void;
  setHostTool(name: string, fn: (argsJson: string) => { json: string; images?: Uint8Array[] }): void;
  free(): void;
}
function version(): string;
function toolCatalog(): string;                                   // JSON: what MCP tools/list shows, plus readOnly and hidden
function buildSample(engine: Engine, threeD: boolean): void;      // the mushroom, or the island
```

Built by `npm run build:core` in `desktop/`: `cargo build --release --target wasm32-unknown-unknown -p openpixel-wasm`
then `wasm-bindgen --target web --out-dir desktop/core-pkg`. Node (Electron's main process) loads it with
`initSync({ module: bytes })`; a browser with `await init(url)`. Same files either way.

Natively the same crate backs `openpixel --mcp` when no window is open, with `HostIo` on `std::fs`.

## 3. The app's logic (`desktop/host`)

`createHost({ platform, core, uiTest?, screenshot?, open? })` → `Host` (`handle(msg)`, `start()`, `openFile(path)`,
`quitting()`, `dispose()`); see `desktop/host/platform.ts` for `Platform`. The host owns one `Engine` per tab plus a
spare: it autosaves 1.5 s after a change, sends one coalesced `PC.refresh(tool)` per burst of changes, keeps the
window's title, and asks about unsaved work on close.

## 4. Agents ⇄ the window

`openpixel --mcp` is the MCP server agents start. It forwards each tool call to the open window over a local link
(an owner-only Unix socket in the data folder; on Windows the named pipe `\\.\pipe\openpixel-<user>`): one JSON
request per line, `{"tool", "args"}` → `{"ok", "json", "images"}` (pictures as base64), and a `{"hello": info}` line
first. The window's side of it is `desktop/host/node/bridge.ts`, the program's `core/app/src/bridge.rs`.
Without a window the program works headless on its own engine. `openpixel --mcp-http [port]` serves MCP over HTTP on
this computer only, with file access confined to the files folder. `OPENPIXEL_SOCKET` overrides the socket path.

The program ships inside the app, and the Agents page shows its path on that computer (the host's `mcpCommand`):

| System | The command agents run |
|---|---|
| macOS | `/Applications/OpenPixel.app/Contents/Resources/core/openpixel --mcp` |
| Windows | `%LOCALAPPDATA%\Programs\OpenPixel\resources\core\openpixel.exe --mcp` |
| Linux | `~/.local/share/OpenPixel/bin/openpixel --mcp` (a copy the app refreshes at every start, because an AppImage's own files move on every launch) |

The app's own executable hands `--mcp` and `--mcp-http` over to that program, so
`/Applications/OpenPixel.app/Contents/MacOS/OpenPixel --mcp`, which earlier versions told agents to run, keeps
working.

## 5. The page (React)

- Its DOM is a contract: `style.css` and the UI test address elements by id, class and attribute, and every
  breakpoint and container rule depends on the structure. `platform.css` holds only what differs between systems
  (fonts, the room the window's own buttons take in the tab bar).
- State lives in small stores (`S`, `ui`, `home`, `sv`, `cam`, `pk`, `leftSide`, `homePrefs`, `chatState`, …): plain
  mutable objects from `store()` in `src/lib/store.ts`. Code changes a store and calls `changed(store)`, which draws
  before it returns; components read with `useStore(store)`.
- The canvases (WebGL 3D view, 2D slice view, colour picker square) are drawn by plain TypeScript modules driven
  from refs.
- Menu-bar shortcuts arrive as `PC.command(cmd)` from Electron's menu (`CmdOrCtrl` accelerators); the page's own
  key handling ignores the menu modifier, and shows shortcuts with the keys of the system it runs on.
- `src/testing/compat.ts` publishes the names the UI test (`desktop/tests/uitest.js`) reaches for; the shell runs
  that script inside the page with those names in scope.

## 6. Checks

- `cd core && cargo test`: the engine's self-test (every tool, file format and damaged-file case), golden files
  (every `.openpixel` in `web/artwork` exported and compared with the pictures in `web/public`), the MCP program's
  checks, and a native-versus-WASM comparison of a scripted session.
- `cd desktop && npm test`: the host's checks (library, tabs, autosave, agents registry, the agents' socket, chat
  stream parsing).
- `cd desktop && npm run test:shell`: the Electron shell with the page on a stand-in for the app's logic: messages,
  dialogs, menus, that the page shows the shortcuts the menu binds (as each of the three systems), the navigation
  lock, quitting, screenshots and recordings.
- `cd desktop && npm run test:ui`: the UI test. The page clicks through itself in the real app on the real core (62
  results, a picture of every checkpoint, a video of the run), shown as the system it runs on or, with
  `--platform`, as another. A run with failures is repeated once; what fails twice fails.
- `cd desktop && npm run test:web`: the same core package in a plain browser (`desktop/web`, files in memory), with
  one session's answers compared with the Node side's.

CI runs all of it on Linux for every pull request (`app-ci`), and builds, tests and packages the app on macOS and
Windows as well.

## History

The app began as a Mac-only one written in Swift, with this editor as a plain-JavaScript page in a web view. The
core, the app logic and the page here are ports of it, checked against it before it was removed: golden files and
saved documents written by that app still pin the core's output and file formats (which is why some comments in
`core/` say "as the Swift app wrote it"), and `docs/desktop-port` is the record of the old page compared with this
one. The last commit that has the old app is `c8ebd04`.
