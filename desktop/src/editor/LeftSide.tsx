/* The editor's left side, like Figma's: a rail (the app menu, then Layers, Agent Chat and Activity) and the panel the
   active one fills (index.html 54–120; app.js 340–415 renderLayers, 514–530 renameLayer, 620–640 the activity list,
   683–687 the file's name, and the left side's lines of wire()). The panel starts with the file's name and where it
   lives, and hides with the collapse button (⌘\). */
import { useLayoutEffect, useRef, type DragEvent, type KeyboardEvent, type ReactElement, type RefObject } from 'react';
import { actions } from '../app/actions';
import { ChatPane } from '../chat/ChatPane';
import { closeMenus, hideTip, onMenuButton, pressableProps, RenameText } from '../kit';
import { nativeAction } from '../lib/host';
import { Icon } from '../lib/icons';
import { shortcutLabel } from '../lib/platform';
import { useStore } from '../lib/store';
import { S, type Layer } from '../state/ui';
import { activityView, docView, layersView, leftView, live, panelsView, tool } from './core';
import { clearLayerDrop, layerDropTarget, moveLayer, renderLayers, setActive } from './engine';
import { openDocMenu, renameDoc, setLeftOpen, showLeftPane } from './sidebar';

/* ---------------------------------------------------------------- the rail */
const mainMenu = (action: string) => (): void => { closeMenus(); if (action === 'new') actions.openNewPage(); else nativeAction(action); };

function RailButton({ pane, label, icon, children }: { pane: 'layers' | 'chat' | 'activity'; label: string; icon: string; children?: ReactElement }): ReactElement {
  const v = useStore(leftView);
  const on = v.open && v.pane === pane;
  // The name shows on hover (no label under the icon): data-tip is the aria-label.
  return (
    <button type="button" className={v.drawn && on ? 'rail-btn on' : 'rail-btn'} data-pane={pane} aria-controls="left" aria-label={label} data-tip={label}
      aria-pressed={v.drawn ? on : undefined} onClick={() => showLeftPane(pane)}>
      <span className="ri">
        <Icon name={icon} />
        {children}
      </span>
    </button>
  );
}
function ActivityDot(): ReactElement {
  const { dot } = useStore(activityView);
  return <span className="rail-dot" id="activity-dot" hidden={!dot}></span>;
}

export function Rail(): ReactElement {
  return (
    <nav id="rail" aria-label="Editor sidebar">
      <div className="menu" id="file-menu">
        <button type="button" className="rail-app" data-menu="file-menu" title="Main menu" aria-label="Main menu" aria-haspopup="menu" onClick={onMenuButton}>
          <Icon name="file-2d" />
        </button>
        <div className="menu-list" role="menu">
          <div data-action="new" onClick={mainMenu('new')}><Icon name="file-plus" />New…<span className="k">{shortcutLabel('⌘N')}</span></div>
          <div data-action="open" onClick={mainMenu('open')}><Icon name="folder-open" />Open…<span className="k">{shortcutLabel('⌘O')}</span></div>
          <div data-action="save" onClick={mainMenu('save')}><Icon name="save" />Save<span className="k">{shortcutLabel('⌘S')}</span></div>
          <div data-action="saveAs" onClick={mainMenu('saveAs')}><Icon name="save" />Save As…<span className="k">{shortcutLabel('⇧⌘S')}</span></div>
          <hr />
          <div data-action="checkUpdates" onClick={mainMenu('checkUpdates')}><Icon name="download" />Check for updates…</div>
        </div>
      </div>
      <hr className="rail-sep" aria-hidden="true" />
      <RailButton pane="layers" label="Layers" icon="layers" />
      {/* #chat-dot is shown by the chat area (it sets .hidden by id) and hidden again by applyLeftSide(): nothing here
          ever changes it. */}
      <RailButton pane="chat" label="Agent Chat" icon="sparkle"><span className="rail-dot" id="chat-dot" hidden></span></RailButton>
      <RailButton pane="activity" label="Activity" icon="history"><ActivityDot /></RailButton>
    </nav>
  );
}

/* ---------------------------------------------------------------- the panel's head: the file's name and its menu */
function DocName(): ReactElement {
  const { name } = useStore(docView);
  return <RenameText as="span" className="doc-name" id="doc-name" title="Double-click to rename" text={name}
    onDoubleClick={(e) => { e.preventDefault(); renameDoc(); }} />;
}
function CollapseButton(): ReactElement {
  const v = useStore(leftView);
  return (
    <button type="button" className="btn small icon" id="left-collapse" title="Hide sidebar (⌘\)" aria-label="Hide sidebar" aria-expanded={v.open} aria-controls="left"
      onClick={() => setLeftOpen(false)}>
      <Icon name="panel-left" />
    </button>
  );
}

