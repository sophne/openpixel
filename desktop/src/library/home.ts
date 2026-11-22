/* ---------------------------------------------------------------- home screen: Recents, All folders, Archive, Agents
   (app.js 1811–2168, 2186–2294, 2321–2371, 726–730)
   The library (files you opened or saved, the built-in samples, your folders and the archive) is kept by the app.
   Folders and the archive only organise the list: files stay where they are on disk until deleted forever.

   The drawing is library/Home.tsx and library/LibraryMenus.tsx. renderHome() works out what the page shows from
   `home`, `homePrefs` and the search field, exactly when the old renderHome() redrew the page, and hands it over in
   `homeTop` and `homeFiles`; the menus get `cardMenu` and `moveMenu` the same way. */
import type { DragEvent as ReactDragEvent } from 'react';
import { actions } from '../app/actions';
import { showEditor } from '../app/pages';
import { askConfirm, askName, closeMenus, closeModals, hideTip, placeMenu, toast, type DropdownApi } from '../kit';
import { $, $$ } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { timeAgo } from '../lib/format';
import { changed, store } from '../lib/store';
import { home, S, ui, type LibraryFile, type LibraryFolder, type LibraryTarget } from '../state/ui';
import { agentsState, loadAgents } from './agents';
import { rememberTabView } from './tabs';
import { COMPUTER, TRASH } from './wording';

/** A file as the app's `library` action lists it (Recents.listForPage). */
export interface LibFile extends LibraryFile { kind: string; size: number[]; touched?: number; dir?: string }
export type Anchor = Element | { x: number; y: number };
const files = (): LibFile[] => home.files as LibFile[];

export async function showHome(view?: string): Promise<void> {
  actions.stopPlay(); closeModals(); actions.closePicker(); closeMenus();
  if (typeof view === 'string') home.view = view;
  if (ui.view === 'editor') rememberTabView();
  ui.view = 'home'; S.home = true;
  changed(ui); // #home shows, #newpage hides, the tab bar follows
  await loadHome();
}
/** Leaves the home screen for the active file, if one is open. */
export function hideHome(): void { if (ui.active != null) showEditor(); }
export async function loadHome(): Promise<void> {
  const lib = (await nativeAction('library')) || {};
  home.files = lib.files || [];
  home.folders = lib.folders || [];
  if (home.folder && !folderById(home.folder)) home.folder = null;
  renderHome();
}
export const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
export const byRecent = (a: LibFile, b: LibFile): number => (b.touched || 0) - (a.touched || 0) || byName(a, b);
export function folderById(id: string | null | undefined): LibraryFolder | null { return home.folders.find((f) => f.id === id) || null; }
export function fileById(id: string | null | undefined): LibFile | null { return files().find((f) => f.id === id) || null; }
export function childFolders(parent: string | null | undefined): LibraryFolder[] { return home.folders.filter((f) => (f.parent || null) === (parent || null)).sort(byName); }
/** The folder and all folders inside it. */
export function subtree(id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of home.folders) if (!out.has(f.id) && f.parent && out.has(f.parent)) { out.add(f.id); grew = true; } }
  return out;
}
function folderPath(id: string | null): LibraryFolder[] {
  const path: LibraryFolder[] = [];
  for (let f = folderById(id); f && path.length < 64; f = folderById(f.parent)) path.unshift(f);
  return path;
}
export function plural(n: number, one: string, many = one + 's'): string { return `${n} ${n === 1 ? one : many}`; }
export function folderSummary(id: string): string {
  const inside = subtree(id);
  const count = files().filter((f) => !f.archived && f.folder && inside.has(f.folder)).length;
  const subs = childFolders(id).length;
  return [plural(count, 'file'), subs ? plural(subs, 'folder') : ''].filter(Boolean).join(' · ');
}
export function sizeText(f: LibFile): string { return f.kind === '2d' ? `${f.size[0]}×${f.size[1]}` : f.size.join('×'); }

