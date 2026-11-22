/* The file menu of the editor's panel head, the card menu and "Move to…". openCardMenu() and openMoveMenu() decide
   what the last two show; the logic is in ./homePage. */
import { Fragment, type MouseEvent, type ReactElement } from 'react';
import { actions } from '../app/actions';
import { Icon } from '../lib/icons';
import { REVEAL_LABEL } from '../lib/platform';
import { useStore } from '../lib/store';
import { cardMenu, cardMenuAction, moveMenu, moveMenuNewFolder, moveMenuPick, type CardAction } from './homePage';

const doc = (act: string) => (e: MouseEvent) => { e.stopPropagation(); actions.docMenuAction(act); };
const card = (act: CardAction) => (e: MouseEvent) => { e.stopPropagation(); cardMenuAction(act); };

/** The menu of a file or folder, from its … button or a right-click. Every row is there; openCardMenu() hides the
 *  ones that don't apply. */
function CardMenu(): ReactElement {
  const { show } = useStore(cardMenu);
  const off = (act: CardAction) => (show ? !show[act] : undefined);
  return (
    <div className="menu-list card-menu" id="card-menu" data-anchor={show ? '' : undefined}>
      <div data-card="open" hidden={off('open')} onClick={card('open')}><Icon name="folder-open" />Open</div>
      <div data-card="reveal" hidden={off('reveal')} onClick={card('reveal')}><Icon name="search" />{REVEAL_LABEL}</div>
      <div data-card="rename" hidden={off('rename')} onClick={card('rename')}><Icon name="pencil" />Rename</div>
      <div data-card="move" hidden={off('move')} onClick={card('move')}><Icon name="folder-input" />Move to…<span className="k"><Icon name="chevron-right" /></span></div>
      <hr />
      <div data-card="restore" hidden={off('restore')} onClick={card('restore')}><Icon name="archive-restore" />Restore</div>
      <div data-card="archive" hidden={off('archive')} onClick={card('archive')}><Icon name="archive" />Move to Archive</div>
      <div data-card="remove" hidden={off('remove')} onClick={card('remove')}><Icon name="x" />Remove from list</div>
      <div data-card="delete" className="danger" hidden={off('delete')} onClick={card('delete')}><Icon name="trash-2" />Delete permanently</div>
      <div data-card="deleteFolder" className="danger" hidden={off('deleteFolder')} onClick={card('deleteFolder')}><Icon name="trash-2" />Delete folder</div>
    </div>
  );
}

/** "Move to…": All folders, then every folder as a tree (the one the item is in carries the check mark), then
 *  New folder…. Each opening lists them anew. */
function MoveMenu(): ReactElement {
  const { seq, target, here, rows } = useStore(moveMenu);
  return (
    <div className="menu-list card-menu move-menu" id="move-menu">
      {target ? (
        <Fragment key={seq}>
          <div className="head">{`Move “${target.item.name}” to`}</div>
          {rows.map((r, i) => (
            <div key={i} className={r.id === here ? 'opt sel' : 'opt'} style={{ paddingLeft: `${10 + r.depth * 14}px` }}
              onClick={(e) => { e.stopPropagation(); moveMenuPick(r.id); }}>
              <Icon name={r.icon} size={14} /><span className="ol">{r.label}</span><span className="ck"><Icon name="check" size={14} /></span>
            </div>
          ))}
          <hr />
          <div onClick={(e) => { e.stopPropagation(); moveMenuNewFolder(); }}><Icon name="folder-plus" size={14} /><span>New folder…</span></div>
        </Fragment>
      ) : null}
    </div>
  );
}

/** #doc-menu, #card-menu and #move-menu: lists on their own, opened with placeMenu(). #doc-menu belongs to the
 *  editor's panel head (openDocMenu, docMenuAction in editor/sidebar.ts): its rows call actions.docMenuAction. */
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
      <CardMenu />
      <MoveMenu />
    </>
  );
}