/* ---------------------------------------------------------------- layers */
/** The layer buttons say which layer they act on: the title and the name are written on every renderLayers(), as
 *  before (the title in the markup is the one the page starts with). */
function useLayerTitle(text: string | null): RefObject<HTMLButtonElement | null> {
  const ref = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    const b = ref.current;
    if (!b || text == null) return;
    b.title = text;
    b.setAttribute('aria-label', b.title.replace(/ \(.*\)$/, ''));
  });
  return ref;
}
function LayerButtons(): ReactElement {
  const v = useStore(layersView), p = useStore(panelsView);
  const cur = v.layers[v.layer], cn = cur ? `“${cur.name}”` : 'the layer';
  const drawn = v.n > 0;
  const dup = useLayerTitle(drawn ? `Duplicate ${cn} (⌘D)` : null);
  const merge = useLayerTitle(drawn ? `Merge ${cn} down (⌘E)` : null);
  const del = useLayerTitle(drawn ? `Delete ${cn} (⌘⌫)` : null);
  return (
    <>
      <button className="btn small icon" id="layer-add" title="New layer (⇧⌘N)" onClick={() => { tool('add_layer', {}); }}><Icon name="plus" /></button>
      <button className="btn small icon" id="layer-dup" title="Duplicate layer (⌘D)" ref={dup} onClick={() => { tool('duplicate_layer', { layer: S.layer }); }}><Icon name="copy" /></button>
      <button className="btn small icon" id="layer-merge" title="Merge down (⌘E)" ref={merge} disabled={p.layerMergeOff} onClick={() => { tool('merge_layer_down', { layer: S.layer }); }}><Icon name="merge" /></button>
      <button className="btn small icon" id="layer-del" title="Delete layer (⌘⌫)" ref={del} disabled={p.layerDelOff} onClick={() => { tool('delete_layer', { layer: S.layer }); }}><Icon name="trash" /></button>
    </>
  );
}

/** A layer's name becomes a field; Return or clicking away keeps the new name, Escape goes back. The field is put in
 *  by hand, as before: the next renderLayers() builds the row anew. */
function renameLayer(el: HTMLElement, li: number): void {
  const input = document.createElement('input');
  input.value = S.layers[li].name;
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
  let finished = false;
  const done = (ok: boolean) => {
    if (finished) return; finished = true;
    const v = input.value.trim();
    if (ok && v && v !== S.layers[li].name) tool('set_layer', { layer: li, name: v });
    else renderLayers();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  input.onblur = () => done(true);
  input.onclick = (e) => e.stopPropagation();
}

function LayerRow({ li, L, selected, isSprite }: { li: number; L: Layer; selected: boolean; isSprite: boolean | undefined }): ReactElement {
  const press = pressableProps(`Layer ${L.name}${selected ? ', selected' : ''}${L.visible ? '' : ', hidden'}${L.locked ? ', locked' : ''}`);
  return (
    <div className={'layer' + (selected ? ' on' : '') + (L.visible ? '' : ' hidden-layer')} aria-current={selected ? 'true' : undefined}
      {...press} draggable
      onClick={() => { if (li !== S.layer) setActive({ layer: li }); }}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        const t = e.target as Element;
        if (t.closest && t.closest('input')) { e.preventDefault(); return; }
        live.layerDrag = li;
        e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', L.name);
        const row = e.currentTarget;
        requestAnimationFrame(() => row.classList.add('dragging'));
        hideTip();
      }}
      onDragEnd={() => { live.layerDrag = null; clearLayerDrop(); renderLayers(); }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        if (live.layerDrag == null) return;
        e.preventDefault(); e.stopPropagation();
        const row = e.currentTarget;
        const r = row.getBoundingClientRect(), above = e.clientY < r.top + r.height / 2;
        clearLayerDrop();
        if (li !== live.layerDrag) row.classList.add(above ? 'drop-above' : 'drop-below');
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        if (live.layerDrag == null) return;
        e.preventDefault(); e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect(), from = live.layerDrag;
        const to = li === from ? from : layerDropTarget(li, e.clientY < r.top + r.height / 2);
        live.layerDrag = null; clearLayerDrop();
        moveLayer(from, to);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        press.onKeyDown(e);
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const to = li + (e.key === 'ArrowUp' ? 1 : -1); // up the list is towards the front
        if (to >= 0 && to < S.layers.length) moveLayer(li, to);
      }}>
      <span className="lic"><Icon name={isSprite ? 'image' : 'box'} size={14} /></span>
      <span className="lname" title="Double-click to rename" onDoubleClick={(e) => { e.stopPropagation(); renameLayer(e.currentTarget, li); }}>{L.name}</span>
      <span className={`tog ${L.locked ? 'set' : ''}`} title="Lock / unlock" {...pressableProps(`${L.locked ? 'Unlock' : 'Lock'} ${L.name}`)}
        onClick={(e) => { e.stopPropagation(); tool('set_layer', { layer: li, locked: !L.locked }); }}><Icon name={L.locked ? 'lock' : 'lock-open'} size={14} /></span>
      <span className={`tog ${L.visible ? '' : 'set'}`} title="Show / hide" {...pressableProps(`${L.visible ? 'Hide' : 'Show'} ${L.name}`)}
        onClick={(e) => { e.stopPropagation(); tool('set_layer', { layer: li, visible: !L.visible }); }}><Icon name={L.visible ? 'eye' : 'eye-off'} size={14} /></span>
    </div>
  );
}

