/* Markdown in replies: a safe subset: paragraphs, headings, lists, code, bold, italics, rules,
   links shown as text. Everything an agent says is untrusted, so nothing here ever becomes markup: the text is turned
   into a small tree of plain nodes (eleven tag names, two class names, a title for links) and that tree is drawn
   either as React elements (<Markdown>) or as DOM nodes made one by one (mdFragment, for text that is still
   streaming in: see reveal.ts). There is no innerHTML and no dangerouslySetInnerHTML on either path, no raw HTML, no
   images, and a link is a <span> with the address as its title: nothing here is ever navigated to or fetched.

   The page this was ported from built an HTML string and let the browser parse it. To give the same tree for every
   input, however badly formed, this keeps that string pipeline for one line of text (escape, then the same regular expressions
   in the same order) and then reads the result back with a tokenizer that knows exactly the eight tags that pipeline
   can write. Markers that overlap ("**a *b** c*") make mis-nested tags; the browser repairs those with the HTML
   parser's rules for formatting elements, so the same rules are followed here (reconstructing the active formatting
   elements, and the adoption agency algorithm, which is short when nothing but inline elements can be open). */
import { createElement, memo, type ReactElement, type ReactNode } from 'react';
import { escapeHtml } from '../lib/dom';

type InlineTag = 'strong' | 'em' | 'code' | 'span';
export interface MdEl {
  tag: 'p' | 'pre' | 'hr' | 'ul' | 'ol' | 'li' | 'br' | InlineTag;
  cls?: 'md-h' | 'md-link';
  /** A link's address, shown as a tooltip only. */
  title?: string;
  kids: MdNode[];
}
export type MdNode = string | MdEl;

/** One line as the old mdInline() wrote it: escaped text with <strong>, <em>, <code> and
 *  <span class="md-link" title="…"> around the marked runs. Only inlineNodes() below reads this string; it is never
 *  given to the browser as markup. */
function inlineMarkup(raw: string): string {
  const codes: string[] = [];
  let s = escapeHtml(raw).replace(/`([^`\n]+)`/g, (_m, c: string) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_\n]*)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '<span class="md-link" title="$2">$1</span>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[+i]}</code>`);
}

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' };
/** The reverse of escapeHtml: the only character references the pipeline can contain. */
const unescapeHtml = (s: string): string => s.replace(/&(?:amp|lt|gt|quot);/g, (m) => ENTITY[m]);

const TAGS: [string, 'start' | 'end', InlineTag][] = [
  ['<strong>', 'start', 'strong'], ['</strong>', 'end', 'strong'], ['<em>', 'start', 'em'], ['</em>', 'end', 'em'],
  ['<code>', 'start', 'code'], ['</code>', 'end', 'code'], ['</span>', 'end', 'span'],
];
const LINK_OPEN = '<span class="md-link" title="';

/** Builds the tree the way the HTML parser built it from md()'s string. The block elements (p, pre, ul, ol, li, hr,
 *  br) arrive well formed; the inline ones may not: overlapping markers close in the wrong order, and a link's
 *  address can swallow a tag ("[x](**a)b**" leaves a </strong> with nothing to close, "**a [x](b**)" a <strong>
 *  that never ends). The parser's repairs for those are the ones for "formatting elements" (strong, em, code):
 *  it remembers the ones still wanted and opens them again before the next thing it adds, even in the next
 *  paragraph. */