/* Files and folders show as a grid of cards or as a list (Name, Last modified, Size, Location), filtered by kind and
   sorted. Both share one set of behaviours: open (click, Return or Space), the … menu (also right-click, the menu
   key or ⇧F10), drag to a folder or the Archive, and a name for screen readers. View, filter and sort are remembered. */
export const SORTS = [
  { value: 'modified', label: 'Last modified', dir: 'desc' },
  { value: 'name', label: 'Name', dir: 'asc' },
  { value: 'kind', label: 'File type', dir: 'asc' },
  { value: 'size', label: 'Size', dir: 'desc' },
];
export const FILTERS = [{ value: 'all', label: 'All files' }, { value: '2d', label: '2D files' }, { value: '3d', label: '3D files' }];
export interface HomePrefs { layout: string; filter: string; sort: string; dir: string }
export const homePrefs: HomePrefs = store((() => {
  const d = { layout: 'grid', filter: 'all', sort: 'modified', dir: 'desc' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('openpixel.homeView') || '{}') } as HomePrefs; } catch (e) { return d; }
})());
function saveHomePrefs(): void { try { localStorage.setItem('openpixel.homeView', JSON.stringify(homePrefs)); } catch (e) { /* not saved */ } }
/** The choices the page starts with: what the two dropdowns and the layout switch were given in wireHome(). */
export const startPrefs: HomePrefs = { ...homePrefs };
let filterMenu: DropdownApi | null = null, sortMenu: DropdownApi | null = null;
export const menus = {
  get filter(): DropdownApi | null { return filterMenu; },
  get sort(): DropdownApi | null { return sortMenu; },
  /** The <Dropdown ref>s of #home-filter and #home-sort. */
  setFilter(api: DropdownApi | null): void { filterMenu = api; },
  setSort(api: DropdownApi | null): void { sortMenu = api; },
};
/** The grid/list switch as it was last set (wireHome() and setHomeLayout() marked the buttons, nothing else). */
export const layoutSeg = store({ layout: homePrefs.layout });
export function setHomeLayout(layout: string): void {
  homePrefs.layout = layout === 'list' ? 'list' : 'grid'; saveHomePrefs();
  layoutSeg.layout = homePrefs.layout;
  changed(layoutSeg);
  renderHome();
}
export function setHomeSort(key: string, dir?: string): void {
  const s = SORTS.find((x) => x.value === key) || SORTS[0];
  homePrefs.sort = s.value; homePrefs.dir = dir || s.dir; saveHomePrefs();
  if (sortMenu) sortMenu.set(s.value);
  renderHome();
}
export function setHomeFilter(v: string): void { homePrefs.filter = v; saveHomePrefs(); renderHome(); }
function sortFiles(list: LibFile[]): LibFile[] {
  const { sort, dir } = homePrefs, sign = dir === 'asc' ? 1 : -1;
  const px = (f: LibFile) => f.size.reduce((a, b) => a * b, 1);
  const table: Record<string, (a: LibFile, b: LibFile) => number> = {
    modified: (a, b) => (a.touched || 0) - (b.touched || 0),
    name: (a, b) => byName(a, b),
    kind: (a, b) => a.kind.localeCompare(b.kind),
    size: (a, b) => px(a) - px(b),
  };
  const cmp = table[sort] || (() => 0);
  return list.slice().sort((a, b) => sign * cmp(a, b) || byName(a, b));
}
const kindOk = (f: LibFile): boolean => homePrefs.filter === 'all' || f.kind === homePrefs.filter;

/** Where a file lives: its library folder, or the last two folders of its place on disk. `q` is the search text. */
export function locationText(f: LibFile, q: string): string {
  if (f.archived && q) return 'In the Archive'; // search results mix pages
  if (f.sample) return 'Built into OpenPixel';
  if (f.folder && !f.archived) { const fd = folderById(f.folder); if (fd) return `In ${fd.name}`; }
  const parts = (f.dir || '').split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : (f.dir || '');
}
export function whenText(f: LibFile): string { return f.sample ? 'Sample' : f.exists ? timeAgo(f.touched as number) : 'File not found'; }

