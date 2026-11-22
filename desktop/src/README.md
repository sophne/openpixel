# The editor page

Everything the window shows: the tab bar, the editor, the home screen (Recents, folders, Archive, Agents), the New
file page, Agent Chat, menus and dialogs. React + Vite + TypeScript. The page talks to the app (the logic in
`desktop/host`, on the core) only through `window.openpixel`; see
[docs/desktop-architecture.md](../../docs/desktop-architecture.md) for the messages.

It is in four parts: the **kit** (`lib/`, `kit/`, `state/`, `app/`, `testing/`, `App.tsx`, `main.tsx`), which
everything shares, and three **areas** built on it, each in its own folder:

| Area | Folder | What it is | Its root components |
|---|---|---|---|
| editor | `editor/` | `#app`: the canvases (WebGL 3D view, 2D slice view), tools, layers, frames, colours, preview, review | `Editor.tsx`, `EditorDialogs.tsx` |
| library | `library/` | the tab bar, the home screen, the New file page and dialog, the Agents page and its set-up guides | `TabBar.tsx`, `Home.tsx`, `NewPage.tsx`, `Agents.tsx`, `LibraryMenus.tsx` |
| chat | `chat/` | Agent Chat in the editor's left panel: the person's own agent CLIs, on their subscriptions | `ChatPane.tsx`, `ChatMenus.tsx` |

Working on it, in `desktop/`:

- `npm run dev` runs the app with hot reload. `npx vite` alone serves the page at http://localhost:5173/ without the
  app (see `lib/host.ts`: tools fail, Agent Chat talks to a scripted agent); `?screenshot` paints the dark background
  and `?platform=win32` or `linux` shows that system's wording.
- `npm run typecheck`, `npm run build`.
- `npm run test:ui` is the page's regression test: it runs `tests/uitest.js` inside the real app (below). Run it for
  any change here. `npm run test:shell` checks the shell with this page on a stand-in for the app's logic.

The page began as a port of a page written in plain JavaScript (one script, `app.js`, with a hand-written
`index.html`; removed from the repository, see `docs/desktop-port`). That is why much of the logic is plain functions
that change state and then say so, why some classes are set by hand, and what comments mean by "the old page" or "as
before". The rules below are what that design needs to stay sound.

## Rules

1. **The DOM is a contract.** `style.css` (ids, classes, child order, every breakpoint and container rule) and the UI
   test (`tests/uitest.js`) both address elements by id, class, `data-` and `aria-` attributes and position. Do not
   add wrappers, rename classes or reorder elements without changing both.
2. **Function components and hooks.** Drawing code for the canvases (WebGL, the 2D slice, the colour square) lives in
   plain `.ts` modules that get their canvas from a ref.
3. **State lives in stores** (`S`, `ui`, `home`, `sv`, `cam`, `pk`, `leftSide`, `homePrefs`, `chatState`, …):
   `export const sv = store({ … })`, a plain object you read and write directly. After changing one, call
   `changed(store)`; a component that reads one calls `useStore(store)` itself (passing the object down as a prop
   does not subscribe the child). Module variables that nothing on screen depends on (`sliceDirty`, `refreshing`, a
   drag in progress) stay plain `let`s.
4. **`changed()` draws before it returns.** It renders the subscribed components synchronously, so code may measure
   or read the DOM on the very next line, and so can the UI test (`c.click(); assert(done.classList…)`,
   `PC.command('shortcuts'); assert($$('#shortcuts-body h3')…)`). Several stores in a row: `changed(a, b)` or
   `batch(() => { … })` for one render.
   React's own state does not do this (measured here, React 19): a `useState` set in a click handler is on screen a
   microtask *after* `el.click()` returns, and one set from a timer or a promise a task later. So use `useState` only
   for things nobody reads back at once; everything code or the test reads right after goes in a store.
   Called from an effect or ref callback while a render is under way, `changed()` only marks the store and React draws
   it in the same pass. If React logs "flushSync was called from inside a lifecycle method", the call sits in an
   effect of a render React started itself (a `useState` update): move that state to a store.
   Hot paths (pointer moves, every frame: the cursor chip, the canvases) write to the DOM through refs, not
   `changed()`.
