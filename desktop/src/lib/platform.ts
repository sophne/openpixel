/* What differs between macOS, Windows and Linux in the page's wording.
   Shortcuts are written once, the Mac's way ("Undo (⌘Z)", ['⇧', '⌘', 'S']); these helpers turn them into what the
   person's keyboard says when they are shown. ⌘ becomes Ctrl, which is what the menu bar binds there (`CmdOrCtrl`
   in electron/menu.ts). On macOS everything comes back unchanged. */
import { platform } from './host';

export { platform };
export const isMac = platform === 'darwin';

const MODS = '⌘⇧⌥⌃';
// Windows and Linux name the keys, in the order their menus use: Ctrl, Alt, Shift.
const NAMES: Record<string, string> = { '⌘': 'Ctrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '⌫': 'Backspace', '↩': 'Enter' };
const ORDER = ['Ctrl', 'Alt', 'Shift'];

/** One key cap: '⌘' → 'Ctrl', '⌫' → 'Backspace' off the Mac; anything else as it is. */
export function keyLabel(key: string): string {
  return isMac ? key : NAMES[key] || key;
}

/** The caps of one shortcut written the Mac's way: '⇧⌘S' → ['⇧', '⌘', 'S'] on the Mac, ['Ctrl', 'Shift', 'S'] elsewhere. */
export function shortcutKeys(shortcut: string): string[] {
  let n = 0;
  while (n < shortcut.length - 1 && MODS.includes(shortcut[n])) n++;
  const mods = [...shortcut.slice(0, n)], key = shortcut.slice(n);
  if (isMac) return [...mods, key];
  const named = [...new Set(mods.map((m) => NAMES[m]))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return [...named, keyLabel(key)];
}

/** A shortcut as text for a menu row (`<span class="k">`): '⇧⌘S' on the Mac, 'Ctrl+Shift+S' elsewhere. */
export function shortcutLabel(shortcut: string): string {
  return isMac ? shortcut : shortcutKeys(shortcut).join('+');
}

/** A row of caps from the shortcuts dialog, which may hold several shortcuts (['⌘', '1', '⌘', '2']): each cap named
 *  for this platform, and each shortcut's modifiers in this platform's order, as tooltips and menu rows show them
 *  (['⇧', '⌘', 'N'] is ['Ctrl', 'Shift', 'N'] on Windows and Linux). */
export function keyCaps(keys: string[]): string[] {
  if (isMac) return keys;
  const out: string[] = [];
  let mods: string[] = [];
  for (const k of keys) {
    if (k.length === 1 && MODS.includes(k)) { mods.push(k); continue; }
    out.push(...shortcutKeys(mods.join('') + k));
    mods = [];
  }
  return [...out, ...mods.map(keyLabel)];
}

/** True when the menu-bar modifier is down (⌘ on the Mac, Ctrl elsewhere): those shortcuts belong to the app's
 *  menu, which sends them as PC.command(cmd); the page's own key handling ignores them. */
export function menuModifier(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/** "has no skills on this Mac", "It listens on this Mac only". */
export const THIS_COMPUTER = isMac ? 'this Mac' : 'this computer';

/** "Show in Finder", by platform (the doc and card menus). */
export const REVEAL_LABEL = isMac ? 'Show in Finder' : platform === 'win32' ? 'Show in Explorer' : 'Show in file manager';

/** A path with the home folder shortened to ~ (tab tooltips). */
export function tildePath(path: string): string {
  if (isMac) return path.replace(/^\/Users\/[^/]+/, '~');
  return platform === 'win32' ? path.replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~') : path.replace(/^\/home\/[^/]+/, '~');
}