/** How a name renames in place: what the field starts with and what keeping it does. */
export interface RenameSpec { current: string; commit(name: string): unknown | Promise<unknown> }
/** How a file's name renames in place: only real files that are there (samples keep their names). */
export function fileRename(f: LibFile): RenameSpec | null {
  return f.path && f.exists && !f.sample ? { current: f.name, commit: (v) => actions.renameFile({ path: f.path }, v) } : null;
}
export async function renameFolderTo(f: LibraryFolder, name: string): Promise<unknown> {
  const r = await nativeAction('renameFolder', { id: f.id, name });
  await loadHome();
  return r === true || r === undefined ? true : r;
}
/** The newest files in a folder, its folders included (what its card shows). */
export function latestInFolder(id: string, n = 3): LibFile[] {
  const inside = subtree(id);
  return files().filter((f) => !f.archived && f.folder && inside.has(f.folder))
    .sort((a, b) => (b.touched || 0) - (a.touched || 0)).slice(0, n);
}
export function openFolder(id: string | null | undefined): void {
  home.view = 'folders'; home.folder = id || null;
  const search = $<HTMLInputElement>('#home-search');
  if (search.value) { search.value = ''; }
  renderHome();
  $('.home-main').scrollTop = 0;
}
/** A page of the sidebar was picked. */
export function openHomePage(view: string): void {
  home.view = view;
  if (home.view === 'folders') home.folder = null;
  $<HTMLInputElement>('#home-search').value = '';
  renderHome();
  $('.home-main').scrollTop = 0;
}

/** One piece of #home-title: the page's heading, or a breadcrumb that leads to a folder (and takes drops). */
export interface TitlePart { text: string; crumb: boolean; id: string | null }
function titleParts(q: string): TitlePart[] {
  const h = (text: string): TitlePart => ({ text, crumb: false, id: null });
  if (q) return [h(`Results for “${q}”`)];
  if (home.view !== 'folders') return [h(({ recents: 'Recents', archive: 'Archive', agents: 'Agents' } as Record<string, string>)[home.view] || 'Recents')];
  const path = folderPath(home.folder);
  const crumb = (text: string, id: string | null, last: boolean): TitlePart => (last ? h(text) : { text, crumb: true, id });
  return [crumb('All folders', null, !path.length), ...path.map((f, i) => crumb(f.name, f.id, i === path.length - 1))];
}

/** The sidebar, the title and the header buttons, as renderHome() last drew them. Starts as the page's own markup. */
export const homeTop = store({
  /** The search text, trimmed. */
  q: '',
  /** The sidebar page that looks chosen, and the one that is the current page (aria-current). */
  navOn: 'recents' as string | null,
  navCurrent: 'recents' as string | null,
  title: [] as TitlePart[],
  agentsView: false,
  // Header buttons only where they belong: making and opening files on Recents, folders on All folders,
  // emptying the Archive on the Archive; none on Agents or search results.
  showOpen: true, showCreate: true, showNewFolder: true, showEmptyArchive: true,
});
/** The files part of the page (everything in #home-files-wrap), as renderHome() last drew it. */
export const homeFiles = store({
  q: '',
  count: '',
  /** All folders lists folders only: no 2D/3D filter there. */
  onlyFolders: false,
  // Screen readers hear each dropdown's question and its current answer ("Sort by: Last modified").
  filterLabel: 'Show', sortLabel: 'Sort by',
  list: false,
  folders: [] as LibraryFolder[],
  files: [] as LibFile[],
  showFolders: true,
  filesTitle: 'Files', filesTitleHidden: false,
  /** "Folders" is a heading only when files follow. */
  foldersHeadHidden: false,
  /* Empty states: a small animated pixel-art scene (drawn with OpenPixel by app/tools/make-empty-states.py, in the
     accent orange and grays) over the message. The picture is decoration; the text says what is going on. */
  empty: null as { art: string; text: string } | null,
  sort: homePrefs.sort, dir: homePrefs.dir,
});

