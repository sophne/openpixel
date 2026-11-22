/* Renaming in place, the same everywhere (layers, the file in the panel, tabs, cards and rows, folders): the text
   becomes a field with the name selected; Return or clicking away keeps it, Escape goes back. `commit` answers true
   or a message to show (app.js 689–716). */
import { createElement, useCallback, useLayoutEffect, useRef, type HTMLAttributes, type ReactElement, type Ref } from 'react';
import { toast } from './toast';

export function inlineRename(el: HTMLElement | null, current: string, commit: (name: string) => unknown | Promise<unknown>): void {
  if (!el || el.querySelector('input.rename')) return;
  const input = document.createElement('input');
  input.className = 'rename'; input.value = current; input.spellcheck = false;
  input.setAttribute('aria-label', `Rename ${current}`);
  const before = el.textContent;
  const drag = el.closest<HTMLElement>('[draggable="true"]');
  if (drag) drag.draggable = false; // selecting text in the field must not start a drag
  el.textContent = ''; el.appendChild(input);
  input.focus(); input.select();
  let finished = false;
  const done = async (ok: boolean) => {
    if (finished) return; finished = true;
    const v = input.value.trim();
    input.remove();
    if (drag) drag.draggable = true;
    if (!ok || !v || v === current) { el.textContent = before; return; }
    el.textContent = v;
    const r = await commit(v);
    if (r !== true) { el.textContent = before; toast(typeof r === 'string' ? r : 'Could not rename it'); }
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } };
  input.onblur = () => { done(true); };
  for (const t of ['click', 'mousedown', 'pointerdown', 'dblclick', 'contextmenu']) input.addEventListener(t, (e) => e.stopPropagation());
}

/** An element whose text inlineRename() may replace with its field: <RenameText as="span" className="name" text={t.name}
 *  ref={…} onDoubleClick={…}/>. inlineRename() edits the element's contents by hand, so React must not own them:
 *  this draws the text itself after every render, and leaves it alone while the field is open (what the old render
 *  functions did with `if (el.querySelector('input.rename')) return`). */
export function RenameText({ as = 'span', text, ref, ...rest }: { as?: string; text: string; ref?: Ref<HTMLElement> } & HTMLAttributes<HTMLElement>): ReactElement {
  const own = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    if (el && !el.querySelector('input.rename') && el.textContent !== text) el.textContent = text;
  });
  const setRef = useCallback((el: HTMLElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) (ref as { current: HTMLElement | null }).current = el;
  }, [ref]);
  return createElement(as, { ...rest, ref: setRef });
}