/** #layers: the top row is in front. Each renderLayers() builds the rows anew (the key carries its count), so nothing a
 *  row was given by hand (a rename field, a drop line, an adopted title) outlives the redraw, as before. */
function Layers(): ReactElement {
  const v = useStore(layersView);
  const rows: ReactElement[] = [];
  for (let li = v.layers.length - 1; li >= 0; li--) {
    rows.push(<LayerRow key={`${v.n}:${li}`} li={li} L={v.layers[li]} selected={li === v.layer} isSprite={v.isSprite} />);
  }
  return (
    <div id="layers"
      onDragOver={(e) => {
        if (live.layerDrag == null) return;
        e.preventDefault(); clearLayerDrop(); e.currentTarget.classList.add('drop-end');
      }}
      onDrop={(e) => {
        if (live.layerDrag == null) return;
        e.preventDefault();
        const from = live.layerDrag; live.layerDrag = null; clearLayerDrop();
        moveLayer(from, 0);
      }}>
      {rows}
    </div>
  );
}

function LayersPane(): ReactElement {
  const v = useStore(leftView);
  return (
    <section className="sec grow pane" data-pane="layers" hidden={v.pane !== 'layers'}>
      <div className="sec-head">Layers<span className="spacer"></span><LayerButtons /></div>
      <Layers />
    </section>
  );
}

/* ---------------------------------------------------------------- activity (who did what) */
function ActivityCount(): ReactElement {
  const { count } = useStore(activityView);
  return <span className="muted" id="activity-count">{count}</span>;
}
function ActivityList(): ReactElement {
  const v = useStore(activityView);
  return (
    <div id="activity">
      {v.rows.map(({ entry: e, when }, i) => {
        const who = e.source === 'agent' ? 'agent' : e.source === 'person' ? 'you' : e.source;
        return (
          <div key={`${v.n}:${i}`} className={'act' + (e.ok ? '' : ' bad')} title={e.note || undefined}>
            <span className={`who ${e.source === 'agent' ? 'agent' : ''}`}>{who}</span>
            <span className="tool-name mono">{e.tool}</span><span className="spacer"></span><span className="muted mono">{when}</span>
          </div>
        );
      })}
    </div>
  );
}
function ActivityPane(): ReactElement {
  const v = useStore(leftView);
  return (
    <section className="sec grow pane" id="activity-sec" data-pane="activity" hidden={v.pane !== 'activity'}>
      <div className="sec-head" id="activity-head">Activity<span className="spacer"></span><ActivityCount /></div>
      <ActivityList />
    </section>
  );
}

export function LeftPanel(): ReactElement {
  return (
    <aside id="left">
      <div className="doc-head">
        <div className="doc-row">
          <DocName />
          <button type="button" className="btn icon small doc-more" id="doc-title" aria-haspopup="menu" aria-label="File options" title="File options"
            onClick={(e) => { e.stopPropagation(); openDocMenu(); }}>
            <Icon name="chevron-down" />
          </button>
          <span className="spacer"></span>
          <CollapseButton />
        </div>
      </div>
      <LayersPane />
      {/* Chat with the person's own agents (Claude Code, Codex, Cursor, Gemini CLI) on their subscriptions: the agent works on this file through OpenPixel's tools. The message box grows with its text, then scrolls; send sits inside it, and the agent + model and effort menus sit under it. */}
      <ChatPane />
      <ActivityPane />
    </aside>
  );
}
