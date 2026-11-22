# The editor page in React

This folder is the port of `app/web` (the page the Mac app shows in a web view) to React + Vite + TypeScript. It must
look and behave exactly like the old page: same pages, interactions, animations and breakpoints. `style.css` is
`app/web/style.css` copied byte for byte and is never edited (additions go in `platform.css`), and the old UI test
(`app/web/uitest.js`, 59 cases) is run against this page. Both only work if the DOM is the old DOM.

The port is split in four: the **kit** (`lib/`, `kit/`, `state/`, `app/`, `testing/`, `App.tsx`, `main.tsx`: done, do
not edit from an area; ask for a change instead) and three areas built on it, each in its own folder:

| Area | Folder | From app.js (lines) | Replaces these placeholders |
|---|---|---|---|
| editor | `editor/` | 22–28, 43–44, 220–231, 233–1663, 2918–3284, 4321–4342, minus the kit's parts below | `Editor.tsx`, `EditorDialogs.tsx` |
| library | `library/` | 1664–2900, 3286–3300, minus the kit's parts below | `TabBar.tsx`, `Home.tsx`, `NewPage.tsx`, `Agents.tsx`, `LibraryMenus.tsx` |
| chat | `chat/` | 3302–4262 | `ChatPane.tsx`, `ChatMenus.tsx` |

Check with `npm run typecheck` and `npx vite build` in `desktop/`. `npx vite` serves the page at
http://localhost:5173/; it runs without the app (see `lib/host.ts`), `?screenshot` paints the dark background and
`?platform=win32` or `linux` shows that platform's wording.

## Rules

1. **Same DOM.** Components render what `index.html` holds and what `app.js` builds: same tags, ids, classes, `data-`
   and `aria-` attributes, text, and order. Do not add wrappers, rename classes or restyle. The placeholders are
   `index.html` turned into JSX mechanically (866 nodes, checked equal): start from them and keep every node.
2. **Real React.** Function components and hooks. What a `render…()` function drew becomes JSX that reads a store;
   what `wire…()` attached becomes `onClick`, `onKeyDown`… on the element. Drawing code for the canvases (WebGL, the
   2D slice, the colour square) stays in plain `.ts` modules that get their canvas from a ref.
3. **State in stores with the old names** (`S`, `ui`, `home`, `sv`, `cam`, `pk`, `leftSide`, `homePrefs`,
   `chatState`, …): `export const sv = store({ … })`, a plain object you read and write directly. After changing one,
   call `changed(store)`; a component that reads one calls `useStore(store)` itself (passing the object down as a prop
   does not subscribe the child). Module variables that nothing on screen depends on (`sliceDirty`, `refreshing`, a
   drag in progress) stay plain `let`s.
4. **`changed()` draws before it returns.** The old page changed the DOM inside the call (`renderTabs()`,
   `updatePanels()`), and both the code and the UI test read the DOM on the next line
   (`c.click(); assert(done.classList…)`, `PC.command('shortcuts'); assert($$('#shortcuts-body h3')…)`). `changed()`
   keeps that: it renders the subscribed components synchronously. So where the old function ended with a render
   call, yours ends with `changed(store)`, and code after it may measure the result. Several stores in a row:
   `changed(a, b)` or `batch(() => { … })` for one render.
   React's own state does not do this (measured here, React 19): a `useState` set in a click handler is on screen a
   microtask *after* `el.click()` returns, and one set from a timer or a promise a task later. So use `useState` only
   for things nobody reads back at once; everything the old code or the test reads right after goes in a store.
   Called from an effect or ref callback while a render is under way, `changed()` only marks the store and React draws
   it in the same pass. If React logs "flushSync was called from inside a lifecycle method", the call sits in an
   effect of a render React started itself (a `useState` update): move that state to a store.
   Hot paths (pointer moves, every frame: the cursor chip, the canvases) write to the DOM through refs, not
   `changed()`.
