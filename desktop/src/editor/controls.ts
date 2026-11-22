/* Play, the review dialog and the shortcuts dialog. */
import { errorText } from '../lib/dom';
import { call } from '../lib/host';
import { changed, store } from '../lib/store';
import { openModal, toast } from '../kit';
import { S } from '../state/ui';
import { playView, tool, TOOL_LIST } from './core';

let playTimer: ReturnType<typeof setTimeout> | undefined;
export function togglePlay(): void {
  if (S.playing) { stopPlay(); return; }
  if (S.frames.length < 2) { toast('Add a frame to animate'); return; }
  S.playing = true; playView.playing = true; changed(playView);
  const tick = async () => {
    if (!S.playing) return;
    const next = (S.frame + 1) % S.frames.length;
    await tool('set_active', { frame: next });
    playTimer = setTimeout(tick, (S.frames[next] && S.frames[next].duration_ms) || 100);
  };
  playTimer = setTimeout(tick, (S.frames[S.frame] && S.frames[S.frame].duration_ms) || 100);
}
export function stopPlay(): void {
  S.playing = false; clearTimeout(playTimer);
  playView.playing = false; changed(playView);
}

/** Drawn by showReview(): the review dialog's picture, its line of numbers and its list. */
export const reviewView = store<{ src: string | undefined; stats: string; items: string[] }>({ src: undefined, stats: '', items: [] });
export async function showReview(): Promise<void> {
  try {
    const r = await call('review_model', { frame: S.frame });
    // The ReviewDialog component sizes the picture when it has loaded (the old img.onload).
    reviewView.src = r.images[0];
    const b = r.bounds ? r.bounds.size.join('×') : '—';
    reviewView.stats = `${r.voxels} ${S.isSprite ? 'pixels' : 'voxels'} · bounds ${b} · ${r.parts || 0} part(s) · ${(r.colors || []).length} colours · left/right symmetry ${Math.round((r.symmetry_x || 0) * 100)}%${r.score ? ` · score ${r.score.total}/100` : ''}`;
    const items: string[] = [];
    (r.issues && r.issues.length ? r.issues : ['No problems found.']).forEach((t: string) => { items.push(t); });
    (r.tips || []).forEach((t: string) => { items.push('Tip: ' + t); });
    reviewView.items = items;
    changed(reviewView);
    openModal('#review-dialog');
  } catch (e) { toast(errorText(e)); }
}

/* ---------------------------------------------------------------- keyboard shortcuts (Help ▸ Keyboard Shortcuts, ⌘/ or ?) */
export type ShortcutRow = [string, string[]];
export const SHORTCUTS: [string, ShortcutRow[]][] = [
  ['Tools', TOOL_LIST.filter((t) => t.key).map((t): ShortcutRow => [t.name, [t.key]]).concat([['Eyedropper while drawing', ['⌥', 'click']], ['Pan the canvas', ['Space', 'drag']]])],
  ['Drawing', [['Smaller / larger brush', ['[', ']']], ['Mirror left/right', ['⇧', 'X']], ['Mirror up/down', ['⇧', 'Y']], ['Mirror front/back', ['⇧', 'Z']],
    ['Move the layer (Move tool)', ['←', '→', '↑', '↓']], ['Undo', ['⌘', 'Z']], ['Redo', ['⇧', '⌘', 'Z']]]],
  ['Layers', [['New layer', ['⇧', '⌘', 'N']], ['Duplicate layer', ['⌘', 'D']], ['Merge down', ['⌘', 'E']], ['Delete layer', ['⌘', '⌫']],
    ['Layer above / below', ['⌥', '↑', '⌥', '↓']]]],
  ['Frames', [['New frame', ['⌥', '⌘', 'N']], ['Delete frame', ['⌥', '⌘', '⌫']], ['Previous / next frame', [',', '.']], ['Play / stop', ['↩']],
    ['Onion skin', ['O']], ['Show / hide the frames', ['F']]]],
  ['View', [['2D canvas / 3D view', ['⌘', '1', '⌘', '2']], ['Switch 2D and 3D', ['Tab']], ['Zoom in / out', ['⌘', '+', '⌘', '−']], ['Fit / reset view', ['⌘', '0']],
    ['Pixel grid', ['⌘', "'"]], ['Previous / next slice', ['PgDn', 'PgUp']], ['Review the model', ['⌘', 'R']]]],
  ['File', [['New', ['⌘', 'N']], ['Open', ['⌘', 'O']], ['Save', ['⌘', 'S']], ['Save as', ['⇧', '⌘', 'S']], ['Export PNG', ['⇧', '⌘', 'E']],
    ['Keyboard shortcuts', ['⌘', '/']]]],
];
/** Drawn by showShortcuts(): the list is written each time the dialog opens (n counts them; 0: never yet). */
export const shortcutsView = store({ n: 0 });
export function showShortcuts(): void {
  // Two columns with their headings on one line: drawing on the left, document and view on the right.
  shortcutsView.n++;
  changed(shortcutsView);
  openModal('#shortcuts-dialog');
}
