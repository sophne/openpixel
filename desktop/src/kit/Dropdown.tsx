/* The app's own dropdown (app.js 1594–1633): a button showing the choice and a list that opens under it (above when
   there is no room), fixed to the window so a scrolling panel never clips it.
   Same markup as dropdown(el, options, …) built inside `el`:
     <div …el's own attributes… class="… dropdown menu">
       <button class="dd-btn" type="button"><span class="v">label</span><svg chevron-down 14/></button>
       <div class="menu-list dd-list"><div class="opt" data-value><span class="ck">✓</span><span class="ol">label</span>[<span class="mini">…]</div>…</div>
     </div> */
import { useImperativeHandle, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';
import { Icon } from '../lib/icons';
import { changed, store, useStore } from '../lib/store';
import { closeMenus, openedMenu, placeFixed } from './menus';

export interface DropdownOption { value: string; label: string; colors?: string[] }
/** What dropdown() returned: the choice, and set(v) to change it from code (no onChange for that). */
export interface DropdownApi { value: string | null; set(v: string | null): void }

export interface DropdownProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'children'> {
  options: DropdownOption[];
  /** The choice to start with. A different value on a later render is taken as a new choice. */
  value?: string | null;
  placeholder?: string;
  /** The button keeps showing the placeholder (a menu of actions, like "Palette preset…"). */
  keepLabel?: boolean;
  onChange?: ((value: string) => void) | null;
  /** Attributes for the .dd-btn (aria-label, data-tip, disabled). */
  button?: ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, string | undefined>;
  /** Drawn inside the button before the label (the chat's effort bars). */
  before?: ReactNode;
  /** The old return value, e.g. ref={(api) => { filterMenu = api; }}. */
  ref?: Ref<DropdownApi>;
}

export function Dropdown({ options, value = null, placeholder = '', keepLabel = false, onChange = null, button, before, ref, className, ...rest }: DropdownProps): ReactElement {
  const el = useRef<HTMLDivElement>(null), btn = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  // The choice is a store of its own, so set() from anywhere draws the label before it returns (lib/store.ts).
  const api = useRef<DropdownApi>(null);
  if (!api.current) api.current = store<DropdownApi>({ value, set(v) { api.current!.value = v; changed(api.current!); } });
  useStore(api.current);
  const given = useRef(value);
  if (given.current !== value) { given.current = value; api.current.value = value; }
  useImperativeHandle(ref, () => api.current!, []);

  const chosen = options.find((x) => x.value === api.current!.value);
  const open = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    const host = el.current!, b = btn.current!, l = list.current!;
    const opening = !host.classList.contains('open');
    closeMenus();
    if (!opening) return;
    host.classList.add('open');
    l.querySelectorAll<HTMLElement>('.opt').forEach((d) => d.classList.toggle('sel', d.dataset.value === api.current!.value));
    // Fixed position so the list is never clipped by a scrolling panel. Worked out in window coordinates (placeFixed
    // turns them into the right ones inside a glass dialog). A dialog still zooming open is finished first, so the
    // button is measured where it ends up, not mid-zoom.
    l.getAnimations().forEach((a) => a.cancel());
    for (let p = host.parentElement; p; p = p.parentElement) p.getAnimations().forEach((a) => a.finish());
    const r = b.getBoundingClientRect();
    l.style.minWidth = r.width + 'px';
    const x = Math.max(8, Math.min(r.left, window.innerWidth - l.offsetWidth - 8));
    const below = r.bottom + 4, h = l.offsetHeight;
    const y = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below;
    placeFixed(l, x, y);
    openedMenu(l, b);
  };
  return (
    <div {...rest} ref={el} className={className ? `${className} dropdown menu` : 'dropdown menu'}>
      <button {...button} ref={btn} className="dd-btn" type="button" onClick={open}>
        {before}<span className="v">{chosen && !keepLabel ? chosen.label : placeholder}</span><Icon name="chevron-down" size={14} />
      </button>
      <div ref={list} className="menu-list dd-list">
        {options.map((o) => (
          <div key={o.value} className="opt" data-value={o.value}
            onClick={(e) => { e.stopPropagation(); closeMenus(); api.current!.set(o.value); if (onChange) onChange(o.value); }}>
            <span className="ck"><Icon name="check" size={14} /></span><span className="ol">{o.label}</span>
            {o.colors ? <span className="mini">{o.colors.map((c, i) => <span key={i} style={{ background: c }}></span>)}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
