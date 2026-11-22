/* The New file page, #newpage, and the new-file dialog, #newfile-dialog (index.html 274–287, 314–337; what
   renderNewRecents() built and wireNewPage() and wireNewFileDialog() attached, app.js 2497–2610). The logic is in
   ./newpage. */
import { memo, useRef, type ReactElement, type RefObject } from 'react';
import { Dropdown, Modal, Stepper } from '../kit';
import { $, useEvent } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { timeAgo } from '../lib/format';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { ui } from '../state/ui';
import { EmptyState } from './EmptyState';
import { openItem, type LibFile } from './homePage';
import {
  browseRecents, closeNewPage, createFromDialog, NEW_PALETTES, newFile, newRecents, nfHint, openNewFileDialog, pickPreset, renderNewRecents, setNfPalette,
} from './newFile';

/** One file of the list. */
function RecentRow({ f }: { f: LibFile }): ReactElement {
  return (
    <div className="np-row" tabIndex={0} data-id={f.id} role="listitem" title={f.sample ? 'Built into OpenPixel' : f.dir}
      onClick={(e) => { openItem(f, e.currentTarget); }}
      onKeyDown={(e) => {
        const r = e.currentTarget;
        if (e.key === 'Enter') openItem(f, r);
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling;
          if (next && next.classList.contains('np-row')) (next as HTMLElement).focus(); else if (e.key === 'ArrowUp') $('#np-search').focus();
        }
      }}>
      <div className="th">
        {f.thumb ? <img alt="" draggable={false} src={f.thumb} /> : null}
        <span className={`kind ${f.kind === '3d' ? 'k3d' : 'k2d'}`}><Icon name={f.kind === '3d' ? 'file-3d' : 'file-2d'} size={11} /></span>
      </div>
      <div className="t">{f.name}</div>
      <div className="when">{f.archived ? 'In the Archive' : f.sample ? 'Sample' : timeAgo(f.touched as number)}</div>
    </div>
  );
}

/** Recents, or what the search found: redrawn when renderNewRecents() says so. */
const Recents = memo(function Recents(): ReactElement {
  const { title, browseHidden, files, empty } = useStore(newRecents);
  return (
    <>
      <div className="np-h" id="np-title">{title}</div>
      <div className="np-list" id="np-recents" role="list">
        {files.map((f) => <RecentRow key={f.id} f={f} />)}
        {empty ? <EmptyState art={empty.art} text={empty.text} cls="np-empty" /> : null}
      </div>
      <button type="button" className="np-more" id="np-browse" hidden={browseHidden} onClick={browseRecents}>Browse all recent<Icon name="chevron-right" /></button>
    </>
  );
});

/** The New file page (the + in the tab bar), like Figma's: start a 2D or 3D file, import one, or find a file. */
export function NewPage(): ReactElement {
  const { view } = useStore(ui); // the page shows while ui.view is 'new' (app/pages.ts)
  const search = useRef<HTMLInputElement>(null);
  useEvent(search, 'input', renderNewRecents);
  return (
    <div id="newpage" hidden={view !== 'new'} role="main" aria-label="New file">
      <div className="np-inner">
        <div className="np-starts" role="group" aria-label="Start">
          <button type="button" className="btn outline haptic np-start" id="np-2d" onClick={() => openNewFileDialog('2d')}><span className="ic k2d"><Icon name="file-2d" /></span>2D File</button>
          <button type="button" className="btn outline haptic np-start" id="np-3d" onClick={() => openNewFileDialog('3d')}><span className="ic k3d"><Icon name="file-3d" /></span>3D File</button>
          <button type="button" className="btn outline haptic np-start" id="np-import" title="Open an .openpixel or .vox file" onClick={() => { nativeAction('open'); }}><span className="ic kimp"><Icon name="folder-input" /></span>Import</button>
        </div>
        <label className="np-search">
          <Icon name="search" />
          <input id="np-search" ref={search} placeholder="Search all files" spellCheck={false} autoComplete="off" aria-label="Search all files"
            onKeyDown={(e) => {
              e.stopPropagation();
              const input = e.currentTarget;
              if (e.key === 'Escape') { if (input.value) { input.value = ''; renderNewRecents(); } else closeNewPage(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); const r = $('#np-recents .np-row'); if (r) r.focus(); }
              else if (e.key === 'Enter') { const r = $('#np-recents .np-row'); if (r) r.click(); }
            }} />
        </label>
        <Recents />
      </div>
    </div>
  );
}

/** One of the dialog's four fields: Return creates the file, and typing or stepping updates the hint and presets.
 *  The listeners sit on the field itself, as before, so they run before the stepper's own handling of the key. */
function useNfField(ref: RefObject<HTMLInputElement | null>): void {
  useEvent<KeyboardEvent>(ref, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createFromDialog(); } });
  useEvent(ref, 'input', nfHint);
  useEvent(ref, 'change', nfHint);
}

/** New 2D / 3D file: name, size and palette (2D File and 3D File on the New file page). */
export function NewFileDialog(): ReactElement {
  const { opened, kind, hint, preset } = useStore(newFile);
  const name = useRef<HTMLInputElement>(null), x = useRef<HTMLInputElement>(null), y = useRef<HTMLInputElement>(null), z = useRef<HTMLInputElement>(null);
  useNfField(name); useNfField(x); useNfField(y); useNfField(z);
  const flat = opened && kind !== '3d'; // no depth for a 2D file
  return (
    <Modal id="newfile-dialog" className="newfile" labelledBy="newfile-title" width={460}>
      <header id="newfile-title">{kind === '3d' ? 'New 3D file' : 'New 2D file'}</header>
      <div className="content">
        <div className="row">
          <label htmlFor="nf-name">Name</label>
          <input id="nf-name" ref={name} className="field" defaultValue="Untitled" spellCheck={false} autoComplete="off" onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="row">
          <label id="nf-size-label">Size</label>
          <Stepper min={1} max={256} title="Width" inputRef={x} input={{ id: 'nf-x', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Width in pixels' }} />
          <span className="times" aria-hidden="true">×</span>
          <Stepper min={1} max={256} title="Height" inputRef={y} input={{ id: 'nf-y', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Height in pixels' }} />
          <span className="times nf-3d" aria-hidden="true" hidden={flat}>×</span>
          <Stepper className="nf-3d" hidden={flat} min={1} max={256} title="Depth" inputRef={z} input={{ id: 'nf-z', className: 'mono', defaultValue: '32', inputMode: 'numeric', 'aria-label': 'Depth in voxels' }} />
        </div>
        <div className="row nf-presets" role="group" aria-label="Size presets">
          <label></label>
          {['16', '24', '32', '48', '64'].map((n) => (
            <button key={n} type="button" className={preset === n ? 'chip on' : 'chip'} data-nf-size={n} aria-pressed={opened ? preset === n : undefined} onClick={() => pickPreset(n)}>{n}</button>
          ))}
        </div>
        <div className="row">
          <label id="nf-palette-label">Palette</label>
          <Dropdown id="nf-palette" options={NEW_PALETTES} value="db32" onChange={nfHint} ref={setNfPalette} button={{ 'aria-labelledby': 'nf-palette-label' }} />
        </div>
        <p className="nf-hint" id="nf-hint">{hint}</p>
      </div>
      <footer>
        <button type="button" className="btn" data-close="">Cancel</button>
        <button type="button" className="btn primary" id="nf-ok" onClick={() => { createFromDialog(); }}>
          <Icon name="plus" />
          <span className="lbl">Create</span>
        </button>
      </footer>
    </Modal>
  );
}