export function renderHome(): void {
  const editing = $('#home .home-main input.rename');
  if (editing && document.activeElement === editing) return; // a name is being edited; it redraws when that is done
  const q = $<HTMLInputElement>('#home-search').value.trim();
  const ql = q.toLowerCase();
  const archived = files().filter((f) => f.archived);
  const agentsView = home.view === 'agents' && !q;
  Object.assign(homeTop, {
    q,
    navOn: !q && !(home.view === 'folders' && home.folder) ? home.view : null,
    navCurrent: !q ? home.view : null,
    title: titleParts(q),
    agentsView,
    showOpen: home.view === 'recents' && !q,
    showCreate: home.view === 'recents' && !q,
    showNewFolder: home.view === 'folders' && !q,
    showEmptyArchive: !!(home.view === 'archive' && !q && archived.length),
  });
  clearInterval(agentsState.timer);
  if (agentsView) {
    changed(homeTop); // the files part stays as it was, hidden
    loadAgents();
    agentsState.timer = setInterval(() => { if (S.home && home.view === 'agents') loadAgents(); else clearInterval(agentsState.timer); }, 2500);
    return;
  }
  let folders: LibraryFolder[] = [], list: LibFile[] = [], filesTitle = '', empty = '', art = 'files';
  const match = (s: unknown) => String(s || '').toLowerCase().includes(ql);
  if (q) {
    // The sidebar search looks through the whole library, whichever page it starts from: every file (archived
    // ones too, marked as such) and every folder.
    list = files().filter((f) => match(f.name) || match(f.path));
    folders = home.folders.filter((f) => match(f.name));
    empty = `Nothing matches “${q}”.`; art = 'search';
  } else if (home.view === 'folders') {
    // All folders lists folders only (files outside a folder are on Recents); a folder shows its folders and files.
    folders = childFolders(home.folder);
    list = home.folder ? files().filter((f) => !f.archived && f.folder === home.folder) : [];
    filesTitle = 'Files';
    empty = home.folder ? 'This folder is empty. Drag files here, or choose Move to… on a file.'
      : 'No folders yet. Create one with New folder, then drag files into it or choose Move to… on a file.';
    art = 'folder';
  } else if (home.view === 'archive') {
    list = archived;
    empty = 'Nothing archived. Choose Move to Archive on a file, or drag it onto Archive in the sidebar.'; art = 'archive';
  } else {
    list = files().filter((f) => !f.archived);
    empty = 'Files you save or open show up here, with a preview and where they are saved.';
  }
  const all = list.length;
  list = sortFiles(list.filter(kindOk));
  folders = folders.slice().sort((a, b) => (homePrefs.sort === 'name' && homePrefs.dir === 'desc' ? -1 : 1) * byName(a, b));
  if (all && !list.length) { empty = `No ${homePrefs.filter.toUpperCase()} files here. Choose All files to see the other ${plural(all, 'file')}.`; art = 'search'; }
  const onlyFolders = home.view === 'folders' && !home.folder && !q;
  const asList = homePrefs.layout === 'list';
  const showFolders = !asList && folders.length > 0;
  Object.assign(homeFiles, {
    q,
    count: onlyFolders ? plural(folders.length, 'folder')
      : [folders.length ? plural(folders.length, 'folder') : '', plural(list.length, 'file')].filter(Boolean).join(' · '),
    onlyFolders, // 2D or 3D is about files
    filterLabel: `Show: ${(FILTERS.find((x) => x.value === homePrefs.filter) || FILTERS[0]).label}`,
    sortLabel: `Sort by: ${(SORTS.find((x) => x.value === homePrefs.sort) || SORTS[0]).label}, ${homePrefs.dir === 'asc' ? 'ascending' : 'descending'}`,
    list: asList,
    folders, files: list,
    showFolders,
    // Section headings only where a page has two kinds of things (folders and files).
    filesTitle, filesTitleHidden: asList || !filesTitle || !showFolders || !list.length,
    foldersHeadHidden: !list.length, // a heading only when files follow
    empty: !list.length && !folders.length ? { art, text: empty } : null,
    sort: homePrefs.sort, dir: homePrefs.dir,
  });
  changed(homeTop, homeFiles);
}

