/* PLACEHOLDER (kit): the tab bar, #tabbar (index.html 11–19; renderTabs, reportTitlebar, showStars, showUpdate in app.js)
   The static markup of app/web/index.html, as JSX, with no behaviour. The library port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute. */
import type { ReactElement } from 'react';
import { Icon } from '../lib/icons';

/** Open files as tabs, like Figma: in the window's title bar next to the close, minimise and zoom buttons, Home on
 *  the left, one tab per file, + opens the New file page. */
export function TabBar(): ReactElement {
  return (
    <nav id="tabbar" aria-label="Open files">
      <button type="button" className="tb-home" id="tab-home" title="Home">
        <Icon name="house" />
      </button>
      <div id="tabs" role="tablist" aria-label="Open files"></div>
      <button type="button" className="tb-add" id="tab-add" title="New file (⌘N)">
        <Icon name="plus" />
      </button>
      <button type="button" className="tb-update" id="tab-update" aria-label="Update OpenPixel" data-tip="Update OpenPixel" hidden>
        <Icon name="download" />
        <span className="tb-dot" aria-hidden="true"></span>
      </button>
      <button type="button" className="tb-stars" id="tab-stars" title="OpenPixel on GitHub">
        <Icon name="github" />
        <span id="stars-count">Star</span>
      </button>
    </nav>
  );
}
