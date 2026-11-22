/* The tab bar, #tabbar (index.html 11–19; what renderTabs() built, app.js 1678–1747). The logic is in ./tabs. */
import { useLayoutEffect, type DragEvent, type ReactElement } from 'react';
import { actions } from '../app/actions';
import { hideTip, inlineRename, RenameText } from '../kit';
import { $, $$, useEvent } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { Icon } from '../lib/icons';
import { tildePath } from '../lib/platform';
import { useStore } from '../lib/store';
import type { Tab } from '../state/ui';
import { showHome } from './homePage';
import { closeNewPage, openNewPage } from './newFile';
import './register';
import { closeTab, drawnTabs, reportTitlebar, switchTab, tabDragEnd, tabDragOver, tabDragStart, tabDrop, tabExtras } from './tabs';

/** One open file. */
function FileTab({ t, on }: { t: Tab; on: boolean }): ReactElement {
  const after = (e: DragEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientX > r.left + r.width / 2; };
  return (
    <div className={`tab file${on ? ' on' : ''}${t.dirty ? ' dirty' : ''}`} role="tab" tabIndex={0} aria-selected={on} data-tab={t.id}
      title={t.path ? tildePath(t.path) : undefined}
      onClick={() => { switchTab(t.id); }}
      onAuxClick={(e) => { if (e.button === 1) closeTab(t.id); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(t.id); }
        else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const next = e.key === 'ArrowRight' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling;
          if (next) (next as HTMLElement).focus();
        }
      }}
      // Tabs reorder by dragging.
      draggable
      onDragStart={(e) => { tabDragStart(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.name); e.currentTarget.classList.add('dragging'); hideTip(); }}
      onDragEnd={tabDragEnd}
      onDragOver={(e) => {
        if (!tabDragOver(t.id)) return;
        e.preventDefault();
        $$('.tab.drop-before, .tab.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
        e.currentTarget.classList.add(after(e) ? 'drop-after' : 'drop-before');
      }}
      onDrop={(e) => {
        if (!tabDragOver(t.id)) return;
        e.preventDefault();
        tabDrop(t.id, after(e));
      }}>
      <Icon name={t.kind === '3d' ? 'file-3d' : 'file-2d'} size={14} />
      <RenameText className="name" text={t.name} title="Double-click to rename"
        onDoubleClick={(e) => { e.stopPropagation(); inlineRename(e.currentTarget, t.name, (v) => actions.renameFile({ tab: t.id }, v)); }} />
      <button type="button" className="x" title="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><Icon name="x" size={12} /></button>
    </div>
  );
}

/** The New file page, while it is open. */
function NewTab({ on }: { on: boolean }): ReactElement {
  return (
    <div className={`tab new-tab${on ? ' on' : ''}`} role="tab" tabIndex={0} aria-selected={on}
      onClick={() => { openNewPage(); }}
      onAuxClick={(e) => { if (e.button === 1) closeNewPage(); }}>
      <Icon name="plus" size={14} />
      <span className="name">New file</span>
      <button type="button" className="x" title="Close tab (⌘W)" onClick={(e) => { e.stopPropagation(); closeNewPage(); }}><Icon name="x" size={12} /></button>
    </div>
  );
}

/** Open files as tabs, like Figma: in the window's title bar next to the close, minimise and zoom buttons, Home on
 *  the left, one tab per file, + opens the New file page. */
export function TabBar(): ReactElement {
  const d = useStore(drawnTabs);
  const x = useStore(tabExtras);
  // What renderTabs() did after drawing.
  useLayoutEffect(() => {
    if (!d.gen) return;
    const on = $('#tabs .tab.on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reportTitlebar();
  }, [d.gen]);
  useEvent(window, 'resize', reportTitlebar);
  const atHome = d.view === 'home';
  return (
    <nav id="tabbar" aria-label="Open files">
      <button type="button" className={atHome ? 'tb-home on' : 'tb-home'} id="tab-home" title="Home" aria-pressed={d.gen ? atHome : undefined}
        onClick={() => { showHome(); }}>
        <Icon name="house" />
      </button>
      <div id="tabs" role="tablist" aria-label="Open files">
        {d.tabs.map((t) => <FileTab key={`${d.gen}:${t.id}`} t={t} on={d.view === 'editor' && t.id === d.active} />)}
        {d.newOpen ? <NewTab key={`${d.gen}:new`} on={d.view === 'new'} /> : null}
      </div>
      <button type="button" className="tb-add" id="tab-add" title="New file (⌘N)" onClick={() => { openNewPage(); }}>
        <Icon name="plus" />
      </button>
      <button type="button" className="tb-update" id="tab-update" aria-label={x.updateSay} data-tip={x.updateSay} hidden={!x.update}
        onClick={() => { nativeAction('checkUpdates'); }}>
        <Icon name="download" />
        <span className="tb-dot" aria-hidden="true"></span>
      </button>
      <button type="button" className="tb-stars" id="tab-stars" title="OpenPixel on GitHub"
        onClick={() => { nativeAction('openLink', { link: 'github' }); }}>
        <Icon name="github" />
        {/* showStars() writes the count and the tooltip */}
        <span id="stars-count">Star</span>
      </button>
    </nav>
  );
}
