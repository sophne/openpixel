/* The home screen, #home: Recents, All folders, Archive, Agents: the title, the file and folder cards, the list
   layout and their handlers. The logic is in ./homePage. The Agents list (#home-agents-wrap) is <AgentsList/> from
   library/Agents. */
import { Fragment, memo, useLayoutEffect, useRef, type HTMLAttributes, type ReactElement, type ReactNode, type RefObject } from 'react';
import { Dropdown, inlineRename, RenameText } from '../kit';
import { $, useEvent } from '../lib/dom';
import { nativeAction } from '../lib/host';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { home, ui, type LibraryFolder, type LibraryTarget } from '../state/ui';
import { AgentsList } from './Agents';
import { EmptyState } from './EmptyState';
import {
  documentDragOver, documentDrop, emptyArchive, endDrag, fileRename, FILTERS, folderById, folderSummary, homeFiles, homeTop, latestInFolder, layoutSeg,
  locationText, menus, newFolder, openCardMenu, openFolder, openHomePage, openItem, renamers, renameFolderTo, renderHome, setHomeFilter, setHomeLayout,
  setHomeSort, sizeText, SORTS, startDrag, startPrefs, whenText, type LibFile, type RenameSpec,
} from './homePage';
import { openNewPage } from './newpage';

/** A class that is put on and taken off with classList after every drawing, for an element whose other classes are
 *  put on by hand (`drop-over` while something is dragged over it). */
function useClass<T extends Element>(name: string, on: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useLayoutEffect(() => { if (ref.current) ref.current.classList.toggle(name, on); });
  return ref;
}

function KindIcon({ f, size = 12 }: { f: LibFile; size?: number }): ReactElement {
  return <span className={`kind ${f.kind === '3d' ? 'k3d' : 'k2d'}`} aria-hidden="true"><Icon name={f.kind === '3d' ? 'file-3d' : 'file-2d'} size={size} /></span>;
}

interface ItemProps extends HTMLAttributes<HTMLDivElement> {
  target: LibraryTarget;
  /** Opens the file or folder; gets the card or row. */
  open(el: HTMLElement): void;
  /** The name for screen readers. */
  label: string;
  /** How the name renames in place, or null when it can't; `nameRef` is the element that shows the name. */
  rename: RenameSpec | null;
  nameRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  [data: `data-${string}`]: string | undefined;
}
/** Shared behaviour for a file or folder card or row (wireItem): the element itself with its contents, then its … button. */
function Item({ target, open, label, rename, nameRef, children, ...rest }: ItemProps): ReactElement {
  const el = useRef<HTMLDivElement>(null);
  const wait = useRef(0);
  const startRename = () => { clearTimeout(wait.current); if (rename) inlineRename(nameRef.current, rename.current, rename.commit); };
  // Rename in the menu finds the card or row here (the old el._rename).
  useLayoutEffect(() => {
    const e = el.current;
    if (!e) return;
    if (rename) renamers.set(e, startRename); else renamers.delete(e);
  });
  const onName = (t: EventTarget) => !!rename && !!nameRef.current && nameRef.current.contains(t as Node);
  const more = () => (el.current as HTMLDivElement).querySelector('.more') || (el.current as HTMLDivElement);
  return (
    <div {...rest} ref={el} tabIndex={0} role="button" aria-label={label}
      // Double-clicking the name renames in place. A click on the name waits a moment, so a double-click doesn't open
      // the file first; anywhere else on the card or row opens at once.
      onClick={(e) => {
        const go = () => open(el.current as HTMLDivElement);
        if (onName(e.target)) {
          clearTimeout(wait.current);
          if (e.detail < 2) wait.current = window.setTimeout(go, 260);
          return;
        }
        go();
      }}
      onDoubleClick={(e) => { if (onName(e.target)) { e.preventDefault(); e.stopPropagation(); startRename(); } }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.currentTarget); }
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); openCardMenu(more(), target); }
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openCardMenu({ x: e.clientX, y: e.clientY }, target); }}
      draggable
      onDragStart={(e) => startDrag(e, { type: target.type, id: target.item.id, name: target.item.name })}
      onDragEnd={endDrag}>
      {children}
      <button type="button" className="btn small icon more" aria-label={`More for ${target.item.name}`} data-tip="More"
        onClick={(e) => { e.stopPropagation(); openCardMenu(e.currentTarget, target); }}
        onKeyDown={(e) => e.stopPropagation()}>
        <Icon name="ellipsis" size={16} />
      </button>
    </div>
  );
}
const RENAME_TIP = 'Double-click to rename';
const fileLabel = (f: LibFile) => `${f.name}, ${f.kind === '3d' ? '3D' : '2D'} file, ${whenText(f)}`;
const fileIcon = (f: LibFile) => (f.kind === '3d' ? 'file-3d' : 'file-2d');

