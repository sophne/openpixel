/* Keyboard access (app.js 2901–2916).
   Things drawn as plain boxes that act like buttons (tools, layers, frames, swatches, toggles) get focus, a role and a
   name, and answer Return and Space like a button does. */
import type { KeyboardEvent } from 'react';

/** For JSX: <div className="tool" {...pressableProps('Pencil')} onClick={…}>. The same attributes pressable() set. */
export function pressableProps(label?: string, role = 'button'): {
  tabIndex: number; role: string; 'aria-label'?: string; 'data-pressable': string; onKeyDown(e: KeyboardEvent<HTMLElement>): void;
} {
  return {
    tabIndex: 0,
    role,
    ...(label ? { 'aria-label': label } : {}),
    'data-pressable': '1',
    onKeyDown(e) {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopPropagation(); e.currentTarget.click();
    },
  };
}

/** For an element built by hand (the old pressable). */
export function pressable<T extends HTMLElement>(el: T, label?: string, role = 'button'): T {
  el.tabIndex = 0;
  el.setAttribute('role', role);
  if (label) el.setAttribute('aria-label', label);
  if (!el.dataset.pressable) {
    el.dataset.pressable = '1';
    el.addEventListener('keydown', (e) => {
      if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopPropagation(); el.click();
    });
  }
  return el;
}