export async function openItem(f: LibFile, cardEl?: Element | null): Promise<void> {
  if (f.sample) { await nativeAction(f.id); return; }
  if (!f.exists) { openCardMenu((cardEl && cardEl.querySelector('.more')) || $('#home-search'), { type: 'file', item: f }); return; }
  const res = await nativeAction('openPath', { path: f.path });
  if (res !== true) toast(String(res || 'Could not open the file'));
}

/* Menus for a file or folder: from its … button or a right-click. "Move to…" lists the folders. */
export type CardAction = 'open' | 'reveal' | 'rename' | 'move' | 'archive' | 'restore' | 'remove' | 'delete' | 'deleteFolder';
/** Which rows #card-menu shows; null until it first opens (the page's own markup). */
export const cardMenu = store({ show: null as Record<CardAction, boolean> | null });
export function openCardMenu(anchor: Anchor, target: LibraryTarget): void {
  closeMenus();
  const m = $('#card-menu');
  home.menuFor = target;
  const file = target.type === 'file' ? target.item : null;
  cardMenu.show = {
    open: !file || !!file.exists || !!file.sample,
    reveal: !!file && !!file.exists && !file.sample,
    rename: !file || (!!file.path && !!file.exists && !file.sample),
    move: !file || !file.archived,
    archive: !!file && !file.archived,
    restore: !!file && !!file.archived,
    remove: !!file && !file.exists && !file.sample,
    delete: !!file && (!!file.archived || !!file.exists || !!file.sample),
    deleteFolder: !file,
  };
  changed(cardMenu);
  home.menuAnchor = anchor;
  placeMenu(m, anchor);
}
/** The names that rename in place right now: the card or row, and what starts its field (the old `el._rename`). */
export const renamers = new WeakMap<Element, () => void>();
/** A row of #card-menu was chosen. */
export async function cardMenuAction(act: CardAction): Promise<void> {
  const t = home.menuFor;
  if (!t) return;
  if (act === 'move') {
    const a = home.menuAnchor;
    openMoveMenu(a && (!(a instanceof Element) || a.isConnected !== false) ? a : { x: 200, y: 200 }, t);
    return;
  }
  closeMenus();
  if (act === 'rename') {
    const sel = t.type === 'folder' ? `[data-folder="${CSS.escape(t.item.id)}"]` : `[data-id="${CSS.escape(t.item.id)}"]`;
    const el = $$(`#home ${sel}`).find((x) => renamers.has(x) && x.offsetParent);
    if (el) { (renamers.get(el) as () => void)(); return; }
    if (t.type === 'folder') renameFolder(t.item);
    return;
  }
  if (t.type === 'folder') {
    if (act === 'open') openFolder(t.item.id);
    else if (act === 'deleteFolder') deleteFolder(t.item);
    return;
  }
  const it = t.item as LibFile;
  if (act === 'open') openItem(it);
  else if (act === 'reveal') nativeAction('reveal', { path: it.path });
  else if (act === 'archive') archiveItem(it, true);
  else if (act === 'restore') archiveItem(it, false);
  else if (act === 'delete') deleteForever([it]);
  else if (act === 'remove') { await nativeAction('removeRecent', { path: it.path }); loadHome(); }
}

