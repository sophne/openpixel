/* ---------------------------------------------------------------- the New file page (the + in the tab bar) and the
   New 2D / 3D file dialog. The drawing is library/NewPage.tsx. */
import { actions } from '../app/actions';
import { showEditor } from '../app/pages';
import { closeMenus, closeModals, openModal, toast, type DropdownApi } from '../kit';
import { $ } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { changed, store } from '../lib/store';
import { PRESETS } from '../state/palettes';
import { home, S, ui } from '../state/ui';
import { agentsState } from './agentsPage';
import { byRecent, plural, showHome, type LibFile } from './homePage';
import { rememberTabView, renderTabs } from './tabs';

const field = (id: string): HTMLInputElement => $<HTMLInputElement>(id);

/* The page shows the 10 files edited (opened or saved) most recently; a search looks through every file. */
const NEW_RECENTS = 10;
export async function openNewPage(): Promise<void> {
  actions.stopPlay(); closeModals(); actions.closePicker(); closeMenus();
  if (ui.view === 'editor') rememberTabView();
  ui.newOpen = true; ui.view = 'new'; S.home = true;
  clearInterval(agentsState.timer);
  changed(ui); // #newpage shows, #home hides, the tab bar gets its New file tab
  field('#np-search').value = '';
  renderNewRecents();
  field('#np-search').focus();
  const lib = (await nativeAction('library')) || {};
  home.files = lib.files || home.files; home.folders = lib.folders || home.folders;
  renderNewRecents();
}
export function closeNewPage(): void {
  ui.newOpen = false;
  if (ui.view === 'new') { if (ui.active != null) showEditor(); else showHome(); } else renderTabs();
}
/** Browse all recent: on to Recents on the home screen. */
export function browseRecents(): void { ui.newOpen = false; showHome('recents'); }

/** The page's list as renderNewRecents() last drew it. Starts as the page's own markup. */
export const newRecents = store({
  title: 'Recents',
  // Browse all recent only when Recents holds more than this page lists (otherwise everything is already here).
  browseHidden: false,
  files: [] as LibFile[],
  empty: null as { art: string; text: string } | null,
});
export function renderNewRecents(): void {
  const typed = field('#np-search').value.trim();
  const q = typed.toLowerCase();
  const all = (home.files as LibFile[]).filter((f) => f.exists || f.sample).sort(byRecent);
  const files = q
    ? all.filter((f) => f.name.toLowerCase().includes(q) || (f.path || '').toLowerCase().includes(q))
    : all.filter((f) => !f.archived).slice(0, NEW_RECENTS);
  Object.assign(newRecents, {
    title: q ? (files.length ? `${plural(files.length, 'file')} found` : 'No results') : 'Recents',
    browseHidden: !!q || all.filter((f) => !f.archived).length <= NEW_RECENTS,
    files,
    empty: files.length ? null
      : q ? { art: 'search', text: `No file matches “${typed}”.` } : { art: 'files', text: 'Files you open or save show up here.' },
  });
  changed(newRecents);
}

/* New 2D / 3D file dialog: name, size (and depth for 3D), size presets and the palette, or no palette. The last
   size and palette for each kind are remembered. */
export const NEW_PALETTES = [{ value: 'none', label: 'No palette', colors: [] as string[] }, ...PRESETS];
type Kind = '2d' | '3d';
interface NewFilePref { w: number; h: number; d?: number; palette: string }
const newFilePrefs: Record<Kind, NewFilePref> = (() => {
  const d = { '2d': { w: 32, h: 32, palette: 'db32' }, '3d': { w: 32, h: 32, d: 32, palette: 'db32' } };
  try { const s = JSON.parse(localStorage.getItem('openpixel.newFile') || '{}'); return { '2d': { ...d['2d'], ...s['2d'] }, '3d': { ...d['3d'], ...s['3d'] } }; } catch (e) { return d; }
})();
let nfPalette: DropdownApi | null = null, nfKind: Kind = '2d';
/** The <Dropdown ref> of #nf-palette. */
export function setNfPalette(api: DropdownApi | null): void { nfPalette = api; }
/** What the dialog shows besides its fields: `opened` is false until it first opens (the page's own markup). */
export const newFile = store({
  opened: false,
  kind: '2d' as Kind,
  hint: '',
  /** The size preset every size field shows, if any ('16'). */
  preset: null as string | null,
});
export function nfHint(): void {
  const v = nfPalette ? nfPalette.value : 'db32';
  newFile.hint = v === 'none'
    ? 'Starts with one colour (black). Every colour you pick is added to the file\'s own palette.'
    : `${(PRESETS.find((p) => p.value === v) || ({} as { label?: string })).label || 'This palette'}; you can add, change or replace colours later.`;
  const x = field('#nf-x').value, y = field('#nf-y').value, z = field('#nf-z').value;
  newFile.preset = x === y && (nfKind === '2d' || z === x) ? x : null;
  newFile.opened = true;
  changed(newFile);
}
/** A size preset was clicked. */
export function pickPreset(n: string): void {
  ['#nf-x', '#nf-y', '#nf-z'].forEach((x) => { field(x).value = n; });
  nfHint();
}
export function openNewFileDialog(kind: string): void {
  nfKind = kind === '3d' ? '3d' : '2d';
  const p = newFilePrefs[nfKind];
  newFile.kind = nfKind;
  field('#nf-name').value = 'Untitled';
  field('#nf-x').value = String(p.w); field('#nf-y').value = String(p.h); field('#nf-z').value = String(p.d || 32);
  if (nfPalette) nfPalette.set(p.palette);
  nfHint();
  openModal('#newfile-dialog');
  setTimeout(() => { field('#nf-name').focus(); field('#nf-name').select(); }, 30);
}
export async function createFromDialog(): Promise<void> {
  const clamp = (v: string) => Math.max(1, Math.min(256, parseInt(v, 10) || 32));
  const w = clamp(field('#nf-x').value), h = clamp(field('#nf-y').value), dz = clamp(field('#nf-z').value);
  const palette = nfPalette && nfPalette.value ? nfPalette.value : 'db32';
  const name = field('#nf-name').value.trim() || 'Untitled';
  newFilePrefs[nfKind] = nfKind === '3d' ? { w, h, d: dz, palette } : { w, h, palette };
  try { localStorage.setItem('openpixel.newFile', JSON.stringify(newFilePrefs)); } catch (e) { /* not saved */ }
  const req = nfKind === '3d'
    ? { tool: 'new_model', args: { name, palette, size_x: w, size_y: h, size_z: dz } }
    : { tool: 'new_sprite', args: { name, palette, width: w, height: h } };
  const ok = $<HTMLButtonElement>('#nf-ok');
  ok.disabled = true;
  const r = await nativeAction('newDocument', req);
  ok.disabled = false;
  if (!r || typeof r === 'string') { toast(String(r || 'Could not create the file')); return; }
  closeModals();
  ui.newOpen = false;
  await actions.refresh();
  showEditor();
}
