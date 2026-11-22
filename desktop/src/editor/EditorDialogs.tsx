/* PLACEHOLDER (kit): the colour picker, the keyboard shortcuts dialog and the review dialog (index.html 355–366, 391–408)
   The static markup of app/web/index.html, as JSX, with no behaviour. The editor port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';
import { Modal } from '../kit';
import { stopKeys } from '../lib/dom';

/** #picker: the colour picker popover (openPicker, wirePicker in app.js). */
export function Picker(): ReactElement {
  return (
    <div className="popover" id="picker" hidden>
      <canvas id="sv" width="432" height="300"></canvas>
      <input type="range" id="hue" min="0" max="360" defaultValue="0" />
      <div className="row">
        <div id="pk-swatch"></div>
        <input id="pk-hex" className="field mono" spellCheck={false} onKeyDown={stopKeys} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn small" id="pk-cancel">Cancel</button>
        <button className="btn small primary" id="pk-ok">Add</button>
      </div>
    </div>
  );
}

/** #shortcuts-dialog (showShortcuts in app.js; key caps through keyCaps() of lib/platform). */
export function ShortcutsDialog(): ReactElement {
  return (
    <Modal id="shortcuts-dialog" labelledBy="shortcuts-title">
      <header id="shortcuts-title">Keyboard shortcuts</header>
      <div className="content">
        <div id="shortcuts-body" className="shortcuts"></div>
      </div>
      <footer>
        <button className="btn primary" data-close="">Done</button>
      </footer>
    </Modal>
  );
}

/** #review-dialog (showReview in app.js). */
export function ReviewDialog(): ReactElement {
  return (
    <Modal id="review-dialog" labelledBy="review-title">
      <header id="review-title">Review</header>
      <div className="content">
        <img id="review-img" alt="" />
        <div id="review-stats" className="muted"></div>
        <ul id="review-issues"></ul>
      </div>
      <footer>
        <button className="btn primary" data-close="">Close</button>
      </footer>
    </Modal>
  );
}
