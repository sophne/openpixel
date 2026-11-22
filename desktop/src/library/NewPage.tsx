/* PLACEHOLDER (kit): the New file page, #newpage, and the new-file dialog, #newfile-dialog (index.html 274–287, 314–337)
   The static markup of app/web/index.html, as JSX, with no behaviour. The library port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';
import { Modal, Stepper } from '../kit';
import { stopKeys } from '../lib/dom';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { ui } from '../state/ui';

/** The New file page (the + in the tab bar), like Figma's: start a 2D or 3D file, import one, or find a file. */
export function NewPage(): ReactElement {
  const { view } = useStore(ui); // the page shows while ui.view is 'new' (app/pages.ts)
  return (
    <div id="newpage" hidden={view !== 'new'} role="main" aria-label="New file">
      <div className="np-inner">
        <div className="np-starts" role="group" aria-label="Start">
          <button type="button" className="btn outline haptic np-start" id="np-2d"><span className="ic k2d"><Icon name="file-2d" /></span>2D File</button>
          <button type="button" className="btn outline haptic np-start" id="np-3d"><span className="ic k3d"><Icon name="file-3d" /></span>3D File</button>
          <button type="button" className="btn outline haptic np-start" id="np-import" title="Open an .openpixel or .vox file"><span className="ic kimp"><Icon name="folder-input" /></span>Import</button>
        </div>
        <label className="np-search">
          <Icon name="search" />
          <input id="np-search" placeholder="Search all files" spellCheck={false} autoComplete="off" aria-label="Search all files" onKeyDown={stopKeys} />
        </label>
        <div className="np-h" id="np-title">Recents</div>
        <div className="np-list" id="np-recents" role="list"></div>
        <button type="button" className="np-more" id="np-browse">Browse all recent<Icon name="chevron-right" /></button>
      </div>
    </div>
  );
}

/** New 2D / 3D file: name, size and palette (2D File and 3D File on the New file page). */
export function NewFileDialog(): ReactElement {
  return (
    <Modal id="newfile-dialog" className="newfile" labelledBy="newfile-title" width={460}>
      <header id="newfile-title">New 2D file</header>
      <div className="content">
        <div className="row">
          <label htmlFor="nf-name">Name</label>
          <input id="nf-name" className="field" defaultValue="Untitled" spellCheck={false} autoComplete="off" onKeyDown={stopKeys} />
        </div>
        <div className="row">
          <label id="nf-size-label">Size</label>
          <Stepper min={1} max={256} title="Width" input={{ id: 'nf-x', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Width in pixels' }} />
          <span className="times" aria-hidden="true">×</span>
          <Stepper min={1} max={256} title="Height" input={{ id: 'nf-y', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Height in pixels' }} />
          <span className="times nf-3d" aria-hidden="true">×</span>
          <Stepper className="nf-3d" min={1} max={256} title="Depth" input={{ id: 'nf-z', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Depth in voxels' }} />
        </div>
        <div className="row nf-presets" role="group" aria-label="Size presets">
          <label></label>
          <button type="button" className="chip" data-nf-size="16">16</button>
          <button type="button" className="chip" data-nf-size="24">24</button>
          <button type="button" className="chip" data-nf-size="32">32</button>
          <button type="button" className="chip" data-nf-size="48">48</button>
          <button type="button" className="chip" data-nf-size="64">64</button>
        </div>
        <div className="row">
          <label id="nf-palette-label">Palette</label>
          <div id="nf-palette"></div>
        </div>
        <p className="nf-hint" id="nf-hint"></p>
      </div>
      <footer>
        <button type="button" className="btn" data-close="">Cancel</button>
        <button type="button" className="btn primary" id="nf-ok">
          <Icon name="plus" />
          <span className="lbl">Create</span>
        </button>
      </footer>
    </Modal>
  );
}
