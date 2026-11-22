/* DOM helpers. $ and $$ search the whole document (ids are unique on the page). */
import { useEffect, useRef } from 'react';

/** document.querySelector. Typed as found, like the old code assumed; it is still null when nothing matches. */
export const $ = <T extends Element = HTMLElement>(s: string): T => document.querySelector(s) as T;
export const $$ = <T extends Element = HTMLElement>(s: string): T[] => [...document.querySelectorAll<T>(s)];

export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
export const errorText = (e: unknown): string =>
  String(e && (e as { message?: unknown }).message ? (e as { message: unknown }).message : e).replace(/^Error: /, '');

/** For static inputs: wire() stopped keydown at every text field so typing never reaches the page's shortcuts.
 *  Use as onKeyDown={stopKeys}, or call e.stopPropagation() first in the field's own handler. Not for range inputs. */
export const stopKeys = (e: { stopPropagation(): void }): void => e.stopPropagation();

type Target = Window | Document | Element | MediaQueryList | null | undefined;
/** addEventListener for the life of a component, always calling the newest handler: for window and document
 *  listeners, and for native events React does not offer (an input's real `change`, which React's onChange is not).
 *  `target` is window, document, an element or a ref to one. */
export function useEvent<E extends Event = Event>(
  target: Target | { current: Target },
  type: string,
  handler: (e: E) => void,
  options?: boolean | AddEventListenerOptions,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
  const passive = typeof options === 'object' ? options.passive : undefined;
  useEffect(() => {
    const t = target && 'current' in target ? target.current : target;
    if (!t) return;
    const on = (e: Event) => latest.current(e as E);
    const o = passive === undefined ? capture : { capture, passive };
    t.addEventListener(type, on, o);
    return () => t.removeEventListener(type, on, o);
  }, [target, type, capture, passive]);
}
