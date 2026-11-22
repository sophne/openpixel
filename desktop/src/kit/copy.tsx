/* Copy buttons answer in place, like the website's (app.js 130–146): "Copy" cross-fades (with a touch of blur) to a
   check and "Copied", and back after a moment. Both labels share one grid cell, so the button keeps its width.
   The swap happens in the click itself, not on the next render. */
import { useRef, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { nativeAction } from '../lib/host';
import { Icon, icon } from '../lib/icons';

type Text = string | (() => string);
const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function pressed(btn: HTMLElement, text: Text): void {
  const [idle, done] = btn.children;
  const show = (copied: boolean) => {
    idle.classList.toggle('out', copied); done.classList.toggle('out', !copied);
    if (copied) btn.setAttribute('aria-label', 'Copied'); else btn.removeAttribute('aria-label');
  };
  nativeAction('copyText', { text: typeof text === 'function' ? text() : text });
  show(true);
  clearTimeout(timers.get(btn));
  timers.set(btn, setTimeout(() => show(false), 1500));
}

/** Turns a button built by hand into a copy button (the old copyButton). In JSX use <CopyButton>. */
export function copyButton(btn: HTMLElement, text: Text): void {
  btn.classList.add('swapper');
  btn.innerHTML = `<span class="swap">${icon('copy', 13)}Copy</span><span class="swap out">${icon('check', 13)}Copied</span>`;
  btn.onclick = () => pressed(btn, text);
}

/** <button class="… swapper"><span class="swap">⧉Copy</span><span class="swap out">✓Copied</span></button>.
 *  `className` is the button's own classes ("copy", "btn small copy", …) and must not change between renders. */
export function CopyButton({ text, className, ...rest }: { text: Text } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'>): ReactElement {
  const latest = useRef(text);
  latest.current = text;
  return (
    <button type="button" {...rest} className={className ? `${className} swapper` : 'swapper'} onClick={(e) => pressed(e.currentTarget, () => { const t = latest.current; return typeof t === 'function' ? t() : t; })}>
      <span className="swap"><Icon name="copy" size={13} />Copy</span><span className="swap out"><Icon name="check" size={13} />Copied</span>
    </button>
  );
}
