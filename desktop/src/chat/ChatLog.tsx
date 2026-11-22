/* The conversation: the empty state, the messages, their parts (text, thinking, tool rows) and
   what sits under a reply. These components draw what chat.ts put in the stores of state.ts and nothing else: the
   elements, classes and text are the ones appendChatMessage(), appendChatPart(), addToolRow() and renderChatFoot()
   built by hand, in the same order.
   Everything an agent or a saved chat supplies is drawn as text (see markdown.tsx for replies). */
import { memo, useLayoutEffect, useRef, type ReactElement } from 'react';
import { CopyButton } from '../kit';
import { agentLogoSvg, Icon, icon, TrustedSvg } from '../lib/icons';
import { useStore } from '../lib/store';
import {
  agentFor, chatScrollGrow, foldTools, lookForAgentsAgain, prettyTool, showAgentsPage, toggleThink, toggleToolRow, toolSummary,
} from './chat';
import { Markdown } from './markdown';
import { Reveal } from './reveal';
import {
  logView,
  type AssistantView, type EmptyView, type FootView, type PartView, type TextView, type ThinkView, type ToolRowView,
  type ToolsView, type UserView,
} from './state';

/** What `el.textContent = value` showed for a value that came from outside the page (a saved chat, the app, an
 *  agent): its text, and nothing for null. */
export const txt = (v: unknown): string => (v == null ? '' : String(v));

/** An agent's mark at the size of a line of text (the old miniLogo): from the bundled table, by the agent's id. */
export function MiniLogo({ id, big = false }: { id: string; big?: boolean }): ReactElement {
  const a = agentFor(id === 'claude-code' ? 'claude' : id); // the chat's "Claude" runs Claude Code: shown with Claude's mark
  return <TrustedSvg className={`alogo ${big ? 'big' : 'mini'}${a.mono ? ' mono' : ''}`} aria-hidden="true" html={agentLogoSvg(a.logo, icon('plug', 12))} />;
}
const PxLoad = ({ className }: { className: string }): ReactElement => <span className={className}><i></i><i></i><i></i><i></i></span>;

function ChatEmpty({ e }: { e: EmptyView }): ReactElement {
  if (e.kind === 'loading') {
    return <div className="chat-empty"><PxLoad className="px-load lg" /><p className="ce-sub">Looking for your agents…</p></div>;
  }
  if (e.kind === 'none') {
    return (
      <div className="chat-empty">
        <span className="pxa pxa-agents" aria-hidden="true"></span><p className="ce-title">No agent to chat with yet</p>
        <p className="ce-sub">{`${e.waiting != null ? `Add OpenPixel to ${e.waiting}, or install` : 'Install'} Claude Code, Codex, Cursor or Gemini CLI and sign in. Chat runs them on your own subscription.`}</p>
        <div className="ce-actions">
          <button type="button" className="btn small outline" data-ce="agents" onClick={() => showAgentsPage()}><Icon name="plug" size={14} /><span className="lbl">Agents</span></button>
          <button type="button" className="btn small" data-ce="retry" onClick={() => { lookForAgentsAgain(); }}><Icon name="history" size={14} /><span className="lbl">Look again</span></button>
        </div>
      </div>
    );
  }
  return (
    <div className="chat-empty">
      <MiniLogo id={e.id} big /><p className="ce-title">{`Chat with ${e.name}`}</p>
      <p className="ce-sub">{`Uses your ${e.plan}. It works on this file with OpenPixel's tools, and you can undo every change. Type / for its skills.`}</p>
    </div>
  );
}

const UserBubble = memo(function UserBubble({ v }: { v: UserView }): ReactElement {
  const msg = v.msg;
  return (
    <div className={v.enter ? 'cm user enter' : 'cm user'}>
      {msg.skill ? <><span className="cm-skill">{`/${msg.skill}`}</span>{msg.args ? ` ${msg.args}` : null}</> : txt(msg.text)}
    </div>
  );
});

/** Text of a reply that was finished when it was drawn: Markdown, as elements. */
function StaticText({ v }: { v: TextView }): ReactElement {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { v.el = el.current; }, [v]);
  return <div ref={el} className="cm-text md"><Markdown src={txt(v.part.text)} /></div>;
}
/** Text of a reply that is streaming in: the element is the Reveal's (reveal.ts). React draws it empty and leaves
 *  what is inside alone. */
function StreamedText({ v }: { v: TextView }): ReactElement {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const reveal = new Reveal(el.current as HTMLDivElement, chatScrollGrow);
    v.el = el.current; v.reveal = reveal;
    // What was already said shows at once; only what streams in from here fades in.
    reveal.marks = null; reveal.push(txt(v.part.text)); reveal.finish(); reveal.marks = [];
  }, [v]);
  return <div ref={el} className="cm-text md"></div>;
}

