/* Streamed text (app.js 3377–3441): shown at a steady pace, each newly shown run fading in. The text is drawn again
   as Markdown on every step; the runs shown in the last moment are wrapped in spans whose fade starts in the past (a
   negative delay), so drawing again never restarts a fade that is under way.
   This is the one piece of the conversation the page still patches by hand, every frame while a reply streams: the
   element belongs to a Reveal (React renders it empty and never looks inside), and its nodes are made one by one
   from the Markdown tree, never from a string of markup. */
import { reducedMotion } from '../lib/motion';
import { mdFragment } from './markdown';

export const FADE_MS = 320;

interface Mark { from: number; to: number; t: number }

export class Reveal {
  el: HTMLElement;
  onGrow: (() => void) | null;
  src = '';
  shown = 0;
  len = 0;
  /** The runs still fading in. null: nothing fades (what was already said is shown at once). */
  marks: Mark[] | null = [];
  raf = 0;
  fast = false;
  timer: ReturnType<typeof setTimeout> | 0 = 0;

  constructor(el: HTMLElement, onGrow: (() => void) | null) { this.el = el; this.onGrow = onGrow; }
  push(d: string, fast?: boolean): void {
    this.src += d;
    if (fast) this.fast = true;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
  }
  tick(): void {
    this.raf = 0;
    const left = this.src.length - this.shown;
    if (left <= 0) return;
    let end = reducedMotion.matches ? this.src.length : Math.min(this.src.length, this.shown + Math.max(2, Math.ceil(left / (this.fast ? 6 : 12))));
    const ws = this.src.slice(end).search(/\s/); // finish the word
    if (ws > 0 && ws < 14) end += ws;
    this.shown = end;
    this.render();
    if (this.shown < this.src.length) this.raf = requestAnimationFrame(() => this.tick());
  }
  /** Everything at once (a chat being shown again, or the end of the reply). */
  finish(): void {
    cancelAnimationFrame(this.raf); this.raf = 0;
    if (this.shown < this.src.length) { this.shown = this.src.length; this.render(); }
  }
  render(): void {
    const now = performance.now();
    const content = mdFragment(this.src.slice(0, this.shown));
    const total = (content.textContent || '').length;
    if (total > this.len && this.len + total > 0 && this.marks !== null) this.marks.push({ from: this.len, to: total, t: now });
    this.len = total;
    this.marks = (this.marks || []).filter((m) => now - m.t < FADE_MS);
    if (this.marks.length && !reducedMotion.matches) wrapFresh(content, this.marks, now);
    this.el.replaceChildren(content);
    clearTimeout(this.timer);
    if (this.marks.length) this.timer = setTimeout(() => { if (!this.raf) this.render(); }, FADE_MS); // drop the spans when the fades end
    if (this.onGrow) this.onGrow();
  }
}

export function wrapFresh(root: Node, marks: Mark[], now: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let pos = 0;
  const first = marks[0].from;
  for (const node of nodes) {
    const s = pos, e = pos + node.data.length, text = node.data;
    pos = e;
    if (e <= first) continue;
    const frag = document.createDocumentFragment();
    let cur = s;
    if (cur < first) { frag.append(text.slice(0, first - s)); cur = first; }
    for (const m of marks) {
      const a = Math.max(cur, m.from), b = Math.min(e, m.to);
      if (b <= a) continue;
      if (a > cur) frag.append(text.slice(cur - s, a - s));
      const span = document.createElement('span');
      span.className = 'fresh';
      span.style.animationDelay = `${Math.round(m.t - now)}ms`;
      span.textContent = text.slice(a - s, b - s);
      frag.append(span);
      cur = b;
    }
    if (cur < e) frag.append(text.slice(cur - s));
    node.replaceWith(frag);
  }
}
