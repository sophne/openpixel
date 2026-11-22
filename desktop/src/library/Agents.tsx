/* PLACEHOLDER (kit): the Agents page's list, #home-agents-wrap, and the two agent dialogs, #agent-dialog and #agent-info (index.html 265–270, 368–389)
   The static markup of app/web/index.html, as JSX, with no behaviour. The library port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';
import { Modal } from '../kit';
import { Icon } from '../lib/icons';

/** The list on Home ▸ Agents. Mounted by library/Home. */
export function AgentsList(): ReactElement {
  return (
    <div id="home-agents-wrap" hidden>
      <div className="file-list agent-list" role="table" aria-label="Agents">
        <div className="fl-row fl-head agent-row" role="row">
          <span className="fl-col static" role="columnheader">Agent</span>
          <span className="fl-col static" role="columnheader">Status</span>
          <span role="columnheader"></span>
        </div>
        <div id="agents-body" role="rowgroup"></div>
      </div>
    </div>
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
      <Modal id="agent-info" labelledBy="ai-title">
        <header>
          <div className="alogo big" id="ai-logo"></div>
          <div>
            <div id="ai-title"></div>
            <div className="sub" id="ai-sub"></div>
          </div>
          <span className="spacer"></span>
          <span id="ai-status"></span>
        </header>
        <div className="content" id="ai-body"></div>
        <footer>
          <span id="ai-extra" style={{ display: 'flex', gap: '8px' }}></span>
          <span className="spacer"></span>
          <button className="btn primary" data-close="">Done</button>
        </footer>
      </Modal>
    </>
  );
}