/** A row of "Move to…": a folder (or none) to move into. */
export interface MoveRow { label: string; id: string | null; depth: number; icon: string }
/** What #move-menu lists; `seq` counts its openings (0: empty, as the page starts), each one a fresh list. */
export const moveMenu = store({ seq: 0, target: null as LibraryTarget | null, here: null as string | null, rows: [] as MoveRow[] });
export function openMoveMenu(anchor: Anchor, target: LibraryTarget): void {
  closeMenus();
  const m = $('#move-menu');
  const item = target.item;
  const here: string | null = target.type === 'folder' ? (target.item.parent || null) : (target.item.folder || null);
  const banned = target.type === 'folder' ? subtree(item.id) : new Set<string>();
  const rows: MoveRow[] = [{ label: 'All folders (no folder)', id: null, depth: 0, icon: 'folders' }];
  const add = (parent: string | null, depth: number) => {
    for (const f of childFolders(parent)) { if (banned.has(f.id)) continue; rows.push({ label: f.name, id: f.id, depth, icon: 'folder' }); add(f.id, depth + 1); }
  };
  add(null, 1);
  Object.assign(moveMenu, { seq: moveMenu.seq + 1, target, here, rows });
  changed(moveMenu);
  placeMenu(m, anchor);
}
/** A folder of "Move to…" was chosen. */
export function moveMenuPick(id: string | null): void {
  const { target, here } = moveMenu;
  closeMenus();
  if (target && id !== here) moveTo(target, id);
}
/** "New folder…" at the end of "Move to…": makes the folder, then moves the item into it. */
export async function moveMenuNewFolder(): Promise<void> {
  const { target } = moveMenu;
  closeMenus();
  const name = await askName('New folder', 'Create', '');
  if (name == null || !target) return;
  const id = await nativeAction('createFolder', { name, parent: home.view === 'folders' ? home.folder : null });
  if (typeof id === 'string') { await loadHome(); moveTo(target, id); }
}
export async function moveTo(target: LibraryTarget, folderId: string | null): Promise<void> {
  const ok = target.type === 'folder'
    ? await nativeAction('moveFolder', { id: target.item.id, parent: folderId })
    : await nativeAction('moveItem', { id: target.item.id, folder: folderId });
  if (ok !== true) { toast('Could not move it there'); return; }
  const dest = folderId ? (folderById(folderId) || ({} as Partial<LibraryFolder>)).name : 'All folders';
  toast(`Moved “${target.item.name}” to ${dest}`);
  await loadHome();
}
async function archiveItem(f: LibFile, archived: boolean): Promise<void> {
  const ok = await nativeAction('archiveItem', { id: f.id, archived });
  if (ok === true) toast(archived ? `“${f.name}” moved to the Archive` : `“${f.name}” restored`);
  await loadHome();
}
export async function deleteForever(list: LibFile[]): Promise<void> {
  if (!list.length) return;
  const one = list.length === 1 ? list[0] : null;
  const title = one ? `Delete “${one.name}” permanently?` : `Delete ${plural(list.length, 'archived item')} permanently?`;
  const body = one
    ? (one.sample ? 'The sample disappears from OpenPixel.' : `The file moves to ${TRASH}:\n${one.path}`)
    : `Files move to ${TRASH}; samples disappear from OpenPixel.`;
  if (!(await askConfirm(title, body, 'Delete permanently'))) return;
  let failed = '';
  for (const f of list) {
    const r = await nativeAction('deleteItem', { id: f.id });
    if (r !== true) failed = String(r || `Could not delete “${f.name}”`);
    else if (!f.sample) actions.chatForget(f.id);
  }
  toast(failed || (one ? `“${one.name}” deleted permanently` : 'Archive emptied'));
  await loadHome();
}
/** The Archive's "Delete all permanently". */
export function emptyArchive(): void { deleteForever(files().filter((f) => f.archived)); }
export async function newFolder(parent: string | null): Promise<void> {
  const name = await askName('New folder', 'Create', '');
  if (name == null) return;
  const id = await nativeAction('createFolder', { name, parent: parent || null });
  if (typeof id !== 'string') { toast('Could not create the folder'); return; }
  await loadHome();
}
async function renameFolder(f: LibraryFolder): Promise<void> {
  const name = await askName('Rename folder', 'Rename', f.name);
  if (name == null || name === f.name) return;
  await nativeAction('renameFolder', { id: f.id, name });
  await loadHome();
}
async function deleteFolder(f: LibraryFolder): Promise<void> {
  const n = files().filter((x) => !x.archived && x.folder && subtree(f.id).has(x.folder)).length;
  const subs = subtree(f.id).size - 1;
  const body = (n ? `${plural(n, 'file')} inside ${n === 1 ? 'moves' : 'move'} to the Archive. ` : '') +
    (subs ? `${plural(subs, 'folder')} inside ${subs === 1 ? 'is' : 'are'} deleted too. ` : '') + `Files on ${COMPUTER} are not touched.`;
  if (!(await askConfirm(`Delete the folder “${f.name}”?`, body, 'Delete folder'))) return;
  await nativeAction('deleteFolder', { id: f.id });
  if (home.view === 'folders' && home.folder && subtree(f.id).has(home.folder)) home.folder = f.parent || null;
  await loadHome();
}

