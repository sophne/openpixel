/* The toast over the canvas: one line that fades after a moment; agent edits show shorter and tinted. */
import type { ReactElement } from 'react';
import { $ } from '../lib/dom';

let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string, agent = false): void {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.toggle('agent', agent);
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), agent ? 1800 : 2600);
}

/** The toast's element. The editor renders it as the last child of #stage. toast() fills it; it has no props. */
export function Toast(): ReactElement {
  return <div id="toast" role="status" aria-live="polite"></div>;
}
