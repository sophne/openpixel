/* Calls between the three areas.
   app.js was one file: the editor called the library's functions and the other way round. Here each area is its own
   set of modules, and no area imports another's files (the one exception: the editor's left panel mounts
   chat/ChatPane). Whatever one area needs from another goes through `actions`: a slot per function, typed here, filled
   by the area that owns it with registerActions() when its module loads, and called as actions.name(...).

   The list is every function or variable that app.js defines in one area and uses in another (worked out from the
   source, see README.md). Until an area registers a slot it does nothing and returns the value below. */
import type { LibraryTarget, Tab } from '../state/ui';

export interface Actions {
  /* ------------------------------------------------------------------ editor */
  /** Once at startup, after the first render: what app.js ran at the end of the file for the editor: initGL(),
   *  buildTools(), initResizers(), the editor's part of wire() (window key and resize handlers, applyLeftSide(),
   *  setFramesOpen(...), the ResizeObserver on #strip), setAxis('z'), setMode('slice'), and requestAnimationFrame(loop). */
  initEditor(): void;
  /** After the first refresh and the first page: sizeThumbs(); stateReady = true; frameCount = 0 (app.js 4353–4354). */
  editorReady(): void;
  /** Reads the open tabs and the active document's state. Resolves once the newest state is on screen (app.js 248). */
  refresh(): Promise<void>;
  setMode(mode: 'slice' | '3d'): void;
  fitSlice(): void;
  sliceSize(axis?: 'x' | 'y' | 'z'): { cols: number; rows: number; depth: number };
  updateSliceLabel(): void;
  /** render3dDirty = true; sliceDirty = true: both canvases draw again on the next frame. */
  redraw(): void;
  resetCamera(): void;
  zoomStep(dir: number, animate?: boolean): void;
  togglePlay(): void;
  stopPlay(): void;
  closePicker(): void;
  showReview(): Promise<void> | void;
  showShortcuts(): void;
  setPixelGrid(on: boolean): void;
  setLeftOpen(open: boolean): void;
  /** Renames a file on disk (by its path, or the one open in tab `tab`), then shows the new name everywhere.
   *  Answers true, or the message to show (app.js 718). */
  renameFile(where: { tab?: Tab['id'] | null; path?: string }, name: string): Promise<unknown>;
  /** A row of #doc-menu (rendered by library/LibraryMenus) was chosen: 'rename' | 'reveal' | 'move' | 'saveAs' | 'close'. */
  docMenuAction(act: string): Promise<void> | void;

  /* ------------------------------------------------------------------ library */
  /** Once at startup, after initEditor(): what wireHome(), wireNewPage() and wireNewFileDialog() did that is not a
   *  handler in JSX (the first githubStars and version requests, …). */
  initLibrary(): void;
  /** Takes the app's `tabs` answer ({tabs, active}) into `ui` and redraws the tab bar (app.js 1671). */
  applyTabs(r: { tabs?: Tab[]; active?: Tab['id'] | null } | null | undefined): void;
  /** Draws the tab bar again; `force` is the old `tabsDrawn = ''` before it (after a rename). */
  renderTabs(force?: boolean): void;
  /** Tells the app where the tab bar's controls are, and whether a dialog covers the bar (app.js 1751). */
  reportTitlebar(): void;
  closeTab(id: Tab['id']): Promise<void>;
  showHome(view?: string): Promise<void>;
  /** Leaves the home screen for the active file, if one is open. */
  hideHome(): void;
  loadHome(): Promise<void>;
  openMoveMenu(anchor: Element | { x: number; y: number }, target: LibraryTarget): void;
  showStars(n: number): void;
  openNewPage(): Promise<void>;
  closeNewPage(): void;
  showAgentHelp(): Promise<void> | void;
  /** The round update button in the tab bar (app.js 3290; it sits in the editor's line range but belongs to #tabbar). */
  showUpdate(version: string | null): void;
  /** clearInterval(agentsState.timer): the Agents page stops asking for status when another page shows. */
  stopAgentsPolling(): void;

