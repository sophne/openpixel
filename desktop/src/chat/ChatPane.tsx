/* PLACEHOLDER (kit): the chat panel, #chat-sec (index.html 86–115), mounted by the editor's left panel
   The static markup of app/web/index.html, as JSX, with no behaviour. The chat port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';
import { Icon } from '../lib/icons';

/** Chat with the person's own agents (Claude Code, Codex, Cursor, Gemini CLI) on their subscriptions: the agent
 *  works on this file through OpenPixel's tools. */
export function ChatPane(): ReactElement {
  return (
    <section className="sec grow pane" id="chat-sec" data-pane="chat" hidden>
      <div className="sec-head chat-head">
        <button type="button" className="chat-title" id="chat-history" aria-haspopup="menu" title="Agent chats on this file">
          <span className="ct-name" id="chat-title">Agent Chat</span>
          <Icon name="chevron-down" />
        </button>
        <span className="spacer"></span>
        <button type="button" className="btn small icon" id="chat-new" title="New chat">
          <Icon name="square-pen" />
        </button>
      </div>
      <div className="chat-body">
        <div className="chat-scroll" id="chat-scroll">
          <div id="chat-log" role="log" aria-live="polite" aria-label="Conversation"></div>
        </div>
        <button type="button" className="chat-jump" id="chat-jump" aria-label="Scroll to the latest message" tabIndex={-1}>
          <Icon name="arrow-down" />
        </button>
      </div>
      <form className="composer" id="chat-form" autoComplete="off">
        <div className="composer-box">
          <textarea id="chat-input" rows={1} spellCheck={true} aria-label="Message"></textarea>
          <button type="submit" className="chat-send" id="chat-send" aria-label="Send" disabled>
            <span className="cs-ic go">
              <Icon name="arrow-up" />
            </span>
            <span className="cs-ic stop out">
              <svg className="i" viewBox="0 0 24 24" width="16" height="16">
                <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"></rect>
              </svg>
            </span>
          </button>
        </div>
        <div className="skill-menu" id="chat-skills" role="listbox" aria-label="Skills" hidden></div>
        <div className="composer-bar">
          <button type="button" className="chat-slash" id="chat-slash" title="Skills (/)" aria-label="Skills" aria-haspopup="listbox">
            <span aria-hidden="true">/</span>
          </button>
          <div id="chat-model" className="chat-model"></div>
          <div id="chat-effort" className="chat-effort"></div>
        </div>
      </form>
    </section>
  );
}