5. **Classes and text the kit sets by hand.** Open and highlighted states are put on the element the moment something
   happens, exactly as before, not through React: `open` on `.menu`, `.card-menu` and `.modal-bg`; `kb` and `sel` on
   menu rows; `show`/`agent` on `#toast`; `out` in copy buttons; `title` → `data-tip`/`aria-label` (tooltips); the
   text of `#name-title`, `#name-ok`, `#confirm-*`; the field `inlineRename()` puts into an element. React writes an
   attribute again whenever its value in JSX changes, which would undo these. So **an element that carries one of
   them keeps a constant `className` in JSX** (put changing classes on a child, or toggle them with `classList` from a
   ref), and an element `inlineRename()` edits is a `<RenameText>` (it has no React children).
6. **Events.** React handlers run when the event reaches `#root`, after any listener added with `addEventListener` on
   an element inside it, and before listeners on `document`/`window` (bubble phase). `e.stopPropagation()` in a React
   handler keeps the event from `document` and `window`, as it did in the old `onclick`s (a menu button stops the
   click so the document's "click elsewhere closes menus" never sees it). Do not add native listeners that stop
   propagation on elements that also have React handlers on them or above them: the React handlers would never run.
   For `window`/`document` listeners and events React lacks, use `useEvent(target, type, fn)`.
   `onChange` in React is the `input` event; where app.js used `.onchange` / `'change'` (a committed value) use
   `<Stepper onCommit>` or `useEvent(ref, 'change', fn)`.
7. **Text fields.** `wire()` stopped `keydown` at every `<input>` that is not a range, so typing never reaches the
   page's shortcuts. Every such input gets `onKeyDown={stopKeys}`, or calls `e.stopPropagation()` first in its own
   handler (`<Stepper>` and the name dialog already do).
8. **Titles.** Write `title="Undo (⌘Z)"` as the old markup did, with the Mac's glyphs. The kit turns titles into its
   own tooltips (`data-tip`, key caps; `Ctrl`/`Shift`/`Alt` off the Mac). Titles present after the first render are
   adopted at once, later ones on first hover, as before; an element that is empty and has no `aria-label` then gets
   its name from the title (`#doc-name` did; `#preset` is given `aria-label` in JSX because its dropdown now fills it
   first). For a title app.js wrote on every redraw (`$('#layer-del').title = …`, `b.title = open ? … : …`) use
   `ref={useTitle(text)}` instead of the `title` prop.
9. **Platform wording.** Shortcuts shown in rows and dialogs go through `shortcutLabel('⇧⌘S')` / `keyCaps([...])`,
   "Show in Finder" is `REVEAL_LABEL`, a path shown with `~` is `tildePath(path)`, and the key handler's
   `if (e.metaKey) return` is `if (menuModifier(e)) return` (all in `lib/platform.ts`). On macOS, and without a host,
   they return exactly what the old page showed.
10. **Nothing from a file or an agent becomes markup.** Render it as text (`{name}`); never
    `dangerouslySetInnerHTML` with it. Icons are `<Icon name size className id/>`; an agent logo from the bundled table
    is `<TrustedSvg html={agentLogoSvg(a.logo, icon('plug', 18))}/>`, the only sanctioned use.
11. **No area imports another area's files** (the one exception: `editor/Editor.tsx` mounts `chat/ChatPane`). Calls
    across areas go through `actions` (below); shared stores and tables are in `state/`.
12. **No behaviour changes, no new libraries**, and the old function names stay for everything in the two lists
    below. Keep the old comments that explain why.

## Module map

| Module | Exports |
|---|---|
| `lib/store.ts` | `store(obj)`, `changed(...stores)`, `useStore(store)`, `batch(fn)`, `flush()`, `versionOf(store)`, `watch(store, fn)` |
| `lib/host.ts` | `host`, `hasHost`, `platform`, `flags` (`start`, `uitest`, `screenshot`, `demo`), `SCREENSHOT`, `post(msg)`, `call(name, args)`, `nativeAction(action, extra)`, `chatNative(action, extra)`, `setChatMock(fn)`, `bridge` (old name, for the test scripts), `overrides`; types `OpenPixelHost`, `HostFlags`, `Platform`, `PageCalls`; declares `window.openpixel`, `window.PC` |
| `lib/dom.ts` | `$`, `$$`, `escapeHtml`, `errorText`, `stopKeys`, `useEvent(target, type, fn, options)` |
| `lib/motion.ts` | `EASE_OUT`, `reducedMotion`, `lastInput` (read) / `setLastInput(v)`, `originFrom(trigger, box)`, `popIn(el, origin, {scale, duration})` |
| `lib/icons.tsx` | `<Icon name size className id/>`, `icon(name, size)` (string), `fillIcons(root)`, `LUCIDE`, `AGENT_LOGOS`, `agentLogoSvg(logo, fallback)`, `<TrustedSvg as html/>` |
| `lib/platform.ts` | `platform`, `isMac`, `keyLabel`, `shortcutKeys`, `shortcutLabel`, `keyCaps`, `menuModifier(e)`, `REVEAL_LABEL`, `tildePath` |
| `lib/pc.ts` | `PC` (the old `window.PC`, function for function, calling `actions`), `press(sel, whyDisabled)` |
| `lib/format.ts` | `timeAgo(t)` |
| `kit/index.ts` | everything below, re-exported: import from `'../kit'` |
| `kit/toast.tsx` | `toast(msg, agent)`, `<Toast/>` (`#toast`, rendered by the editor in `#stage`) |
| `kit/tooltips.ts` | `hideTip()`, `adoptTitle(el)`, `adoptTitles(root)`, `tipParts(text)`, `useTitle(text)` |
| `kit/copy.tsx` | `copyButton(btn, text)` (element built by hand), `<CopyButton text className/>` |
| `kit/Dropdown.tsx` | `<Dropdown options value placeholder keepLabel onChange button before ref …host attributes/>`; `ref` receives the old return value `{ value, set(v) }` |
| `kit/Stepper.tsx` | `<Stepper min max stepSize title className hidden input={{id, className, defaultValue, …}} inputRef onCommit/>` (replaces `wireSteppers()` and the `Increase`/`Decrease` names) |
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
| `testing/compat.ts` | `registerCompat(names)`, `missingCompat(list)`, `UITEST_NAMES`, `UITEST_WRITES`, `DEMO_NAMES`, `runLegacyScript(text)`, `loadUiTest()` |

`App.tsx` renders, in the old document order: `<TabBar/>` (`library/TabBar`), `<Editor/>` (`editor/Editor`: `#app`
itself and everything in it, with `<ChatPane/>` from `chat/ChatPane` and the kit's `<Toast/>` inside), `<Home/>`
(`library/Home`, which mounts `<AgentsList/>` from `library/Agents`), `<NewPage/>`, `<LibraryMenus/>`, `<ChatMenus/>`,
`<NewFileDialog/>` (`library/NewPage`), the kit's `<Dialogs/>`, `<Picker/>` (`editor/EditorDialogs`),
`<AgentDialogs/>` (`library/Agents`), `<ShortcutsDialog/>`, `<ReviewDialog/>` (`editor/EditorDialogs`). Keep these
paths and export names.

### Already ported: do not port these again

| app.js | Now |
|---|---|
| 6–20 `$ $$ bridge SCREENSHOT call nativeAction`, 3329 `chatNative` | `lib/dom`, `lib/host` (`if (bridge) bridge.postMessage(m)` → `post(m)`; the chat registers `chatMock` with `setChatMock`) |
| 30–41 `S`, 1668 `ui`, 654–656 `leftSide`, 682 `activeTabName`, 1814 `home` | `state/ui` |
| 46–54 toast, errorText; 56–128 tooltips; 130–146 copy button; 148–173 motion; 175–218 icons; 316 `escapeHtml` | `kit`, `lib` |
| 692–716 `inlineRename`; 2901–2916 `pressable`; 1583–1652 `placeFixed`, `dropdown`, `wireSteppers` | `kit` |
| 1576–1582 `PRESETS`; 2614–2631 `AGENTS`; 1835–1842 `timeAgo` | `state/palettes`, `state/agents`, `lib/format` |
| 1795–1809 `hidePages`, `showEditor` | `app/pages` |
| 2171–2185 `placeMenu`; 3015–3084 modals and menus | `kit` |
| 2296–2319 and 2455–2467 name and confirm dialogs (in `wireHome`); 2468–2472 haptics | `kit` |
| `wire()`: 3125–3134 `[data-menu]` and the document click; 3148–3149 `[data-close]` and backdrops; 3213 stepper names; 3221 inputs' keydown; 3223 `wireSteppers()`; 3233–3236 Escape | `onMenuButton`, `kit/menus`, `<Modal>`, `<Stepper>`, `stopKeys`, `kit/keys` (the editor's key handler keeps everything else, starting after the Escape branch) |
| 4263–4319 `window.PC`, `press` | `lib/pc` |
| 4344–4356 startup; 128 adopting titles; 4344 `fillIcons()` | `app/startup` (`<Icon>` replaces `<i data-icon>`) |

Three things sit in one area's line range but belong to another: `showUpdate` and the two lines after it
(3286–3300, the `#tab-update` button) are the **library's**; `renameFolderTo` (726–730) is the **library's** (only it
calls it); `#doc-menu` is rendered by `library/LibraryMenus`, but `openDocMenu`/`docMenuAction` (735–757) are the
**editor's** and its rows call `actions.docMenuAction(act)` (already wired in the placeholder).

## Pages

`ui.view` says what fills the window. Nothing sets `hidden` on `#home`/`#newpage` by hand: `Home` renders
`hidden={ui.view !== 'home'}`, `NewPage` `hidden={ui.view !== 'new'}`, and `App` keeps `<body data-view>` in step. So
`showHome()` and `openNewPage()` set `ui.view` (and `S.home`) and call `changed(ui)` where the old ones set `hidden`
and called `renderTabs()`. `showEditor()`/`hidePages()` are in `app/pages.ts`.

Startup (`app/startup.ts`): `prepare()` installs the kit's listeners and `window.PC`; after the first render,
`start()` adopts titles, then calls `actions.initEditor()`, `actions.initLibrary()`, `actions.initChat()`, then
`actions.refresh()`, then `showHome()` or `showEditor()` and `actions.editorReady()`. Most of what the `wire…()`
functions did is now handlers in JSX and mount effects; the `init…` slots are for the rest, in the old order.

## Actions: calls between areas

`import { actions, registerActions } from '../app/actions'`. The owner fills its slots at the top level of one of its
modules (`registerActions({ refresh, setMode, … })`); everyone calls `actions.refresh()`. An unfilled slot does
nothing (and `start()` lists the unfilled ones in the console in development). The list is every function or variable
app.js defines in one area and uses in another, found by parsing app.js and resolving each free name to the area of
its definition.

| Slot | Owner | Used by (app.js lines) |
|---|---|---|
| `initEditor()` — `initGL(); buildTools(); initResizers();` the editor's part of `wire()`; `setAxis('z'); setMode('slice'); requestAnimationFrame(loop)` | editor | startup (4345–4350, 4356) |
| `editorReady()` — `sizeThumbs(); stateReady = true; frameCount = 0` | editor | startup (4353–4354) |
| `refresh(): Promise<void>` | editor | library (1779, 1790, 2581), `PC.refresh`, startup |
| `setMode(mode)` | editor | library (1771 `restoreTabView`), `PC.command` |
| `fitSlice()` | editor | `showEditor` (1807), `PC.command` |
| `sliceSize(axis?)`, `updateSliceLabel()` | editor | library (1770, 1772 `restoreTabView`) |
| `redraw()` — `render3dDirty = true; sliceDirty = true` | editor | library (1772), `showEditor` (1806) |
| `resetCamera()`, `zoomStep(dir, animate?)`, `togglePlay()`, `showReview()`, `showShortcuts()`, `setPixelGrid(on)`, `setLeftOpen(open)` | editor | `PC.command` |
| `stopPlay()` | editor | library (1775, 1785, 1817, 2479) |
| `closePicker()` | editor | library (1775, 1817, 2479), Escape |
| `renameFile(where, name)` | editor | library (1705 tabs, 1988 cards) |
| `docMenuAction(act)` | editor | `library/LibraryMenus` (`#doc-menu` rows, 3209) |
| `initLibrary()` — what `wireHome()`, `wireNewPage()`, `wireNewFileDialog()` did that is not a JSX handler; lines 3299–3300 | library | startup |
| `applyTabs(r)` | library | editor (255 `refresh`) |
| `renderTabs(force?)` — `force` is the old `tabsDrawn = ''` first | library | editor (722 `renameFile`) |
| `reportTitlebar()` | library | kit (`openModal`, `closeModals`), `PC.fullScreen` |
| `closeTab(id)` | library | editor (749 `docMenuAction`), `PC.closeActiveTab` |
| `showHome(view?)` | library | chat (3559, 3730), `PC`, startup, `showEditor` |
| `hideHome()`, `closeNewPage()` | library | Escape (3234), `PC.closeActiveTab` |
| `loadHome()` | library | editor (723 `renameFile`) |
| `openMoveMenu(anchor, target)` | library | editor (755 `docMenuAction`; it also fills `home.files`/`home.folders`, 752–753) |
| `openNewPage()` | library | editor (3136, the main menu's New…), `PC.showNewDialog` |
| `showStars(n)`, `showAgentHelp()`, `showUpdate(version)` | library | `PC` |
| `stopAgentsPolling()` — `clearInterval(agentsState.timer)` | library | `hidePages` (1797) |
| `initChat()` — what `wireChat()` did that is not a JSX handler | chat | startup |
| `chatOpened()`, `syncChatFile()` | chat | editor (297: `if (chatState.opened) syncChatFile()`) |
| `chatBusy()` | chat | editor (646: no agent toast while the chat is replying) |
| `openChat()` | chat | editor (671 `applyLeftSide`) |
| `chatForget(key)` | chat | library (2267, after deleting a file for good) |
| `chatEvent(e)`, `chatMoved(from, to)` | chat | `PC` |

Used across areas without a slot, because they are in the kit now: `S`, `ui`, `leftSide` (chat 4036, 4211),
`home` (editor 752), `activeTabName` (chat 3568, 3886), `PRESETS` (library 2535, 2545), `AGENTS` (chat 3486),
`timeAgo` (chat 3670), `showEditor`.

Elements one area's code touches in another's component (by id): the chat shows `#chat-dot` (4037), which the
editor's rail renders: read `leftSide` and chat state through a store or set `hidden` from a ref, but agree on one
owner (the editor renders it `hidden`; the chat un-hides it; `applyLeftSide` hides it again). The editor's key handler
focuses `#home-search` on `/` (3237). `PC.command` clicks `#layer-add`, `#layer-dup`, `#layer-merge`, `#layer-del`,
`#frame-add`, `#frame-del`, `#onion`, `#frames-toggle`: they must stay real buttons with those ids and `disabled`.

## The old UI test and demo script

`app/web/uitest.js` and `demo.js` were written for app.js: they use its functions and variables as globals. Each area
publishes the names it owns: `registerCompat({ setMode, sv, get refreshing() { return refreshing; } })` (a getter for
every `let`, a setter too for the names the script assigns). The scripts then run inside `with (window.__OP) { … }`.
The names, found by resolving every free name of the two scripts against app.js's top-level names:

| Owner | uitest.js needs | demo.js needs |
|---|---|---|
| kit (registered) | `$ $$ bridge call nativeAction` (assigned) `closeMenus closeModals openModal S ui leftSide home activeTabName`, and `window.PC` | `$ bridge nativeAction errorText toast lastInput` (assigned) `S leftSide showEditor` |
| editor | `refreshing stateReady` (getters), `render3dDirty` (getter + setter), `ZOOMS glCanvas sliceCanvas sctx sv cam viewProj resetCamera setMode setFg setSize setFramesOpen setPixelGrid setLeftOpen applyLeftSide closePicker` | `refresh stateReady setMode fitSlice resetCamera setSize SIZES applyLeftSide` |
| library | `homePrefs filterMenu titlebarSent` (getters for the last two), `setHomeLayout setHomeSort loadHome loadAgents closeNewPage fileById folderById latestInFolder` | — |
| chat | — | `chatState readyProviders renderChatPickers renderChatThread` |

`glCanvas`, `sliceCanvas` and `sctx` exist only after the first render: publish them as getters. `filterMenu` is the
`{ value, set }` a `<Dropdown ref>` hands over. The test also relies on things staying callable the old way, e.g.
`applyLeftSide()` after writing `leftSide.pane` directly, `setHomeLayout('grid')`, `closeNewPage()`: keep those
functions with their old behaviour (they end in `changed(store)` now).

Running it: `loadUiTest()` (called by `start()` when `flags.uitest` is set) takes the script from `flags.uitest.script`
(the text) or `flags.uitest.url`, or `window.__OP_UITEST = { text } | { url }`, and runs it with `runLegacyScript`.
That compiles text, which the page's Content-Security-Policy (`script-src 'self'`) refuses; then the loader posts
`uitestDone` with `crashed: "the UI test could not be started…"` rather than hang. So the shell should run the test
itself, which the policy does not restrict: after the page has loaded,
``webContents.executeJavaScript('with (window.__OP) {\n' + uitestText + '\n}')`` (the names are published before the
first render, and the script waits for `stateReady` itself). `demo.js` runs the same way.

## How to port a piece of app.js

1. Find its DOM: the nodes in `index.html` (already JSX in your placeholder) and what the function builds
   (`innerHTML`, `createElement`). Write that as JSX in the component at the same place in the tree, node for node.
2. Its state: object stores become `export const x = store({ … })` with the old name and fields; the function's
   reads of other state become `useStore(S)` etc. in the component.
3. Its `render…()`/`update…()` function: the drawing moves into JSX; keep the function under its old name with what
   is left (state changes, then `changed(store)`), because other code and the test call it.
4. Its `wire…()` lines: `el.onclick = f` becomes `onClick={f}` on that element; `addEventListener` on
   `window`/`document` becomes `useEvent`; one-time setup goes in the area's `init…` action.
5. Imperative leftovers that read or measure the DOM (`getBoundingClientRect`, `focus()`, `scrollIntoView`,
   animations with `popIn`) stay as they are, after the `changed()` that drew what they measure, or in a
   `useLayoutEffect` when they must follow every render.
6. Kit pieces: `dropdown(el, …)` → `<Dropdown>` on that element; `.stepper` → `<Stepper>`; `.modal-bg` → `<Modal>`;
   `pressable(el, label)` → `{...pressableProps(label)}`; `icon(name, n)` → `<Icon name size={n}/>`;
   `copyButton(b, text)` → `<CopyButton text className/>`; `inlineRename(el, …)` → call it on a `<RenameText>`'s ref;
   `placeMenu`, `openModal`, `closeMenus`, `toast`, `askName`, `askConfirm` are called as before.
7. Anything it calls in another area: `actions.name(…)`. Anything another area calls in it: `registerActions`.
8. Anything `uitest.js`/`demo.js` uses of it: `registerCompat`.
9. Check: `npm run typecheck`, then load the page next to the old one (`app/web/index.html` served statically) and
   compare the piece's DOM (`outerHTML`), its boxes (`getBoundingClientRect`) at 1440×900 and 980×620, and a
   screenshot.
