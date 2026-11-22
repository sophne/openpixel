/* The colour picker, the keyboard shortcuts dialog and the review dialog. */
import { useRef, type ReactElement } from 'react';
import { Modal } from '../kit';
import { $, useEvent } from '../lib/dom';
import { keyCaps } from '../lib/platform';
import { useStore } from '../lib/store';
import { closePicker, drawPicker, pickerHex, pk, setPickerHex } from './colour';
import { reviewView, SHORTCUTS, shortcutsView, type ShortcutRow } from './controls';

/** #picker: the colour picker popover. openPicker() places it by hand next to what opened it; the square is drawn by
 *  drawPicker(), which also writes the swatch, the hex field and the hue slider. */
export function Picker(): ReactElement {
  const p = useStore(pk);
  const hue = useRef<HTMLInputElement>(null), hexField = useRef<HTMLInputElement>(null);
  const dragging = useRef(false);
  const setFromMouse = (e: { clientX: number; clientY: number }): void => {
    const r = $('#sv').getBoundingClientRect();
    pk.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    pk.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    drawPicker();
  };
  useEvent<MouseEvent>(window, 'mousemove', (e) => { if (dragging.current) setFromMouse(e); });
  useEvent(window, 'mouseup', () => { dragging.current = false; });
  // The slider's and the field's own `input` events, on the elements themselves (as before).
  useEvent(hue, 'input', () => { pk.h = +hue.current!.value; drawPicker(); });
  useEvent(hexField, 'input', () => { setPickerHex(hexField.current!.value); });
  useEvent<MouseEvent>(document, 'mousedown', (e) => {
    const t = e.target as Element;
    if (!pk.open || $('#picker').contains(t)) return;
    if (t.closest('#palette, #add-color, #fg, #tb-color')) return;
    closePicker();
  });
  return (
    <div className="popover" id="picker" hidden={!p.open}>
      <canvas id="sv" width="432" height="300" onMouseDown={(e) => { dragging.current = true; setFromMouse(e); }}></canvas>
      <input type="range" id="hue" min="0" max="360" defaultValue="0" ref={hue} />
      <div className="row">
        <div id="pk-swatch"></div>
        <input id="pk-hex" className="field mono" spellCheck={false} ref={hexField}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { if (setPickerHex(e.currentTarget.value)) $('#pk-ok').click(); }
            if (e.key === 'Escape') closePicker();
          }} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn small" id="pk-cancel" onClick={closePicker}>Cancel</button>
        <button className="btn small primary" id="pk-ok" onClick={() => { const f = pk.onOk, hex = pickerHex(); closePicker(); if (f) f(hex); }}>{p.okLabel}</button>
      </div>
    </div>
  );
}

const group = ([name, rows]: [string, ShortcutRow[]]): ReactElement => (
  <section key={name}>
    <h3>{name}</h3>
    {rows.map(([what, keys], i) => (
      <div className="sc" key={i}>
        <span>{what}</span>
        <span>{keyCaps(keys).map((k, j) => ['click', 'drag'].includes(k) ? <span className="muted" key={j}>{` ${k}`}</span> : <kbd key={j}>{k}</kbd>)}</span>
      </div>
    ))}
  </section>
);
/** #shortcuts-dialog. The list is written when the dialog is first asked for and again each time (showShortcuts()). */
export function ShortcutsDialog(): ReactElement {
  const { n } = useStore(shortcutsView);
  return (
    <Modal id="shortcuts-dialog" labelledBy="shortcuts-title">
      <header id="shortcuts-title">Keyboard shortcuts</header>
      <div className="content">
        <div id="shortcuts-body" className="shortcuts">
          {/* Two columns with their headings on one line: drawing on the left, document and view on the right. */}
          {n ? <div key={`l${n}`}>{SHORTCUTS.slice(0, 3).map(group)}</div> : null}
          {n ? <div key={`r${n}`}>{SHORTCUTS.slice(3).map(group)}</div> : null}
        </div>
      </div>
      <footer>
        <button className="btn primary" data-close="">Done</button>
      </footer>
    </Modal>
  );
}

/** #review-dialog: the engine's review of the model (showReview()). */
export function ReviewDialog(): ReactElement {
  const r = useStore(reviewView);
  return (
    <Modal id="review-dialog" labelledBy="review-title">
      <header id="review-title">Review</header>
      <div className="content">
        <img id="review-img" alt="" src={r.src}
          onLoad={(e) => { const img = e.currentTarget; img.style.width = Math.min(860, img.naturalWidth * 1.5) + 'px'; }} />
        <div id="review-stats" className="muted">{r.stats}</div>
        <ul id="review-issues">{r.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
      </div>
      <footer>
        <button className="btn primary" data-close="">Close</button>
      </footer>
    </Modal>
  );
}