/* Drag and drop: files and folders onto a folder (a card, the sidebar, a breadcrumb), All folders (top level)
   or Archive. */
export interface DragItem { type: 'file' | 'folder'; id: string; name: string }
let dragging: DragItem | null = null;
export function draggingNow(): DragItem | null { return dragging; }
/** onDragStart of a card or row. */
export function startDrag(e: ReactDragEvent<HTMLElement>, item: DragItem): void {
  dragging = item;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', item.name);
  e.currentTarget.classList.add('dragging');
  document.body.classList.add('dnd');
  hideTip(); closeMenus();
}
export function endDrag(): void {
  dragging = null;
  $$('.dragging').forEach((x) => x.classList.remove('dragging'));
  $$('.drop-over').forEach((x) => x.classList.remove('drop-over'));
  document.body.classList.remove('dnd');
}
function dropTarget(el: EventTarget | null): HTMLElement | null {
  return el instanceof Element ? el.closest<HTMLElement>('[data-drop], [data-drop-archive]') : null;
}
function canDrop(t: HTMLElement | null, item: DragItem | null = dragging): t is HTMLElement {
  if (!item || !t) return false;
  if (t.hasAttribute('data-drop-archive')) { const f = item.type === 'file' && fileById(item.id); return !!f && !f.archived; }
  const dest = t.dataset.drop || null;
  if (item.type === 'file') { const f = fileById(item.id); return !!f && (!!f.archived || (f.folder || null) !== dest); }
  const fd = folderById(item.id);
  return !!fd && !(dest && subtree(fd.id).has(dest)) && (fd.parent || null) !== dest;
}
async function dropOn(t: HTMLElement, item: DragItem): Promise<void> {
  if (t.hasAttribute('data-drop-archive')) { const f = fileById(item.id); if (f) await archiveItem(f, true); return; }
  const target = (item.type === 'file' ? { type: 'file', item: fileById(item.id) } : { type: 'folder', item: folderById(item.id) }) as LibraryTarget;
  await moveTo(target, t.dataset.drop || null);
}
/** The document's dragover and drop (Home listens for them). */
export function documentDragOver(e: DragEvent): void {
  if (!dragging) return;
  const t = dropTarget(e.target);
  $$('.drop-over').forEach((x) => { if (x !== t) x.classList.remove('drop-over'); });
  if (!canDrop(t)) { if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; return; }
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  t.classList.add('drop-over');
}
export function documentDrop(e: DragEvent): void {
  if (!dragging) return;
  const t = dropTarget(e.target), item = dragging;
  e.preventDefault();
  endDrag();
  if (canDrop(t, item)) dropOn(t, item);
}
