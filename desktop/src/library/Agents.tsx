/* The Agents page's list, #home-agents-wrap, and the two agent dialogs, #agent-dialog and #agent-info
   (a row per agent with its status, and one agent's set-up guide). The logic is in ./agents. */
import { Fragment, memo, useLayoutEffect, useRef, type ReactElement } from 'react';
import { CopyButton, Modal } from '../kit';
import { nativeAction } from '../lib/host';
import { agentLogoSvg, Icon, icon, TrustedSvg } from '../lib/icons';
import { useStore } from '../lib/store';
import type { AgentInfo } from '../state/agents';
import { AGENT_PROMPT_CAVEAT, agentInfo, agentRows, showAgentInfo, type AgentRowData, type AgentStatus } from './agents';
import { homeTop } from './home';

// Logos: @lobehub/icons-static-svg (MIT), see lib/AGENT-LOGOS-ATTRIBUTION.txt. Single-colour ones follow the text colour.
function AgentLogo({ a, big = false, id }: { a: AgentInfo; big?: boolean; id?: string }): ReactElement {
  return <TrustedSvg as="div" className={`alogo${big ? ' big' : ''}${a.mono ? ' mono' : ''}`} title={a.name} id={id} html={agentLogoSvg(a.logo, icon('plug', 18))} />;
}

/** The status badge. What the agent last did is its tooltip and part of its name. */
function Pill({ st }: { st: AgentStatus }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const activity = st.act.trim();
  // Written after every reading of the statuses, as before (the tooltip takes the title away on hover).
  useLayoutEffect(() => {
    const pill = ref.current;
    if (!pill) return;
    if (activity) pill.title = activity; else pill.removeAttribute('title');
  });
  return <span ref={ref} className={`pill ${st.cls}`} data-activity={activity} aria-label={activity ? `${st.label}: ${activity}` : undefined}>{st.label}</span>;
}

/** A row of the files list's kind: logo and name, the status (what the agent last did is its tooltip), and
 *  How to connect (the row's one action, so the keyboard reaches everything a pointer can). */
function AgentRow({ row }: { row: AgentRowData }): ReactElement {
  const { a, st } = row;
  return (
    <div className="fl-row agent-row" role="row" data-agent={a.id} data-key={row.key}>
      <span className="c-name" role="cell">
        {a.logo ? <AgentLogo a={a} /> : <div className="alogo"><Icon name="plug" size={16} /></div>}
        <span className="aname">{a.name}</span>
      </span>
      <span className="c-status" role="cell"><Pill st={st} /></span>
      <span className="c-info" role="cell">
        {a.id === 'other' ? null : (
          <button type="button" className="btn small outline info-btn" title={`How to connect ${a.name}`} onClick={() => showAgentInfo(a)}>
            <Icon name="info" size={14} /><span className="lbl">How to connect</span>
          </button>
        )}
      </span>
    </div>
  );
}

/** The list on Home ▸ Agents. Mounted by library/Home. */
export const AgentsList = memo(function AgentsList(): ReactElement {
  const { agentsView } = useStore(homeTop);
  const { rows } = useStore(agentRows);
  return (
    <div id="home-agents-wrap" hidden={!agentsView}>
      <div className="file-list agent-list" role="table" aria-label="Agents">
        <div className="fl-row fl-head agent-row" role="row">
          <span className="fl-col static" role="columnheader">Agent</span>
          <span className="fl-col static" role="columnheader">Status</span>
          <span role="columnheader"></span>
        </div>
        <div id="agents-body" role="rowgroup">
          {rows.map((r) => <AgentRow key={r.key} row={r} />)}
        </div>
      </div>
    </div>
  );
});

/** A step's command, with its Copy button. */
function CodeBox({ code }: { code: string }): ReactElement {
  return <div className="codebox"><pre className="code">{code}</pre><CopyButton type={undefined} className="btn small copy" text={code} /></div>;
}

/** One agent's set-up guide: what showAgentInfo() put into #agent-info (empty until it first opens). Each opening
 *  draws the guide anew, so no Copy button is left saying "Copied". */
