/* The chat panel, #chat-sec (index.html 86–115), mounted by the editor's left panel: the title with the file's
   chats, the conversation, and the message box with the "/" skills list, the agent + model button and the effort
   dropdown under it. The markup is the old page's, node for node; what wireChat() (app.js 4168–4216) attached is
   the handlers and effects here, and everything they call is in chat.ts under its old name.
   Chat with the person's own agents (Claude Code, Codex, Cursor, Gemini CLI) on their subscriptions: the agent works
   on this file through OpenPixel's tools. The message box grows with its text, then scrolls; send sits inside it. */
import { useLayoutEffect, useRef, type KeyboardEvent, type ReactElement } from 'react';
import { Dropdown } from '../kit';
import { $, useEvent } from '../lib/dom';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { leftSide } from '../state/ui';
import {
  chatScrollGrow, closeSkillMenu, jumpToLatest, markSkill, openHistoryMenu, openModelMenu, pickSkill, sendChat, sizeChatInput,
  startNewChat, stopChat, updateChatJump, updateChatSend, updateSkillMenu,
} from './chat';
import { ChatLog, ChatTitle, MiniLogo, txt } from './ChatLog';
import { chatState, pickersView, sendView, skillView } from './state';

const input = (): HTMLTextAreaElement => $<HTMLTextAreaElement>('#chat-input');
const sending = (): boolean => $('#chat-send').classList.contains('busy');

function onInputKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
  e.stopPropagation(); // typing never reaches the editor's shortcuts
  const sm = chatState.skillMenu, composing = e.nativeEvent.isComposing;
  if (sm.open && !composing) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (sm.items.length) { sm.index = (sm.index + (e.key === 'ArrowDown' ? 1 : -1) + sm.items.length) % sm.items.length; markSkill(); }
      return;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      if (sm.items[sm.index]) { e.preventDefault(); pickSkill(sm.items[sm.index]); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); closeSkillMenu(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !composing && e.keyCode !== 229) { e.preventDefault(); if (!sending()) sendChat(e.currentTarget.value); }
  else if (e.key === 'Escape') { e.preventDefault(); if (sending()) stopChat(); else e.currentTarget.blur(); }
}
/** The "/" button: opens the skills list (a typed message gives way to picking a skill), or closes it. */
function onSlash(): void {
  const ta = input();
  if (chatState.skillMenu.open) { closeSkillMenu(); ta.focus(); return; }
  if (!ta.value.startsWith('/')) ta.value = '/' + ta.value.replace(/^\s+/, '');
  if (/\s/.test(ta.value)) ta.value = '/'; // a typed message gives way to picking a skill
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  sizeChatInput(); updateChatSend(); updateSkillMenu();
}

