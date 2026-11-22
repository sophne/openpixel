# OpenPixel desktop: Electron + React + a Rust core in WebAssembly

The cross-platform app. The Mac app in `app/` (Swift + a web view) is the reference it was ported from; file
references below point there.

| Part | Folder | What it is | Ported from |
|---|---|---|---|
| Core | `core/engine` (crate `openpixel-core`) | The document model, undo, every tool, rendering voxels to sprites, file formats, reviews. Pure Rust: all files, time and network go through one small `HostIo` trait, so it builds natively and for `wasm32-unknown-unknown` | `app/Sources/OpenPixelCore` (all but MCP, MCPHTTP, Bridge) |
| Bindings | `core/wasm` (crate `openpixel-wasm`) | The core for JavaScript, built with wasm-bindgen (`--target web`). One package, used by the desktop app today and by a browser later | new |
| MCP program | `core/app` (binary `openpixel`) | What agents start: `openpixel --mcp` (stdio) and `--mcp-http`. Forwards tool calls to the open window over a local socket, or works headless on the native build of the same core | `MCP.swift`, `MCPHTTP.swift`, `Bridge.swift` (client side), `MCPMode.swift`, `main.swift` |
| App logic | `desktop/host` (TypeScript) | Tabs, autosave, the library (Recents, folders, archive), the Agents registry, the agents' socket, Agent Chat, updates. Runs the core through the wasm bindings. Talks to the outside only through `Platform` (`host/platform.ts`); the Node-only pieces (socket server, running the person's agent CLIs) sit in `host/node/` | `AppDelegate.swift` (logic), `Recents.swift`, `Agents.swift`, `Chat*.swift`, `Bridge.swift` (server side) |
| Shell | `desktop/electron` | Window, menus, dialogs, clipboard, screenshots: the Electron `Platform` | `AppDelegate.swift` (AppKit) |
| Page | `desktop/src` | The editor in React + Vite | `app/web` |

```
 React page ──window.openpixel.post(msg)──▶ Electron main: host (TypeScript) ──wasm-bindgen──▶ core (Rust, WASM)
 (renderer) ◀──── window.PC.<fn>(...) ─────        │  Platform: files, dialogs, clipboard, …
                                                   ▲
              agents:  openpixel --mcp (Rust, native core for headless) ──local socket, one JSON per line
```

Why this shape: the core has one JavaScript face (the wasm-bindgen package). The desktop app loads it in Electron's
main process; a web version loads the same package in the browser and swaps `Platform` for one backed by its own
storage (a browser has no file system, so that needs accounts and a database; not built). Nothing else changes.

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
(`--legacy-ui`). That is how old and new are compared side by side on one core.

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
`quitting()`, `dispose()`); see `desktop/host/platform.ts` for `Platform`. The host owns one `Engine` per tab plus the
spare, and behaves as `AppDelegate` did: autosave 1.5 s after a change, one coalesced `PC.refresh(tool)` per burst,
window title updates, save questions on close.

## 4. Agents ⇄ the window

`openpixel --mcp` is the MCP server agents start. It forwards each tool call to the open window over a local socket
(an owner-only Unix socket in the data folder; on Windows the named pipe `\\.\pipe\openpixel-<user>`), with the
line protocol of `Bridge.swift`: one JSON request per line, `{"tool", "args"}` → `{"ok", "json", "images"}` (pictures
as base64), and a `{"hello": info}` line first. The window's side of that socket is `desktop/host/node/bridge.ts`.
Without a window the program works headless on its own engine. `openpixel --mcp-http [port]` serves MCP over HTTP on
this computer only, with file access confined to the files folder. `OPENPIXEL_SOCKET` overrides the socket path.

## 5. The page (React)

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

## 6. Checks

- `cd core && cargo test`: the engine's self-test (port of `SelfTest.swift`), golden files (every `.openpixel` in
  `web/artwork` rendered and compared with the pictures the Swift app exported), the MCP program's checks, and a
  native-versus-WASM comparison of a scripted session.
- `cd desktop && npm test`: the host's checks (library, tabs, autosave, agents registry, chat stream parsing: the
  port of `ChatSelfTest.swift`).
- `cd desktop && npm run test:ui`: the old 59-case UI test against the old page and the React page in Electron, a
  picture of every checkpoint from both, a pixel comparison, and a video of the run. The old page is the yardstick:
  the run fails when the React page fails something the old page passes. The record of the comparison made when the
  port landed is in `docs/desktop-port`.
- `cd desktop && npm run test:web`: the same core package in a plain browser (`desktop/web`, files in memory), with
  one session's answers compared with the Node side's.
