/* Dialogs: opening and closing, [data-close] buttons and backdrops, and the name and confirm dialogs.
   A dialog is open while its .modal-bg has the class `open`; openModal('#id') and closeModals() put it on and take
   it off by hand, at once (the .modal-bg keeps a constant className in JSX, see kit/menus.ts). */
import { useEffect, type ReactElement, type ReactNode, type CSSProperties } from 'react';
import { actions } from '../app/actions';
import { $, $$ } from '../lib/dom';
import { lastInput, popIn } from '../lib/motion';
import { closeMenus } from './menus';

let modalReturnFocus: Element | null = null;
export function openModal(id: string): void {
  closeMenus();
  const bg = $(id);
  if (!bg.classList.contains('open')) modalReturnFocus = document.activeElement;
  bg.classList.add('open');
  actions.reportTitlebar();
  popIn(bg, '50% 50%', { scale: 1, duration: 160 }); // the dimmed backdrop only fades
  popIn(bg.querySelector<HTMLElement>('.modal'), '50% 50%', { scale: 0.96, duration: 200 });
  // Keyboard users land inside the dialog; pointer users keep their place.
  if (lastInput === 'key') {
    const first = bg.querySelector<HTMLElement>('.modal input:not([type=hidden]), .modal .btn.primary, .modal button');
    if (first) first.focus();
  }
}
export function closeModals(): void {
  const wasOpen = $$('.modal-bg.open').length > 0;
  $$('.modal-bg').forEach((m) => m.classList.toggle('open', false));
  actions.reportTitlebar();
  const back = modalReturnFocus as HTMLElement | null;
  if (wasOpen && back && document.contains(back) && back.focus) back.focus();
  modalReturnFocus = null;
}

let installed = false;
export function installModals(): void {
  if (installed) return;
  installed = true;
  // Tab stays inside the open dialog.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const bg = $('.modal-bg.open');
    if (!bg) return;
    const items = [...bg.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"]), a[href]')]
      .filter((x) => !(x as HTMLButtonElement).disabled && x.getClientRects().length);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!bg.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);
}

export interface ModalProps {
  /** The .modal-bg's id: what openModal('#id') takes. */
  id: string;
  /** aria-labelledby: the id of the element that titles the dialog. */
  labelledBy?: string;
  role?: 'dialog' | 'alertdialog';
  /** Extra classes on the .modal ("newfile"). */
  className?: string;
  /** The .modal's width in px, where the old markup set one. */
  width?: number;
  style?: CSSProperties;
  children?: ReactNode;
}
/** <div class="modal-bg" id><div class="modal" role aria-modal aria-labelledby>…</div></div>: the shell every
 *  dialog shares. A press on the dimmed backdrop and any button with `data-close` inside close it. */
export function Modal({ id, labelledBy, role = 'dialog', className, width, style, children }: ModalProps): ReactElement {
  return (
    <div className="modal-bg" id={id}
      onMouseDown={(e) => { if (e.target === e.currentTarget) closeModals(); }}
      onClick={(e) => { if ((e.target as Element).closest('[data-close]')) closeModals(); }}>
      <div className={className ? `modal ${className}` : 'modal'} role={role} aria-modal="true" aria-labelledby={labelledBy}
        style={width ? { width, ...style } : style}>
        {children}
      </div>
    </div>
  );
}

/* Small dialogs: a name (new folder, rename) and a confirmation (delete). */
let dialogDone: ((v: any) => void) | null = null;
export function askName(title: string, okLabel: string, value?: string): Promise<string | null> {
  return new Promise((resolve) => {
    $('#name-title').textContent = title;
    $('#name-ok').textContent = okLabel;
    const input = $<HTMLInputElement>('#name-input');
    input.value = value || '';
    input.placeholder = 'Folder name';
    dialogDone = (v) => { dialogDone = null; resolve(v); };
    openModal('#name-dialog');
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}
export function askConfirm(title: string, body: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-body').textContent = body;
    $('#confirm-ok').textContent = okLabel;
    dialogDone = (v) => { dialogDone = null; resolve(v); };
    openModal('#confirm-dialog');
  });
}
export function finishDialog(v: unknown): void { const d = dialogDone; closeModals(); if (d) d(v); }

/** #name-dialog and #confirm-dialog. askName() and askConfirm() fill and open them; their texts are set by hand, so
 *  nothing in here depends on props or state. */
export function Dialogs(): ReactElement {
  // Cancel buttons, the backdrop and Escape close these dialogs as "no".
  useEffect(() => {
    const observers = ['#name-dialog', '#confirm-dialog'].map((id) => {
      const bg = $(id);
      const o = new MutationObserver(() => {
        if (!bg.classList.contains('open') && dialogDone) { const d = dialogDone; dialogDone = null; d(id === '#name-dialog' ? null : false); }
      });
      o.observe(bg, { attributes: true, attributeFilter: ['class'] });
      return o;
    });
    return () => observers.forEach((o) => o.disconnect());
  }, []);
  return (
    <>
      <Modal id="name-dialog" labelledBy="name-title" width={380}>
        <header id="name-title">New folder</header>
        <div className="content">
          <input id="name-input" className="field" spellCheck={false} style={{ width: '100%' }} aria-labelledby="name-title"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') $('#name-ok').click();
              if (e.key === 'Escape') finishDialog(null);
            }} />
        </div>
        <footer>
          <button className="btn" data-close="">Cancel</button>
          <button className="btn primary" id="name-ok"
            onClick={() => { const i = $<HTMLInputElement>('#name-input'), v = i.value.trim(); if (v) finishDialog(v); else i.focus(); }}>Create</button>
        </footer>
      </Modal>
      <Modal id="confirm-dialog" role="alertdialog" labelledBy="confirm-title" width={420}>
        <header id="confirm-title"></header>
        <div className="content" id="confirm-body"></div>
        <footer>
          <button className="btn" data-close="">Cancel</button>
          <button className="btn primary danger" id="confirm-ok" onClick={() => finishDialog(true)}>Delete permanently</button>
        </footer>
      </Modal>
    </>
  );
}