function FileCard({ f, q }: { f: LibFile; q: string }): ReactElement {
  const name = useRef<HTMLElement>(null);
  const rename = fileRename(f);
  // Name, then when and how big; where it lives is in the list view and the tooltip. Search results, which mix
  // pages, still say when a file is in the Archive.
  const archivedHit = f.archived && q;
  return (
    <Item className={'card' + (f.exists || f.sample ? '' : ' missing')} title={f.sample ? 'Built into OpenPixel' : f.path}
      data-id={f.id} data-sample={f.sample ? f.id : undefined} data-path={f.path || undefined}
      target={{ type: 'file', item: f }} open={(el) => { openItem(f, el); }} label={fileLabel(f)} rename={rename} nameRef={name}>
      <div className="pv">{f.thumb ? <img alt="" draggable={false} src={f.thumb} /> : <Icon name={fileIcon(f)} size={28} />}<KindIcon f={f} /></div>
      <div className="meta">
        <RenameText as="div" className="t" text={f.name} ref={name} title={rename ? RENAME_TIP : undefined} />
        <div className="s">{[whenText(f), sizeText(f), archivedHit ? 'In the Archive' : ''].filter(Boolean).join(' · ')}</div>
      </div>
    </Item>
  );
}

/** A folder's card: its three newest files side by side (empty slots stay as quiet tiles), then its icon and name. */
function FolderCard({ fd }: { fd: LibraryFolder }): ReactElement {
  const name = useRef<HTMLElement>(null);
  const latest = latestInFolder(fd.id);
  return (
    <Item className="card folder-card" data-folder={fd.id} data-drop={fd.id}
      target={{ type: 'folder', item: fd }} open={() => openFolder(fd.id)} label={`Folder ${fd.name}`}
      rename={{ current: fd.name, commit: (v) => renameFolderTo(fd, v) }} nameRef={name}>
      <div className="fprev" aria-hidden="true">
        {[0, 1, 2].map((i) => {
          const f = latest[i];
          return f
            ? <div key={i} className="ft">{f.thumb ? <img alt="" draggable={false} src={f.thumb} /> : <Icon name={fileIcon(f)} size={20} />}</div>
            : <div key={i} className="ft empty"></div>;
        })}
      </div>
      <div className="fmeta"><span className="fic" aria-hidden="true"><Icon name="folder" size={20} /></span><RenameText as="div" className="t" text={fd.name} ref={name} title={RENAME_TIP} /></div>
    </Item>
  );
}

function FolderRow({ fd }: { fd: LibraryFolder }): ReactElement {
  const name = useRef<HTMLElement>(null);
  const summary = folderSummary(fd.id);
  return (
    <Item className="fl-row fl-item folder-row" data-folder={fd.id} data-drop={fd.id}
      target={{ type: 'folder', item: fd }} open={() => openFolder(fd.id)} label={`Folder ${fd.name}, ${summary}`}
      rename={{ current: fd.name, commit: (v) => renameFolderTo(fd, v) }} nameRef={name}>
      <span className="c-name"><span className="kind kfolder" aria-hidden="true"><Icon name="folder" size={12} /></span><RenameText className="nm" text={fd.name} ref={name} title={RENAME_TIP} /></span>
      <span className="c-when">—</span>
      <span className="c-size">{summary}</span>
      <span className="c-loc">{fd.parent ? `In ${(folderById(fd.parent) || ({} as Partial<LibraryFolder>)).name || 'a folder'}` : 'All folders'}</span>
    </Item>
  );
}

function FileRow({ f, q }: { f: LibFile; q: string }): ReactElement {
  const name = useRef<HTMLElement>(null);
  const rename = fileRename(f);
  return (
    <Item className={'fl-row fl-item' + (f.exists || f.sample ? '' : ' missing')} title={f.sample ? 'Built into OpenPixel' : f.path}
      data-id={f.id} data-sample={f.sample ? f.id : undefined}
      target={{ type: 'file', item: f }} open={(el) => { openItem(f, el); }} label={fileLabel(f)} rename={rename} nameRef={name}>
      <span className="c-name"><KindIcon f={f} /><RenameText className="nm" text={f.name} ref={name} title={rename ? RENAME_TIP : undefined} /></span>
      <span className="c-when">{whenText(f)}</span>
      <span className="c-size">{sizeText(f)}</span>
      <span className="c-loc">{locationText(f, q)}</span>
    </Item>
  );
}