function AgentGuide(): ReactElement {
  const { seq, a, st, prompt, steps, exe, setup } = useStore(agentInfo);
  const them = a && !a.generic ? a.name : 'the app';
  return (
    <Modal id="agent-info" labelledBy="ai-title">
      <header>
        {!a ? <div className="alogo big" id="ai-logo"></div>
          : a.logo ? <AgentLogo key={seq} a={a} big id="ai-logo" />
            : <div key={seq} className="alogo big" id="ai-logo"><Icon name="plug" size={22} /></div>}
        <div>
          <div id="ai-title">{a ? `Connect ${a.name}` : null}</div>
          <div className="sub" id="ai-sub">{a ? a.by : null}</div>
        </div>
        <span className="spacer"></span>
        <span id="ai-status">{st ? <span key={seq} className={`pill ${st.cls}`}>{st.label}</span> : null}</span>
      </header>
      <div className="content" id="ai-body">
        {a ? (
          <Fragment key={seq}>
            {prompt ? (
              // Laid out like a step: the spark sits where the numbers do, so its text and code line up with the steps below.
              <section className="setup-prompt">
                <span className="sp-mark"><Icon name="plug" size={14} /></span>
                <div>
                  <div className="sp-head">{`Let ${them} set it up`}</div>
                  <div className="sp-text">{`Paste this into a chat with ${them}. It adds OpenPixel to its own settings.` + (AGENT_PROMPT_CAVEAT[a.id] ? ` ${AGENT_PROMPT_CAVEAT[a.id]}` : '')}</div>
                  <CodeBox code={prompt} />
                </div>
              </section>
            ) : null}
            {prompt ? <div className="sp-or">Or set it up yourself</div> : null}
            <ol className="steps">
              {steps.map((step, i) => (step.note
                ? <li key={i} style={{ listStyle: 'none' }}><div className="note">{step.note}</div></li>
                : <li key={i}>{step.text}{step.code ? <CodeBox code={step.code} /> : null}</li>))}
            </ol>
            <p className="muted">Then ask, for example: “Use OpenPixel to draw a 32×32 treasure chest sprite, review it and fix what looks off.”</p>
          </Fragment>
        ) : null}
      </div>
      <footer>
        <span id="ai-extra" style={{ display: 'flex', gap: '8px' }}>
          {a && a.id === 'cursor' ? (
            <button key={`cursor${seq}`} className="btn outline" onClick={() => {
              const cfg = btoa(JSON.stringify({ command: exe, args: ['--mcp'] }));
              nativeAction('openURL', { url: `cursor://anysphere.cursor-deeplink/mcp/install?name=openpixel&config=${encodeURIComponent(cfg)}` });
            }}><Icon name="external-link" size={14} />Add to Cursor</button>
          ) : null}
          {setup && setup.config_exists ? (
            <button key={`file${seq}`} className="btn outline" onClick={() => { nativeAction('revealConfig', { path: setup.config_file }); }}><Icon name="folder-open" size={14} />Show settings file</button>
          ) : null}
        </span>
        <span className="spacer"></span>
        <button className="btn primary" data-close="">Done</button>
      </footer>
    </Modal>
  );
}

/** "Connect an AI agent" and one agent's setup guide. */
export function AgentDialogs(): ReactElement {
  return (
    <>
      <Modal id="agent-dialog" labelledBy="agent-dialog-title" width={640}>
        <header id="agent-dialog-title">Connect an AI agent</header>
        <div className="content">
          <p>OpenPixel has a built-in MCP server. Add it to your agent (Claude Code, Claude Desktop, Cursor, …) and it can draw, review and refine sprites and models. While this window is open, the agent's edits appear here live and you can undo them.</p>
          <p className="muted">Claude Code:</p>
          <pre className="code" id="agent-cli"></pre>
          <p className="muted">Or in an{' '}<span className="mono">mcpServers</span>{' '}config file:</p>
          <pre className="code" id="agent-json"></pre>
          <p className="muted">Then ask, for example: “Use OpenPixel to draw a 32×32 treasure chest sprite, review it and fix what looks off.”</p>
        </div>
        <footer>
          <button className="btn outline" id="agent-copy"><Icon name="copy" />Copy config</button>
          <button className="btn primary" data-close="">Done</button>
        </footer>
      </Modal>
      <AgentGuide />
    </>
  );
}
