/* Icons (app.js 175–218): Lucide's, plus OpenPixel's own for files, drawn on Lucide's 24-unit grid so they sit with
   the others. Everything here comes from tables bundled with the app; nothing from a file or an agent ends up in
   markup through these.
   file-2d: the app icon at icon size: a rounded square, a thin pixel grid and one filled pixel (the accent colour,
   like the app icon's orange pixel; white on an accent background).
   file-3d: an isometric cube with the same 2-unit border: its top square filled with the accent colour (like the
   2D pixel), both sides one shade of the text colour. */
import { createElement, type CSSProperties, type ReactElement } from 'react';
import { LUCIDE_ICONS, type IconNode } from './icon-data';
import { AGENT_LOGOS } from './agent-logo-data';

export type { IconNode };
export { AGENT_LOGOS };

export const LUCIDE: Record<string, IconNode[]> = {
  ...LUCIDE_ICONS,
  'x-logo': [
    ['path', { d: 'M4 4l11.733 16h4.267l-11.733-16z' }],
    ['path', { d: 'M4 20l6.768-6.768m2.46-2.46L20 4' }],
  ],
  // Agent Chat (Lucide's square-pen).
  'square-pen': [
    ['path', { d: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }],
    ['path', { d: 'M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z' }],
  ],
  'file-2d': [
    ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '4' }],
    ['path', { d: 'M7.5 3v18M12 3v18M16.5 3v18M3 7.5h18M3 12h18M3 16.5h18', 'stroke-width': '1', opacity: '.5' }],
    ['rect', { class: 'px', x: '12', y: '7.5', width: '4.5', height: '4.5', fill: 'currentColor', stroke: 'none' }],
  ],
  'file-3d': [
    ['path', { d: 'M3.5 7.5 12 12v9.25l-8.5-4.75ZM20.5 7.5 12 12v9.25l8.5-4.75Z', fill: 'currentColor', stroke: 'none', opacity: '.3' }],
    ['path', { class: 'px', d: 'M12 2.75 20.5 7.5 12 12 3.5 7.5Z', fill: 'currentColor', stroke: 'none' }],
    ['path', { d: 'M12 2.75 20.5 7.5v9L12 21.25 3.5 16.5v-9ZM3.5 7.5 12 12l8.5-4.5M12 12v9.25' }],
  ],
};
export type IconName = string;

/** The icon as markup, exactly what the old icon() returned. For the few places that still build DOM by hand
 *  (the copy button, canvas-side code); components use <Icon>. '' for a name that is not in the table. */
export function icon(name: IconName, size = 16): string {
  const nodes = LUCIDE[name];
  if (!nodes) return '';
  const kids = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="i" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
}

// The table's attribute names as React spells them.
const REACT_ATTR: Record<string, string> = { class: 'className', 'stroke-width': 'strokeWidth' };

export interface IconProps {
  name: IconName;
  size?: number;
  /** Extra classes after "i" and an id: what fillIcons() carried over from <i data-icon class id>. */
  className?: string;
  id?: string;
  style?: CSSProperties;
}
/** The same <svg class="i" …> the old icon() and fillIcons() produced. Renders nothing for an unknown name. */
export function Icon({ name, size = 16, className, id, style }: IconProps): ReactElement | null {
  const nodes = LUCIDE[name];
  if (!nodes) return null;
  return (
    <svg className={className ? `i ${className}` : 'i'} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" id={id} style={style}>
      {nodes.map(([tag, attrs], i) => {
        const props: Record<string, unknown> = { key: i };
        for (const k in attrs) props[REACT_ATTR[k] || k] = attrs[k];
        return createElement(tag, props);
      })}
    </svg>
  );
}

/** Replaces every <i data-icon="name"> under `root` with its icon, keeping the id and classes (the old fillIcons).
 *  Only for DOM built by hand; JSX uses <Icon name className id/>. */
export function fillIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('i[data-icon]').forEach((el) => {
    const t = document.createElement('template');
    t.innerHTML = icon(el.dataset.icon || '');
    const svg = t.content.firstChild as SVGElement | null;
    if (svg && el.id) svg.id = el.id;
    if (svg && el.classList.length) svg.classList.add(...el.classList);
    if (svg) el.replaceWith(svg);
  });
}

/** An agent's logo as markup from the bundled table, by its file name ('claude-color.svg'); `fallback` when it has none
 *  (the old code used icon('plug', 18) on the Agents page and icon('plug', 12) in the chat). */
export function agentLogoSvg(logo: string | null | undefined, fallback = ''): string {
  return (logo && AGENT_LOGOS[logo.replace(/\.svg$/, '')]) || fallback;
}

/** Markup from the bundled icon and logo tables, placed in an element: the one sanctioned use of
 *  dangerouslySetInnerHTML. Never pass text that came from a file, an agent or the person. */
export function TrustedSvg({ as = 'span', html, ...rest }: { as?: string; html: string } & Record<string, unknown>): ReactElement {
  return createElement(as, { ...rest, dangerouslySetInnerHTML: { __html: html } });
}