/** A column heading of the list that sorts by its column; again turns the order round. */
function SortColumn({ label, sortKey, cls, sort, dir }: { label: string; sortKey: string; cls: string; sort: string; dir: string }): ReactElement {
  const on = sort === sortKey;
  return (
    <button type="button" className={`fl-col ${cls}${on ? ' on' : ''}`}
      aria-label={`Sort by ${label.toLowerCase()}${on ? `, ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
      onClick={() => setHomeSort(sortKey, on ? (dir === 'asc' ? 'desc' : 'asc') : undefined)}>
      {label}{on ? <Icon name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} /> : null}
    </button>
  );
}

/** List view: a header whose columns sort, then folder rows, then file rows. */
function FileList({ folders, files, q, sort, dir }: { folders: LibraryFolder[]; files: LibFile[]; q: string; sort: string; dir: string }): ReactElement {
  return (
    <div className="file-list">
      <div className="fl-row fl-head">
        <SortColumn label="Name" sortKey="name" cls="c-name" sort={sort} dir={dir} />
        <SortColumn label="Last modified" sortKey="modified" cls="c-when" sort={sort} dir={dir} />
        <SortColumn label="Size" sortKey="size" cls="c-size" sort={sort} dir={dir} />
        <span className="fl-col c-loc static">Location</span>
      </div>
      {folders.map((fd) => <FolderRow key={`folder:${fd.id}`} fd={fd} />)}
      {files.map((f) => <FileRow key={`file:${f.id}`} f={f} q={q} />)}
    </div>
  );
}

/** The grid/list switch. */
function LayoutButton({ layout, label, icon }: { layout: string; label: string; icon: string }): ReactElement {
  const on = useStore(layoutSeg).layout === layout;
  const ref = useClass<HTMLButtonElement>('on', on);
  return (
    <button type="button" ref={ref} data-layout={layout} role="radio" aria-label={label} title={label} aria-checked={on}
      onClick={() => setHomeLayout(layout)}>
      <Icon name={icon} />
    </button>
  );
}

/** Everything in #home-files-wrap: the count, filter, sort and layout, then the folders and the files. Redrawn
 *  when renderHome() says so (not while the Agents page shows). */
const HomeFiles = memo(function HomeFiles(): ReactElement {
  const v = useStore(homeFiles);
  return (
    <>
      <div className="home-tools" role="toolbar" aria-label="Show and sort">
        <span className="muted" id="home-count">{v.count}</span>
        <span className="spacer"></span>
        <Dropdown id="home-filter" hidden={v.onlyFolders} options={FILTERS} value={startPrefs.filter} onChange={setHomeFilter} ref={menus.setFilter}
          button={{ 'aria-label': v.filterLabel }} />
        <Dropdown id="home-sort" options={SORTS} value={startPrefs.sort} onChange={(s) => setHomeSort(s)} ref={menus.setSort}
          button={{ 'aria-label': v.sortLabel }} />
        <div className="seg view-seg" role="radiogroup" aria-label="Layout">
          <LayoutButton layout="grid" label="Grid" icon="layout-grid" />
          <LayoutButton layout="list" label="List" icon="list" />
        </div>
      </div>
      <section id="home-folders-sec" hidden={!v.showFolders}>
        <div className="home-h2" hidden={v.foldersHeadHidden}>Folders</div>
        <div className="cards folders" id="home-folders">
          {v.list ? null : v.folders.map((fd) => <FolderCard key={fd.id} fd={fd} />)}
        </div>
      </section>
      <section id="home-files-sec">
        <div className="home-h2" id="home-files-title" hidden={v.filesTitleHidden}>{v.filesTitle}</div>
        <div className={v.list ? '' : 'cards'} id="home-files">
          {v.list ? <FileList folders={v.folders} files={v.files} q={v.q} sort={v.sort} dir={v.dir} /> : v.files.map((f) => <FileCard key={f.id} f={f} q={v.q} />)}
          {v.empty ? <EmptyState art={v.empty.art} text={v.empty.text} /> : null}
        </div>
      </section>
    </>
  );
});

/** A page of the sidebar. All folders and Archive take drops. */
function NavButton({ page, icon, label, ...drop }: { page: string; icon: string; label: string; 'data-drop'?: string; 'data-drop-archive'?: string }): ReactElement {
  const { navOn, navCurrent } = useStore(homeTop);
  const ref = useClass<HTMLButtonElement>('on', navOn === page);
  return (
    <button type="button" ref={ref} className="home-nav" data-home={page} {...drop}
      aria-current={navCurrent === page ? 'page' : undefined} onClick={() => openHomePage(page)}>
      <Icon name={icon} />{label}
    </button>
  );
}

