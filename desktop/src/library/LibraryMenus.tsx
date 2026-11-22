/* PLACEHOLDER (kit): the file menu of the editor's panel head, the card menu and "Move to…" (index.html 289–309)
   The static markup of app/web/index.html, as JSX, with no behaviour. The library port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { MouseEvent, ReactElement } from 'react';
import { actions } from '../app/actions';
import { Icon } from '../lib/icons';
import { REVEAL_LABEL } from '../lib/platform';

const doc = (act: string) => (e: MouseEvent) => { e.stopPropagation(); actions.docMenuAction(act); }; // wire(), app.js 3209

/** #doc-menu, #card-menu and #move-menu: lists on their own, opened with placeMenu(). #doc-menu belongs to the
 *  editor's panel head (openDocMenu, docMenuAction in app.js 735–757): its rows call actions.docMenuAction. */
export function LibraryMenus(): ReactElement {
  return (
    <>
      <div className="menu-list card-menu" id="doc-menu" role="menu">
        <div data-doc="rename" onClick={doc('rename')}><Icon name="pencil" />Rename</div>
        <div data-doc="reveal" onClick={doc('reveal')}><Icon name="search" />{REVEAL_LABEL}</div>
        <div data-doc="move" onClick={doc('move')}><Icon name="folder-input" />Move to…<span className="k"><Icon name="chevron-right" /></span></div>
        <div data-doc="saveAs" onClick={doc('saveAs')}><Icon name="save" />Save As…</div>
        <hr />
        <div data-doc="close" onClick={doc('close')}><Icon name="x" />Close tab</div>
      </div>
      <div className="menu-list card-menu" id="card-menu">
        <div data-card="open"><Icon name="folder-open" />Open</div>
        <div data-card="reveal"><Icon name="search" />{REVEAL_LABEL}</div>
        <div data-card="rename"><Icon name="pencil" />Rename</div>
        <div data-card="move"><Icon name="folder-input" />Move to…<span className="k"><Icon name="chevron-right" /></span></div>
        <hr />
        <div data-card="restore"><Icon name="archive-restore" />Restore</div>
        <div data-card="archive"><Icon name="archive" />Move to Archive</div>
        <div data-card="remove"><Icon name="x" />Remove from list</div>
        <div data-card="delete" className="danger"><Icon name="trash-2" />Delete permanently</div>
        <div data-card="deleteFolder" className="danger"><Icon name="trash-2" />Delete folder</div>
      </div>
      <div className="menu-list card-menu move-menu" id="move-menu"></div>
    </>
  );
}
