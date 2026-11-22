/* Menus, and the [data-menu] buttons that open them.
   A menu is open while its element has the class `open`: `.menu` (a button with its .menu-list inside: the main
   menu, Export, every dropdown) or `.card-menu` (a list on its own, placed at a point: the doc, card, move and chat
   menus). The arrow keys move through the items of the open menu, Return chooses, Escape closes and returns focus.

   The classes `open` (menus), `kb` (the row the keyboard is on) and `sel` (a dropdown's chosen row) are put on and
   taken off here, by hand, the moment something happens, exactly as before. So an element that carries one of them
   keeps a constant className in JSX: React would write the attribute again and drop the class. */
import type { SyntheticEvent } from 'react';
import { $, $$ } from '../lib/dom';
import { lastInput, originFrom, popIn } from '../lib/motion';

/** Puts a position: fixed element at window point (x, y). "Fixed" refers to the window unless an ancestor makes
 *  itself the reference box (a glass dialog's backdrop-filter, a transform…), so the real start is measured: the
 *  element goes to 0,0 first, and where that lands is the offset. Running animations around it (a dialog still
 *  zooming open) are finished first, so the measurement isn't taken from a scaled box. */
export function placeFixed(el: HTMLElement, x: number, y: number): void {
  for (let p = el.parentElement; p; p = p.parentElement) p.getAnimations().forEach((a) => a.finish());
  el.style.left = '0px'; el.style.top = '0px';
  const z = el.getBoundingClientRect();
  el.style.left = `${Math.round(x - z.left)}px`;
  el.style.top = `${Math.round(y - z.top)}px`;
}

let menuTrigger: HTMLElement | null = null;
/** A menu list just became visible: animate it out of its trigger and, for keyboard users, start on the first row. */
export function openedMenu(list: HTMLElement, trigger: HTMLElement): void {
  menuTrigger = trigger;
  popIn(list, originFrom(trigger, list), { duration: 140, scale: 0.97 });
  list.querySelectorAll('.kb').forEach((d) => d.classList.toggle('kb', false));
  if (lastInput === 'key') moveMenu(list, 1);
}
export function openMenuList(): HTMLElement | null { return $('.menu.open > .menu-list') || $('.card-menu.open'); }
export function menuItems(list: HTMLElement): HTMLElement[] {
  return ([...list.children] as HTMLElement[]).filter((d) => d.tagName === 'DIV' && !d.hidden && d.offsetParent !== null);
}
export function moveMenu(list: HTMLElement, step: number, to?: 'first' | 'last' | null): void {
  const items = menuItems(list);
  if (!items.length) return;
  const cur = items.findIndex((d) => d.classList.contains('kb'));
  const next = to === 'first' ? 0 : to === 'last' ? items.length - 1 : (cur + step + items.length) % items.length;
  items.forEach((d, i) => d.classList.toggle('kb', i === next));
  items[next].scrollIntoView({ block: 'nearest' });
}
export function closeMenus(): void { $$('.menu, .card-menu').forEach((m) => m.classList.remove('open')); }

/** Opens a .card-menu at an element (under it, or above when there is no room) or at a point (a right-click). */
export function placeMenu(m: HTMLElement, anchor: Element | { x: number; y: number }): void {
  m.classList.add('open');
  const a = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  m.style.left = Math.max(8, Math.min(a.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  const below = a.bottom + 4;
  m.style.top = (below + m.offsetHeight > window.innerHeight - 8 ? Math.max(8, a.top - m.offsetHeight - 4) : below) + 'px';
  if (anchor instanceof Element) { openedMenu(m, anchor as HTMLElement); return; }
  // A right-click menu grows out of the pointer, wherever the menu had to shift or flip to fit.
  menuTrigger = null;
  const r = m.getBoundingClientRect();
  const ox = Math.max(0, Math.min(r.width, anchor.x - r.left)), oy = Math.max(0, Math.min(r.height, anchor.y - r.top));
  popIn(m, `${Math.round(ox)}px ${Math.round(oy)}px`, { duration: 140, scale: 0.97 });
  m.querySelectorAll('.kb').forEach((d) => d.classList.toggle('kb', false));
  if (lastInput === 'key') moveMenu(m, 1);
}

/** onClick for a button with data-menu="some-menu-id": opens that .menu, or closes it when it is the open one
 *  (what wire() gave every [data-menu]). <button data-menu="export-menu" onClick={onMenuButton}>. */
export function onMenuButton(e: SyntheticEvent<HTMLElement> | MouseEvent): void {
  e.stopPropagation();
  const b = e.currentTarget as HTMLElement;
  const m = $('#' + b.dataset.menu), open = !m.classList.contains('open');
  closeMenus();
  m.classList.toggle('open', open);
  if (open) openedMenu(m.querySelector<HTMLElement>('.menu-list')!, b);
}

let installed = false;
export function installMenus(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    const list = openMenuList();
    if (!list) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      moveMenu(list, k === 'ArrowUp' ? -1 : 1, k === 'Home' ? 'first' : k === 'End' ? 'last' : null);
    } else if (k === 'Enter' || k === ' ') {
      const d = list.querySelector<HTMLElement>('.kb');
      if (!d) return;
      d.click();
      if (menuTrigger && menuTrigger.focus) menuTrigger.focus();
    } else if (k === 'Escape' || k === 'Tab') {
      closeMenus();
      if (menuTrigger && menuTrigger.focus) menuTrigger.focus();
    } else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  // A click anywhere else closes the open menu. Handlers that open one call e.stopPropagation() so this never sees them.
  document.addEventListener('click', closeMenus);
}
