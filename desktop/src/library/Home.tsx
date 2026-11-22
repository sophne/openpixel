/* PLACEHOLDER (kit): the home screen, #home (index.html 229–272): Recents, All folders, Archive, Agents
   The static markup of app/web/index.html, as JSX, with no behaviour. The library port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute.
   The Agents list (#home-agents-wrap) is <AgentsList/> from library/Agents. */
import type { ReactElement } from 'react';
import { stopKeys } from '../lib/dom';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { ui } from '../state/ui';
import { AgentsList } from './Agents';

export function Home(): ReactElement {
  const { view } = useStore(ui); // the page shows while ui.view is 'home' (app/pages.ts)
  return (
    <div id="home" hidden={view !== 'home'}>
      <nav className="home-side" aria-label="Library">
        <label className="side-search">
          <Icon name="search" />
          <input id="home-search" placeholder="Search all files" spellCheck={false} autoComplete="off" aria-label="Search all files and folders" onKeyDown={stopKeys} />
          <kbd id="search-clear" hidden aria-hidden="true">esc</kbd>
        </label>
        <button type="button" className="home-nav on" data-home="recents" aria-current="page"><Icon name="clock" />Recents</button>
        <button type="button" className="home-nav" data-home="folders" data-drop=""><Icon name="folders" />All folders</button>
        <button type="button" className="home-nav" data-home="archive" data-drop-archive=""><Icon name="archive" />Archive</button>
        <button type="button" className="home-nav" data-home="agents"><Icon name="plug" />Agents</button>
        <span className="spacer"></span>
        <div className="side-links">
          <button type="button" className="side-link app-link" data-link="website" title="openpixel.dev" aria-label="OpenPixel website, openpixel.dev">
            <Icon name="file-2d" />
          </button>
          <button type="button" className="side-link" data-link="github" title="OpenPixel on GitHub" aria-label="OpenPixel on GitHub">
            <Icon name="github" />
          </button>
          <button type="button" className="side-link" data-link="x" title="OpenPixel on X" aria-label="OpenPixel on X">
            <Icon name="x-logo" />
          </button>
        </div>
      </nav>
      <div className="home-main" role="main">
        <div className="home-top">
          <div id="home-title" className="crumbs"></div>
          <span className="spacer"></span>
          <button type="button" className="btn outline haptic" id="home-new-folder">
            <Icon name="folder-plus" />
            <span className="lbl">New folder</span>
          </button>
          <button type="button" className="btn outline haptic danger" id="home-empty-archive">
            <Icon name="trash-2" />
            <span className="lbl">Delete all permanently</span>
          </button>
          <button type="button" className="btn outline haptic" id="home-open">
            <Icon name="folder-open" />
            <span className="lbl">Open file</span>
          </button>
          <button type="button" className="btn primary haptic" id="home-create">
            <Icon name="plus" />
            <span className="lbl">Create new</span>
          </button>
        </div>
        <div id="home-files-wrap">
          <div className="home-tools" role="toolbar" aria-label="Show and sort">
            <span className="muted" id="home-count"></span>
            <span className="spacer"></span>
            <div id="home-filter"></div>
            <div id="home-sort"></div>
            <div className="seg view-seg" role="radiogroup" aria-label="Layout">
              <button type="button" data-layout="grid" role="radio" aria-label="Grid" title="Grid">
                <Icon name="layout-grid" />
              </button>
              <button type="button" data-layout="list" role="radio" aria-label="List" title="List">
                <Icon name="list" />
              </button>
            </div>
          </div>
          <section id="home-folders-sec">
            <div className="home-h2">Folders</div>
            <div className="cards folders" id="home-folders"></div>
          </section>
          <section id="home-files-sec">
            <div className="home-h2" id="home-files-title">Files</div>
            <div className="cards" id="home-files"></div>
          </section>
        </div>
        <AgentsList />
      </div>
    </div>
  );
}