  /* ------------------------------------------------------------------ chat */
  /** Once at startup, after initLibrary(): what wireChat() did that is not a handler in JSX. */
  initChat(): void;
  /** chatState.opened: the chat panel has been shown at least once. */
  chatOpened(): boolean;
  /** chatState.busy: an agent is replying. */
  chatBusy(): boolean;
  /** Shows the chat for the file that is open now, when the file changed (app.js 3632). */
  syncChatFile(): Promise<void> | void;
  /** A file was deleted for good: its chats go too (app.js 3613). `key` is the library file's id. */
  chatForget(key: string): void;
  /** A renamed file: the app moved its chats on disk; the page follows (app.js 3621). */
  chatMoved(from: string, to: string): void;
  /** An event of a running reply, from the app (app.js 3979). */
  chatEvent(e: Record<string, any>): void;
  /** The chat panel came into view (applyLeftSide, app.js 671). */
  openChat(): Promise<void> | void;
}

/** Which area fills each slot. */
export const ACTION_OWNERS: Record<keyof Actions, 'editor' | 'library' | 'chat'> = {
  initEditor: 'editor', editorReady: 'editor', refresh: 'editor', setMode: 'editor', fitSlice: 'editor', sliceSize: 'editor',
  updateSliceLabel: 'editor', redraw: 'editor', resetCamera: 'editor', zoomStep: 'editor', togglePlay: 'editor', stopPlay: 'editor',
  closePicker: 'editor', showReview: 'editor', showShortcuts: 'editor', setPixelGrid: 'editor', setLeftOpen: 'editor',
  renameFile: 'editor', docMenuAction: 'editor',
  initLibrary: 'library', applyTabs: 'library', renderTabs: 'library', reportTitlebar: 'library', closeTab: 'library',
  showHome: 'library', hideHome: 'library', loadHome: 'library', openMoveMenu: 'library', showStars: 'library',
  openNewPage: 'library', closeNewPage: 'library', showAgentHelp: 'library', showUpdate: 'library', stopAgentsPolling: 'library',
  initChat: 'chat', chatOpened: 'chat', chatBusy: 'chat', syncChatFile: 'chat', chatForget: 'chat', chatMoved: 'chat',
  chatEvent: 'chat', openChat: 'chat',
};

const registered = new Set<keyof Actions>();
const nothing = (): void => {};
const later = (): Promise<void> => Promise.resolve();

/** The slots. Call them as actions.refresh(), actions.showHome('agents'), … */
export const actions: Actions = {
  initEditor: nothing, editorReady: nothing, refresh: later, setMode: nothing, fitSlice: nothing,
  sliceSize: () => ({ cols: 0, rows: 0, depth: 1 }), updateSliceLabel: nothing, redraw: nothing, resetCamera: nothing,
  zoomStep: nothing, togglePlay: nothing, stopPlay: nothing, closePicker: nothing, showReview: nothing, showShortcuts: nothing,
  setPixelGrid: nothing, setLeftOpen: nothing, renameFile: () => Promise.resolve('Could not rename it'), docMenuAction: nothing,
  initLibrary: nothing, applyTabs: nothing, renderTabs: nothing, reportTitlebar: nothing, closeTab: later, showHome: later,
  hideHome: nothing, loadHome: later, openMoveMenu: nothing, showStars: nothing, openNewPage: later, closeNewPage: nothing,
  showAgentHelp: nothing, showUpdate: nothing, stopAgentsPolling: nothing,
  initChat: nothing, chatOpened: () => false, chatBusy: () => false, syncChatFile: nothing, chatForget: nothing,
  chatMoved: nothing, chatEvent: nothing, openChat: nothing,
};

/** An area fills its slots: registerActions({ refresh, setMode, … }) at the top level of its module. */
export function registerActions(part: Partial<Actions>): void {
  for (const k of Object.keys(part) as (keyof Actions)[]) {
    if (!(k in ACTION_OWNERS)) throw new Error(`actions.${k} is not a slot: add it to app/actions.ts first`);
    registered.add(k);
  }
  Object.assign(actions, part);
}

/** The slots nobody has filled yet (shown once at startup in development; the README lists who owes what). */
export function missingActions(): string[] {
  return (Object.keys(ACTION_OWNERS) as (keyof Actions)[]).filter((k) => !registered.has(k)).map((k) => `${ACTION_OWNERS[k]}: ${k}`);
}
