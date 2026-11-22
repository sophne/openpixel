/* The chat's two menus (index.html 310–312): the chats kept for the open file, and the agent + model picker. Both
   open from the chat panel and are placed at their buttons (kit/menus: placeMenu). The old code filled them each
   time they opened; openHistoryMenu() and openModelMenu() (chat.ts) now note what to show and these draw it. A new
   key per opening makes the rows new elements, as they were (the kit marks rows by hand: `kb`, a moved title). */
import { Fragment, type ReactElement } from 'react';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { connectAnotherAgent, deleteChatThread, openChatThread, pickChatModel, signInToAgent, startNewChat } from './chat';
import { MiniLogo, txt } from './ChatLog';
import { historyMenuView, modelMenuView } from './state';

function HistoryRows(): ReactElement | null {
  const v = useStore(historyMenuView), f = v.file;
  if (!f) return null; // never opened yet: the element is empty, as in the markup
  return (
    <Fragment key={v.key}>
      <div className="opt new" onClick={(e) => { e.stopPropagation(); startNewChat(); }}><span className="ck"><Icon name="square-pen" size={14} /></span><span className="ol">New chat</span></div><hr />
      {!v.rows.length ? <p className="ch-empty">No earlier chats on this file</p> : null}
      {v.rows.map((r, i) => (
        <div key={i} className={`opt${r.sel ? ' sel' : ''}${r.running ? ' running' : ''}`} onClick={(e) => { e.stopPropagation(); openChatThread(r.thread); }}>
          <span className="ck">{r.running ? <span className="px-load sm"><i></i><i></i><i></i><i></i></span> : <Icon name="check" size={14} />}</span>
          <span className="ol">{txt(r.title)}</span><span className="k">{r.when}</span>
          <button type="button" className="ch-del" aria-label="Delete chat" title="Delete chat" onClick={(e) => { e.stopPropagation(); deleteChatThread(f, r.thread); }}><Icon name="trash-2" size={13} /></button>
        </div>
      ))}
    </Fragment>
  );
}

function ModelRows(): ReactElement | null {
  const v = useStore(modelMenuView);
  if (!v.key) return null;
  return (
    <Fragment key={v.key}>
      {v.groups.map(({ provider: p, models }, g) => (
        <Fragment key={g}>
          <header><MiniLogo id={p.id} /><b>{txt(p.name)}</b><span className="plan">{txt(p.plan)}</span></header>
          {!p.ready ? (
            <div className="opt more" onClick={(e) => { e.stopPropagation(); signInToAgent(p); }}><span className="ck"><Icon name="external-link" size={14} /></span><span className="ol">{`Sign in to ${p.name}…`}</span></div>
          ) : models.map((m, i) => (
            <div key={i} className={m.sel ? 'opt sel' : 'opt'} role="menuitemradio" onClick={(e) => { e.stopPropagation(); pickChatModel(p, m.id); }}>
              <span className="ck"><Icon name="check" size={14} /></span><span className="ol">{txt(m.label)}</span>
            </div>
          ))}
        </Fragment>
      ))}
      <hr /><div className="opt more" onClick={(e) => { e.stopPropagation(); connectAnotherAgent(); }}><span className="ck"><Icon name="plug" size={14} /></span><span className="ol">Connect another agent…</span></div>
    </Fragment>
  );
}

/** The chats kept for the open file, and the agent + model picker (both open from the chat panel). */
export function ChatMenus(): ReactElement {
  return (
    <>
      <div className="menu-list dd-list card-menu chat-history-menu" id="chat-history-menu" role="menu"><HistoryRows /></div>
      <div className="menu-list dd-list card-menu chat-models" id="chat-model-menu" role="menu"><ModelRows /></div>
    </>
  );
}