/** #chat-input. Its text is the element's own (the old code read and wrote .value); only its name follows the agent. */
function MessageBox(): ReactElement {
  const pk = useStore(pickersView);
  const ta = useRef<HTMLTextAreaElement>(null);
  // The element's own `input` event, as before: scripts that type into the box dispatch it on the element.
  useEvent(ta, 'input', () => { sizeChatInput(); updateChatSend(); updateSkillMenu(); });
  return (
    <textarea ref={ta} id="chat-input" rows={1} spellCheck={true} aria-label={pk.id ? `Message ${pk.name}` : 'Message'} // no placeholder: the box stays clean
      onKeyDown={onInputKeyDown}
      onBlur={() => { setTimeout(() => { if (document.activeElement !== input()) closeSkillMenu(); }, 120); }}></textarea>
  );
}
/** #chat-send: an arrow to send, a square to stop while the agent replies (updateChatSend). */
function SendButton(): ReactElement {
  const s = useStore(sendView);
  return (
    <button type="submit" className={s.busy ? 'chat-send busy' : 'chat-send'} id="chat-send" aria-label={s.busy ? 'Stop' : 'Send'} disabled={s.disabled}
      data-tip={s.drawn ? (s.busy ? 'Stop (Esc)' : 'Send (↩)') : undefined}>
      <span className={s.busy ? 'cs-ic go out' : 'cs-ic go'}>
        <Icon name="arrow-up" />
      </span>
      <span className={s.busy ? 'cs-ic stop' : 'cs-ic stop out'}>
        <svg className="i" viewBox="0 0 24 24" width="16" height="16">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"></rect>
        </svg>
      </span>
    </button>
  );
}
/** #chat-skills: the chosen agent's skills above the message box (updateSkillMenu). */
function SkillMenu(): ReactElement {
  const v = useStore(skillView);
  return (
    <div className="skill-menu" id="chat-skills" role="listbox" aria-label="Skills" hidden={v.hidden}>
      {v.note != null ? <p key={`note ${v.key}`} className="sk-note">{v.note}</p> : null}
      {v.items.map((k, i) => (
        <div key={`${v.key} ${i}`} className={i === v.index ? 'sk-item kb' : 'sk-item'} role="option" aria-selected={i === v.index} title={`/${k.name}`}
          onMouseDown={(e) => { e.preventDefault(); pickSkill(k); }}
          onMouseMove={() => { const sm = chatState.skillMenu; if (sm.index !== i) { sm.index = i; markSkill(); } }}>
          {/* the plugin shows on the right */}
          <span className="sk-name"><b>/</b><span>{txt(String(k.name).split(':').pop())}</span></span>
          <span className="sk-src">{k.source === 'Personal' ? (k.command ? 'Command' : '') : txt(k.source)}</span>
          <span className="sk-desc">{txt(k.description || '')}</span>
        </div>
      ))}
    </div>
  );
}
/** #chat-model and #chat-effort (renderChatPickers). Until the first call the button reads "Agent", disabled. */
function Pickers(): ReactElement {
  const pk = useStore(pickersView), e = pk.effort;
  return (
    <>
      <div id="chat-model" className="chat-model dropdown">
        <button type="button" className="dd-btn" aria-haspopup="menu" disabled={!pk.id}
          data-tip={!pk.drawn ? undefined : pk.id ? `${pk.name} · ${pk.label} (${pk.plan})` : 'No agent found'}
          aria-label={!pk.drawn ? undefined : pk.id ? `Agent and model: ${pk.name}, ${pk.label}` : 'Agent and model'}
          onClick={(ev) => { ev.stopPropagation(); openModelMenu(); }}>
          <span className="cm-logo">{pk.id ? <MiniLogo id={pk.id} /> : null}</span><span className="v">{!pk.drawn ? 'Agent' : pk.id ? txt(pk.label) : 'No agent'}</span><Icon name="chevron-down" size={14} />
        </button>
      </div>
      {/* The old code built the dropdown anew on every call: a new key does the same (an opened list's place and marks go). */}
      {e ? (
        <Dropdown key={e.key} id="chat-effort" className="chat-effort" hidden={pk.effortHidden} options={e.options} value={e.value} onChange={e.onChange}
          button={{ 'data-tip': 'Effort', 'aria-label': `Effort: ${e.label}` }}
          before={<span className="eff-bars" data-level={e.level} aria-hidden="true"><i></i><i></i><i></i></span>}
          ref={(api) => { chatState.effortMenu = api; }} />
      ) : <div id="chat-effort" className="chat-effort" hidden={pk.effortHidden}></div>}
    </>
  );
}

export function ChatPane(): ReactElement {
  // The rail picks the pane; the editor's applyLeftSide() says so through leftSide.
  const side = useStore(leftSide);
  const scroll = useRef<HTMLDivElement>(null);
  useEvent(scroll, 'scroll', updateChatJump, { passive: true });
  useLayoutEffect(() => {
    const log = new ResizeObserver(() => { chatScrollGrow(); updateChatJump(); });
    log.observe($('#chat-log'));
    const sec = new ResizeObserver(() => { if (leftSide.pane === 'chat') sizeChatInput(); });
    sec.observe($('#chat-sec'));
    return () => { log.disconnect(); sec.disconnect(); };
  }, []);
  return (
    <section className="sec grow pane" id="chat-sec" data-pane="chat" hidden={side.pane !== 'chat'}>
      <div className="sec-head chat-head">
        <button type="button" className="chat-title" id="chat-history" aria-haspopup="menu" title="Agent chats on this file"
          onClick={(e) => { e.stopPropagation(); openHistoryMenu(); }}>
          <span className="ct-name" id="chat-title"><ChatTitle /></span>
          <Icon name="chevron-down" />
        </button>
        <span className="spacer"></span>
        <button type="button" className="btn small icon" id="chat-new" title="New chat" onClick={() => startNewChat()}>
          <Icon name="square-pen" />
        </button>
      </div>
      <div className="chat-body">
        <div className="chat-scroll" id="chat-scroll" ref={scroll}>
          <ChatLog />
        </div>
        <button type="button" className="chat-jump" id="chat-jump" aria-label="Scroll to the latest message" tabIndex={-1} onClick={jumpToLatest}>
          <Icon name="arrow-down" />
        </button>
      </div>
      <form className="composer" id="chat-form" autoComplete="off"
        onSubmit={(e) => { e.preventDefault(); if (sending()) stopChat(); else sendChat(input().value); }}>
        <div className="composer-box" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); input().focus(); } }}>
          <MessageBox />
          <SendButton />
        </div>
        <SkillMenu />
        <div className="composer-bar">
          <button type="button" className="chat-slash" id="chat-slash" title="Skills (/)" aria-label="Skills" aria-haspopup="listbox" onClick={onSlash}>
            <span aria-hidden="true">/</span>
          </button>
          <Pickers />
        </div>
      </form>
    </section>
  );
}