function Think({ v }: { v: ThinkView }): ReactElement {
  useStore(v);
  const el = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    v.el = el.current; v.box = box.current;
    if (v.live && box.current) box.current.scrollTop = 1e9;
  }, [v]);
  const part = v.part, live = part.ms == null; // setThinkLabel
  return (
    <div ref={el} className={`cm-think${v.live ? ' live' : ''}${v.open ? ' open' : ''}`}>
      <button type="button" className="ct-head" aria-expanded={v.open} onClick={() => toggleThink(v)}>
        <span className={live ? 'ct-label shimmer' : 'ct-label'}>{live ? 'Thinking' : `Thought for ${Math.max(1, Math.round((part.ms as number) / 1000))}s`}</span>
        <Icon name="chevron-down" size={12} className="chev" />
      </button>
      <div className="ct-body"><div className="ct-inner"><div className="ct-text" ref={box}><span>{txt(part.text)}</span></div></div></div>
    </div>
  );
}

function ToolRow({ v, row }: { v: ToolsView; row: ToolRowView }): ReactElement {
  const call = row.call, name = prettyTool(call.name);
  return (
    <div className={row.cls.join(' ')} hidden={row.hidden}>
      <button type="button" className="ctl-head" aria-expanded={row.cls.includes('open')}
        aria-label={`${name}: ${call.done ? (call.ok ? 'done' : 'failed') : 'running'}`} onClick={() => toggleToolRow(v, row)}>
        <span className="ctl-ic" aria-hidden="true"><PxLoad className="s-run px-load sm" /><span className="s-ok"><Icon name="check" size={13} /></span><span className="s-bad"><Icon name="x" size={13} /></span></span>
        <span className="ctl-name">{name}</span><span className="ctl-arg mono">{toolSummary(call.input)}</span><Icon name="chevron-down" size={12} className="chev" />
      </button>
      <div className="ctl-detail"><div className="ctl-inner">
        <pre className="ctl-in">{call.input == null ? '' : typeof call.input === 'string' ? call.input : txt(JSON.stringify(call.input, null, 2))}</pre>
        <pre className="ctl-out">{txt(call.out) || (call.done ? '' : 'Running…')}</pre>
      </div></div>
    </div>
  );
}
function Tools({ v }: { v: ToolsView }): ReactElement {
  useStore(v);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { v.el = el.current; }, [v]);
  return (
    <div ref={el} className="cm-tools">
      <button type="button" className={v.moreOpen ? 'ctl-more open' : 'ctl-more'} hidden={v.moreHidden}
        onClick={() => { v.expanded = !v.expanded; foldTools(v.part, v); }}><Icon name="chevron-right" size={12} /><span>{v.moreText}</span></button>
      {v.list.map((row) => <ToolRow key={row.key} v={v} row={row} />)}
    </div>
  );
}
const Part = memo(function Part({ v }: { v: PartView }): ReactElement {
  if (v.kind === 'text') return v.live ? <StreamedText v={v} /> : <StaticText v={v} />;
  return v.kind === 'think' ? <Think v={v} /> : <Tools v={v} />;
});

/** Under a finished reply: what went wrong, "Stopped", and Copy with the model that answered. */
function Foot({ f }: { f: FootView }): ReactElement {
  return (
    <>
      {f.error ? <div className="cm-error"><Icon name="info" size={14} /><span>{f.error}</span></div> : null}
      {f.stopped ? <div className="cm-note">Stopped</div> : null}
      {f.text ? (
        <div className="cm-actions">
          <CopyButton className="btn small" text={f.text} />
          {f.model ? <span className="cm-model"><MiniLogo id={f.provider} /><span>{f.model}</span></span> : null}
        </div>
      ) : null}
    </>
  );
}
const AssistantReply = memo(function AssistantReply({ v }: { v: AssistantView }): ReactElement {
  useStore(v);
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { v.el = el.current; }, [v]);
  return (
    <div ref={el} className={v.enter ? 'cm assistant enter' : 'cm assistant'}>
      <div className="cm-parts">{v.parts.map((p) => <Part key={p.key} v={p} />)}</div>
      <div className="cm-status" hidden={v.statusHidden}><PxLoad className="px-load" /><span className="shimmer">{v.statusText}</span><span className="cm-sec">{v.sec}</span></div>
      <div className="cm-foot">{v.foot ? <Foot key={v.foot.key} f={v.foot} /> : null}</div>
    </div>
  );
});

/** #chat-log: the empty state, or the messages of the chat being shown. */
export function ChatLog(): ReactElement {
  const v = useStore(logView);
  return (
    <div id="chat-log" role="log" aria-live="polite" aria-label="Conversation">
      {v.empty ? <ChatEmpty key={v.empty.key} e={v.empty} /> : null}
      {v.items.map((it) => (it.role === 'user' ? <UserBubble key={it.key} v={it} /> : <AssistantReply key={it.key} v={it} />))}
    </div>
  );
}
/** The text of #chat-title: the chat's title, or "Agent Chat" for a new one. */
export function ChatTitle(): ReactElement {
  const v = useStore(logView);
  return <>{txt(v.title)}</>;
}