// GitHub and X at the bottom of the sidebar: the app opens them (it knows the addresses; the page only names one).
const openLink = (link: string) => () => { nativeAction('openLink', { link }); };

const HomeSide = memo(function HomeSide(): ReactElement {
  const { q } = useStore(homeTop);
  const search = useRef<HTMLInputElement>(null);
  useEvent(search, 'input', () => {
    if (home.view === 'agents' && (search.current as HTMLInputElement).value) home.view = 'recents';
    renderHome();
  });
  return (
    <nav className="home-side" aria-label="Library">
      <label className="side-search">
        <Icon name="search" />
        <input id="home-search" ref={search} placeholder="Search all files" spellCheck={false} autoComplete="off" aria-label="Search all files and folders"
          onKeyDown={(e) => {
            e.stopPropagation();
            const input = e.currentTarget;
            if (e.key === 'Escape') { input.value = ''; input.blur(); renderHome(); }
            if (e.key === 'Enter') { const c = $('#home-files .card, #home-folders .card'); if (c) c.focus(); }
          }} />
        <kbd id="search-clear" hidden={!q} aria-hidden="true"
          onClick={() => { const input = search.current as HTMLInputElement; input.value = ''; renderHome(); input.focus(); }}>esc</kbd>
      </label>
      <NavButton page="recents" icon="clock" label="Recents" />
      <NavButton page="folders" icon="folders" label="All folders" data-drop="" />
      <NavButton page="archive" icon="archive" label="Archive" data-drop-archive="" />
      <NavButton page="agents" icon="plug" label="Agents" />
      <span className="spacer"></span>
      <div className="side-links">
        <button type="button" className="side-link app-link" data-link="website" title="openpixel.dev" aria-label="OpenPixel website, openpixel.dev" onClick={openLink('website')}>
          <Icon name="file-2d" />
        </button>
        <button type="button" className="side-link" data-link="github" title="OpenPixel on GitHub" aria-label="OpenPixel on GitHub" onClick={openLink('github')}>
          <Icon name="github" />
        </button>
        <button type="button" className="side-link" data-link="x" title="OpenPixel on X" aria-label="OpenPixel on X" onClick={openLink('x')}>
          <Icon name="x-logo" />
        </button>
      </div>
    </nav>
  );
});

const HomeMain = memo(function HomeMain(): ReactElement {
  const t = useStore(homeTop);
  return (
    <div className="home-main" role="main">
      <div className="home-top">
        <div id="home-title" className="crumbs">
          {t.title.map((part, i) => (
            <Fragment key={i}>
              {i ? <span className="sep" aria-hidden="true"><Icon name="chevron-right" size={14} /></span> : null}
              {part.crumb
                ? <button type="button" className="crumb" data-drop={part.id || ''} onClick={() => openFolder(part.id)}>{part.text}</button>
                : <h1 className="cur">{part.text}</h1>}
            </Fragment>
          ))}
        </div>
        <span className="spacer"></span>
        <button type="button" className="btn outline haptic" id="home-new-folder" hidden={!t.showNewFolder} onClick={() => { newFolder(home.folder); }}>
          <Icon name="folder-plus" />
          <span className="lbl">New folder</span>
        </button>
        <button type="button" className="btn outline haptic danger" id="home-empty-archive" hidden={!t.showEmptyArchive} onClick={emptyArchive}>
          <Icon name="trash-2" />
          <span className="lbl">Delete all permanently</span>
        </button>
        <button type="button" className="btn outline haptic" id="home-open" hidden={!t.showOpen} onClick={() => { nativeAction('open'); }}>
          <Icon name="folder-open" />
          <span className="lbl">Open file</span>
        </button>
        <button type="button" className="btn primary haptic" id="home-create" hidden={!t.showCreate} onClick={() => { openNewPage(); }}>
          <Icon name="plus" />
          <span className="lbl">Create new</span>
        </button>
      </div>
      <div id="home-files-wrap" hidden={t.agentsView}>
        <HomeFiles />
      </div>
      <AgentsList />
    </div>
  );
});

export function Home(): ReactElement {
  const { view } = useStore(ui); // the page shows while ui.view is 'home' (app/pages.ts)
  // Drag and drop: files and folders onto a folder (a card, the sidebar, a breadcrumb), All folders or Archive.
  useEvent<DragEvent>(document, 'dragover', documentDragOver);
  useEvent<DragEvent>(document, 'drop', documentDrop);
  return (
    <div id="home" hidden={view !== 'home'}>
      <HomeSide />
      <HomeMain />
    </div>
  );
}