class TreeBuilder {
  readonly root: MdNode[] = [];
  private stack: MdEl[] = [];   // the open elements, outermost first
  private active: MdEl[] = [];  // the parser's list of active formatting elements
  private kids(): MdNode[] { return this.stack.length ? this.stack[this.stack.length - 1].kids : this.root; }
  private open(el: MdEl): MdEl { this.kids().push(el); this.stack.push(el); return el; }
  /** Formatting elements that are remembered but no longer open are opened again, inside whatever is open now. */
  private reconstruct(): void {
    const { active, stack } = this;
    if (!active.length || stack.includes(active[active.length - 1])) return;
    let i = active.length - 1;
    while (i > 0 && !stack.includes(active[i - 1])) i--;
    for (; i < active.length; i++) active[i] = this.open({ tag: active[i].tag, kids: [] });
  }
  /** Text as it is meant to read (already unescaped). */
  text(raw: string): void {
    const t = raw.replace(/\u0000/g, ''); // the parser drops NUL characters in text
    if (!t) return;
    this.reconstruct();
    const k = this.kids(), last = k[k.length - 1];
    if (typeof last === 'string') k[k.length - 1] = last + t; else k.push(t);
  }
  /** <p>, <pre>, <ul>, <ol>, <li>: added as they are. */
  block(tag: 'p' | 'pre' | 'ul' | 'ol' | 'li', cls?: 'md-h'): void { this.open(cls ? { tag, cls, kids: [] } : { tag, kids: [] }); }
  /** </p>, </pre>, </ul>, </ol>, </li>: closes the block and whatever is still open inside it. */
  endBlock(tag: MdEl['tag']): void {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].tag === tag) { this.stack.length = i; return; }
  }
  hr(): void { this.kids().push({ tag: 'hr', kids: [] }); }
  br(): void { this.reconstruct(); this.kids().push({ tag: 'br', kids: [] }); }
  start(tag: InlineTag, title?: string): void {
    this.reconstruct();
    if (tag === 'span') { this.open({ tag, cls: 'md-link', title, kids: [] }); return; }
    const el = this.open({ tag, kids: [] });
    const same = this.active.filter((a) => a.tag === tag);
    if (same.length >= 3) this.active.splice(this.active.indexOf(same[0]), 1); // at most three alike are remembered
    this.active.push(el);
  }
  /** An end tag for something that is not a formatting element (and the fallback for one that is not remembered):
   *  closes the nearest open element of that name with everything opened inside it, looking no further out than the
   *  block it is in. */
  private endOther(tag: InlineTag): void {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].tag === tag) { this.stack.length = i; return; }
      if (!INLINE.has(this.stack[i].tag)) return;
    }
  }
  /** The parser's "adoption agency algorithm" for </strong>, </em> and </code>. Inside a paragraph nothing but inline
   *  elements can be open below the one being closed, which leaves these steps of it. */
  end(tag: InlineTag): void {
    if (tag === 'span') { this.endOther(tag); return; }
    const { active, stack } = this;
    const cur = stack[stack.length - 1];
    if (cur && cur.tag === tag && !active.includes(cur)) { stack.pop(); return; }
    let fe: MdEl | null = null;
    for (let i = active.length - 1; i >= 0 && !fe; i--) if (active[i].tag === tag) fe = active[i];
    if (!fe) { this.endOther(tag); return; }
    const at = stack.indexOf(fe);
    if (at >= 0) stack.length = at; // closes it and whatever is still open inside it (those stay remembered)
    active.splice(active.indexOf(fe), 1);
  }
  /** One line of text: mdInline()'s string, read back tag by tag. */
  inline(raw: string): void {
    const s = inlineMarkup(raw);
    let from = 0;
    for (let i = s.indexOf('<'); i >= 0; i = s.indexOf('<', i)) {
      let len = 0;
      const simple = TAGS.find(([t]) => s.startsWith(t, i));
      if (simple) {
        this.text(unescapeHtml(s.slice(from, i)));
        if (simple[1] === 'start') this.start(simple[2]); else this.end(simple[2]);
        len = simple[0].length;
      } else if (s.startsWith(LINK_OPEN, i)) {
        const q = s.indexOf('"', i + LINK_OPEN.length);
        if (q >= 0 && s[q + 1] === '>') {
          this.text(unescapeHtml(s.slice(from, i)));
          // In an attribute the parser keeps a NUL as U+FFFD.
          this.start('span', unescapeHtml(s.slice(i + LINK_OPEN.length, q)).replace(/\u0000/g, '�'));
          len = q + 2 - i;
        }
      }
      if (len) { i += len; from = i; } else i++; // anything else stays text (escaped text never holds a "<")
    }
    this.text(unescapeHtml(s.slice(from)));
  }
}
const INLINE: ReadonlySet<string> = new Set(['strong', 'em', 'code', 'span']);

/** The whole text as a tree: what the old md() wrote, as the browser parsed it. */
export function mdTree(src: string): MdNode[] {
  const lines = src.replace(/\r/g, '').split('\n');
  const t = new TreeBuilder();
  let para: string[] = [], list: { type: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = (): void => {
    if (!para.length) return;
    t.block('p');
    para.forEach((l, i) => { if (i) t.br(); t.inline(l); });
    t.endBlock('p');
    para = [];
  };
  const flushList = (): void => {
    if (!list) return;
    t.block(list.type);
    for (const i of list.items) { t.block('li'); t.inline(i); t.endBlock('li'); }
    t.endBlock(list.type);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      t.block('pre'); t.start('code'); t.text(body.join('\n')); t.end('code'); t.endBlock('pre');
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); t.block('p', 'md-h'); t.inline(h[2]); t.endBlock('p'); continue; }
    // (In the old pattern's class, [\s\1], the \1 was not the marker but the character U+0001: written out here.)
    if (/^\s*([-*_])\s*\1\s*\1[\s\x01]*$/.test(line)) { flushPara(); flushList(); t.hr(); continue; }
    const li = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const type = li[1] ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list!.items.push(li[3]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ' ' + line.trim(); continue; }
    flushList();
    para.push(line.replace(/^\s*>\s?/, ''));
  }
  flushPara(); flushList();
  return t.root;
}

function elements(nodes: MdNode[]): ReactNode[] {
  return nodes.map((n, i) => (typeof n === 'string' ? n
    : createElement(n.tag, { key: i, className: n.cls, title: n.title }, ...elements(n.kids))));
}
/** The text as React elements (they go straight into the .md element: this adds no box of its own). */
export const Markdown = memo(function Markdown({ src }: { src: string }): ReactElement {
  return <>{elements(mdTree(src))}</>;
});

/** The same tree as DOM nodes, for the element the streaming text patches by hand (reveal.ts). */
export function mdFragment(src: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const add = (parent: Node, nodes: MdNode[]): void => {
    for (const n of nodes) {
      if (typeof n === 'string') { parent.appendChild(document.createTextNode(n)); continue; }
      const el = document.createElement(n.tag);
      if (n.cls) el.className = n.cls;
      if (n.title != null) el.setAttribute('title', n.title);
      add(el, n.kids);
      parent.appendChild(el);
    }
  };
  add(frag, mdTree(src));
  return frag;
}