5. **Classes and text the kit sets by hand.** Open and highlighted states are put on the element the moment something
   happens, not through React: `open` on `.menu`, `.card-menu` and `.modal-bg`; `kb` and `sel` on menu rows;
   `show`/`agent` on `#toast`; `out` in copy buttons; `title` → `data-tip`/`aria-label` (tooltips); the text of
   `#name-title`, `#name-ok`, `#confirm-*`; the field `inlineRename()` puts into an element. React writes an
   attribute again whenever its value in JSX changes, which would undo these. So **an element that carries one of
   them keeps a constant `className` in JSX** (put changing classes on a child, or toggle them with `classList` from a
   ref), and an element `inlineRename()` edits is a `<RenameText>` (it has no React children).
6. **Events.** React handlers run when the event reaches `#root`, after any listener added with `addEventListener` on
   an element inside it, and before listeners on `document`/`window` (bubble phase). `e.stopPropagation()` in a React
   handler keeps the event from `document` and `window` (a menu button stops the click so the document's "click
   elsewhere closes menus" never sees it). Do not add native listeners that stop propagation on elements that also
   have React handlers on them or above them: the React handlers would never run. For `window`/`document` listeners
   and events React lacks, use `useEvent(target, type, fn)`. `onChange` in React is the `input` event; for a
   committed value use `<Stepper onCommit>` or `useEvent(ref, 'change', fn)`.
7. **Text fields.** Typing must never reach the page's shortcuts: every `<input>` that is not a range gets
   `onKeyDown={stopKeys}`, or calls `e.stopPropagation()` first in its own handler (`<Stepper>` and the name dialog
   already do).
8. **Titles are tooltips.** Write `title="Undo (⌘Z)"`, the shortcut the Mac's way. The kit turns titles into its own
   tooltips (`data-tip`, key caps). Titles present after the first render are adopted at once, later ones on first
   hover; an element that is empty and has no `aria-label` then gets its name from the title. For a title that
   changes (`Delete ${layer} (⌘⌫)`) use `ref={useTitle(text)}` instead of the `title` prop.
9. **Wording for three systems.** Shortcuts are written once, the Mac's way, and shown through `lib/platform.ts`:
   `shortcutLabel('⇧⌘S')` in menu rows, `keyCaps([...])` in the shortcuts dialog, tooltips by themselves. Off the
   Mac ⌘ reads Ctrl, which is what the menu bar binds there (`CmdOrCtrl` in `electron/menu.ts`; the shell's test
   checks that the page and the menu agree). "Show in Finder" is `REVEAL_LABEL`, "this Mac" `THIS_COMPUTER`, a path
   shown with `~` is `tildePath(path)`, and a key handler's "is the menu modifier down" is `menuModifier(e)`. The
   library's words (`your Mac`, `the Trash`, `Terminal`) are in `library/wording.ts`. The Agents page's guides name
   an agent's settings file only as the app found it on this computer (`library/agentsPage.ts`: `settingsFile`), and
   always show the command the app reports (`mcpCommand`). The UI test checks the wording for the system it runs as.
10. **Nothing from a file or an agent becomes markup.** Render it as text (`{name}`); never
    `dangerouslySetInnerHTML` with it. Icons are `<Icon name size className id/>`; an agent logo from the bundled table
    is `<TrustedSvg html={agentLogoSvg(a.logo, icon('plug', 18))}/>`, the only sanctioned use.
11. **No area imports another area's files** (the one exception: `editor/Editor.tsx` mounts `chat/ChatPane`). Calls
    across areas go through `actions` (below); shared stores and tables are in `state/`.
12. **Keep dependencies few**: React and nothing else at run time.

## Module map

| Module | Exports |
|---|---|
| `lib/store.ts` | `store(obj)`, `changed(...stores)`, `useStore(store)`, `batch(fn)`, `flush()`, `versionOf(store)`, `watch(store, fn)` |
| `lib/host.ts` | `host`, `hasHost`, `platform`, `flags` (`start`, `uitest`, `screenshot`, `demo`), `SCREENSHOT`, `post(msg)`, `call(name, args)`, `nativeAction(action, extra)`, `chatNative(action, extra)`, `setChatMock(fn)`, `bridge` (for the test scripts), `overrides`; types `OpenPixelHost`, `HostFlags`, `Platform`, `PageCalls`; declares `window.openpixel`, `window.PC` |
| `lib/dom.ts` | `$`, `$$`, `escapeHtml`, `errorText`, `stopKeys`, `useEvent(target, type, fn, options)` |
| `lib/motion.ts` | `EASE_OUT`, `reducedMotion`, `lastInput` (read) / `setLastInput(v)`, `originFrom(trigger, box)`, `popIn(el, origin, {scale, duration})` |
| `lib/icons.tsx` | `<Icon name size className id/>`, `icon(name, size)` (string), `fillIcons(root)`, `LUCIDE`, `AGENT_LOGOS`, `agentLogoSvg(logo, fallback)`, `<TrustedSvg as html/>` |
| `lib/icon-data.ts`, `lib/agent-logo-data.ts` | the icon and agent-logo tables (see Assets) |
| `lib/platform.ts` | `platform`, `isMac`, `keyLabel`, `shortcutKeys`, `shortcutLabel`, `keyCaps`, `menuModifier(e)`, `THIS_COMPUTER`, `REVEAL_LABEL`, `tildePath` |
| `lib/pc.ts` | `PC` (`window.PC`: what the app calls on the page, through `actions`), `press(sel, whyDisabled)` |
| `lib/format.ts` | `timeAgo(t)` |
| `kit/index.ts` | everything below, re-exported: import from `'../kit'` |
| `kit/toast.tsx` | `toast(msg, agent)`, `<Toast/>` (`#toast`, rendered by the editor in `#stage`) |
| `kit/tooltips.ts` | `hideTip()`, `adoptTitle(el)`, `adoptTitles(root)`, `tipParts(text)`, `useTitle(text)` |
| `kit/copy.tsx` | `copyButton(btn, text)` (element built by hand), `<CopyButton text className/>` |
| `kit/Dropdown.tsx` | `<Dropdown options value placeholder keepLabel onChange button before ref …host attributes/>`; `ref` receives `{ value, set(v) }` |
| `kit/Stepper.tsx` | `<Stepper min max stepSize title className hidden input={{id, className, defaultValue, …}} inputRef onCommit/>` |
| `kit/menus.ts` | `closeMenus()`, `openedMenu(list, trigger)`, `openMenuList()`, `menuItems(list)`, `moveMenu(list, step, to)`, `placeMenu(menu, anchor)`, `placeFixed(el, x, y)`, `onMenuButton` (the `onClick` of a `[data-menu]` button) |
| `kit/modals.tsx` | `openModal('#id')`, `closeModals()`, `<Modal id labelledBy role className width>` (`.modal-bg` + `.modal`; closes on its backdrop and on `[data-close]`), `<Dialogs/>` (`#name-dialog`, `#confirm-dialog`), `askName(title, okLabel, value)`, `askConfirm(title, body, okLabel)`, `finishDialog(v)` |
| `kit/pressable.ts` | `pressableProps(label, role)` (spread in JSX), `pressable(el, label, role)` |
| `kit/rename.tsx` | `inlineRename(el, current, commit)`, `<RenameText as text …/>` |
| `kit/haptics.ts`, `kit/keys.ts` | `haptic()`; installed by the kit: the tap on `.haptic, .tb-add`, and Escape |
| `state/ui.ts` | stores `S`, `ui`, `leftSide`, `home`; `activeTabName()`; types `DocState`, `Layer`, `Frame`, `Tab`, `UiState`, `LeftSide`, `LibraryFile`, `LibraryFolder`, `LibraryTarget`, `HomeState` |
| `state/palettes.ts`, `state/agents.ts` | `PRESETS`; `AGENTS` |
| `app/actions.ts` | `actions`, `registerActions(part)`, `missingActions()`, `ACTION_OWNERS`, type `Actions` |
| `app/pages.ts` | `showEditor()`, `hidePages()` |
| `app/startup.ts` | `prepare()`, `start()` (called by `main.tsx`) |
| `testing/compat.ts` | `registerCompat(names)`, `missingCompat(list)`, `checkCompat()`, `UITEST_NAMES`, `UITEST_WRITES`, `DEMO_NAMES` |

`App.tsx` renders, in document order: `<TabBar/>` (`library/TabBar`), `<Editor/>` (`editor/Editor`: `#app` itself and
everything in it, with `<ChatPane/>` from `chat/ChatPane` and the kit's `<Toast/>` inside), `<Home/>`
(`library/Home`, which mounts `<AgentsList/>` from `library/Agents`), `<NewPage/>`, `<LibraryMenus/>`, `<ChatMenus/>`,
`<NewFileDialog/>` (`library/NewPage`), the kit's `<Dialogs/>`, `<Picker/>` (`editor/EditorDialogs`),
`<AgentDialogs/>` (`library/Agents`), `<ShortcutsDialog/>`, `<ReviewDialog/>` (`editor/EditorDialogs`).

`#doc-menu` is rendered by `library/LibraryMenus`, but it is the **editor's** menu (`openDocMenu`, `docMenuAction` in
`editor/sidebar.ts`): its rows call `actions.docMenuAction(act)`.

## Pages

`ui.view` says what fills the window. Nothing sets `hidden` on `#home`/`#newpage` by hand: `Home` renders
`hidden={ui.view !== 'home'}`, `NewPage` `hidden={ui.view !== 'new'}`, and `App` keeps `<body data-view>` in step. So
`showHome()` and `openNewPage()` set `ui.view` (and `S.home`) and call `changed(ui)`. `showEditor()`/`hidePages()` are
in `app/pages.ts`.

Startup (`app/startup.ts`): `prepare()` installs the kit's listeners and `window.PC`; after the first render,
`start()` adopts titles, then calls `actions.initEditor()`, `actions.initLibrary()`, `actions.initChat()`, then
`actions.refresh()`, then `showHome()` or `showEditor()` and `actions.editorReady()`.

## Actions: calls between areas

`import { actions, registerActions } from '../app/actions'`. The owner fills its slots at the top level of one of its
modules (`registerActions({ refresh, setMode, … })`); everyone calls `actions.refresh()`. An unfilled slot does
nothing (and `start()` lists the unfilled ones in the console in development). The slots are typed and described in
`app/actions.ts`:

| Slot | Owner | Used by |
|---|---|---|
| `initEditor()`, `editorReady()` | editor | startup |
| `refresh(): Promise<void>` | editor | library, `PC.refresh`, startup |
| `setMode(mode)` | editor | library (restoring a tab's view), `PC.command` |
| `fitSlice()` | editor | `showEditor`, `PC.command` |
| `sliceSize(axis?)`, `updateSliceLabel()`, `redraw()` | editor | library (restoring a tab's view), `showEditor` |
| `resetCamera()`, `zoomStep(dir, animate?)`, `togglePlay()`, `showReview()`, `showShortcuts()`, `setPixelGrid(on)`, `setLeftOpen(open)` | editor | `PC.command` |
| `stopPlay()`, `closePicker()` | editor | library (leaving the editor), Escape |
| `renameFile(where, name)` | editor | library (tabs, cards) |
| `docMenuAction(act)` | editor | `library/LibraryMenus` (`#doc-menu` rows) |
| `initLibrary()` | library | startup |
| `applyTabs(r)`, `renderTabs(force?)` | library | editor (`refresh`, `renameFile`) |
| `reportTitlebar()` | library | kit (`openModal`, `closeModals`), `PC.fullScreen` |
| `closeTab(id)` | library | editor (`docMenuAction`), `PC.closeActiveTab` |
| `showHome(view?)` | library | chat, `PC`, startup, `showEditor` |
| `hideHome()`, `closeNewPage()` | library | Escape, `PC.closeActiveTab` |
| `loadHome()` | library | editor (`renameFile`) |
| `openMoveMenu(anchor, target)` | library | editor (`docMenuAction`) |
| `openNewPage()` | library | editor (the main menu's New…), `PC.showNewDialog` |
| `showStars(n)`, `showAgentHelp()`, `showUpdate(version)` | library | `PC` |
| `stopAgentsPolling()` | library | `hidePages` |
| `initChat()` | chat | startup |
| `chatOpened()`, `syncChatFile()`, `chatBusy()`, `openChat()` | chat | editor |
| `chatForget(key)` | chat | library (after deleting a file for good) |
| `chatEvent(e)`, `chatMoved(from, to)` | chat | `PC` |

Shared without a slot, because they are in the kit: `S`, `ui`, `leftSide`, `home`, `activeTabName`, `PRESETS`,
`AGENTS`, `timeAgo`, `showEditor`.

Elements one area's code touches in another's component (by id): the chat shows `#chat-dot`, which the editor's rail
renders (`hidden`; the chat un-hides it; `applyLeftSide` hides it again). The editor's key handler focuses
`#home-search` on `/`. `PC.command` clicks `#layer-add`, `#layer-dup`, `#layer-merge`, `#layer-del`, `#frame-add`,
`#frame-del`, `#onion`, `#frames-toggle`: they must stay real buttons with those ids and `disabled`.

## How the UI test reaches the page

`desktop/tests/uitest.js` is the app's UI test: one plain script that runs *inside* the page and clicks through it
(62 results: drawing tools, layers, frames, 2D and 3D, menus, dialogs, tooltips, shortcuts, the library, the Agents
page with real agent connections, tabs, every export, panel and window sizes, and three audits: button centring,
control rows, accessibility). `desktop/tests/demo.js` records the website's demo the same way.

Both use the page's functions and state by name, as if they were globals: `S`, `ui`, `$`, `call`, `refreshing`,
`setMode`, `sv`, … The page's modules have no globals, so each area publishes the names it owns:

```ts
registerCompat({ setMode, sv, get refreshing() { return refreshing; } });   // a getter for every `let`; a setter too for names the script assigns
```

They are collected on `window.__OP`, and the shell runs the script as ``with (window.__OP) {\n…\n}``
(`runScriptInPage` in `electron/main.ts`: the page's Content-Security-Policy forbids the page compiling text itself,
which the shell is not bound by). `testing/compat.ts` lists every name each script needs and its owner
(`UITEST_NAMES`, `DEMO_NAMES`); `checkCompat()` says in the console which are missing when a run starts.

| Owner | uitest.js needs | demo.js needs |
|---|---|---|
| kit | `$ $$ bridge call nativeAction` (assigned) `closeMenus closeModals openModal S ui leftSide home activeTabName`, and `window.PC` | `$ bridge nativeAction errorText toast lastInput` (assigned) `S leftSide showEditor` |
| editor | `refreshing stateReady` (getters), `render3dDirty` (getter + setter), `ZOOMS glCanvas sliceCanvas sctx sv cam viewProj pick3d resetCamera setMode setFg setSize setFramesOpen setPixelGrid setLeftOpen applyLeftSide closePicker` | `refresh stateReady setMode fitSlice resetCamera setSize SIZES applyLeftSide` |
| library | `homePrefs filterMenu titlebarSent` (getters for the last two), `agentsState setHomeLayout setHomeSort loadHome loadAgents closeNewPage fileById folderById latestInFolder` | — |
| chat | — | `chatState readyProviders renderChatPickers renderChatThread` |

So a function the test calls must stay callable under its name with the same effect (`applyLeftSide()` after writing
`leftSide.pane` directly, `setHomeLayout('grid')`, `closeNewPage()`), and a new thing the test should reach is
published with `registerCompat` and added to the list.

The test knows which system the page is shown as (`window.openpixel.platform`; `npm run test:ui -- --platform darwin`
shows the Mac's layout and wording on any machine) and checks layout and wording accordingly. When a case fails, fix
the page or, if the case itself is wrong, the case: never skip one. A tolerance in a case states its reason.

## Styles

- `style.css` is the app's stylesheet: tokens in `:root` (colours, sizes, the contrast-checked text colours), then the
  parts of the page. The UI test measures what it sets: one height and centre line per row of controls, one fill and
  radius per kind of control, labels and icons on the button's middle, 4.5:1 text contrast.
- `platform.css` holds only what differs between systems: the fonts for Windows and Linux, and the room the window's
  own buttons take in the tab bar (left on macOS, right elsewhere).

## Assets

- `lib/icon-data.ts`: the icons the app uses, from [Lucide](https://lucide.dev) (ISC, `lib/LUCIDE-LICENSE.txt`). The
  table is the source; its header says how to add an icon. The app's own icons are in `lib/icons.tsx`.
- `lib/agent-logo-data.ts`: generated by `desktop/tools/make-agent-logos.mjs` from the SVG files in
  `desktop/assets/agent-logos` (LobeHub icons, MIT, `lib/AGENT-LOGOS-ATTRIBUTION.txt`).
- `empty/*.png`: the empty states' animated sprite sheets, drawn with OpenPixel itself by
  `desktop/tools/make-empty-states.py`; their `.openpixel` sources are in `desktop/assets/empty`.
- Both licence files go out with every build (`dist/licenses/`, see `vite.config.ts`).
