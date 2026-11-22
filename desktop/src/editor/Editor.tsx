/* The editor: #app and everything inside it (index.html 21–227; app.js 233–1663, 2918–3284 and 4321–4342, minus the
   kit's parts: see README.md).
     core.ts      the editor's constants and state (22–28, 43–44, 220–231) and one store per old render function
     engine.ts    state from the engine, the panels' redraws, thumbnails, activity, the engine's preview (233–453, 620–649, 759–776)
     colour.ts    the colour picker (505–513, 538–591); its markup and wirePicker() are in EditorDialogs.tsx
     sidebar.ts   the left sidebar's logic, the file's name and menu (651–757)
     gl.ts        the WebGL2 3D view: mesh, camera, drawing, axes, picking (778–1136)
     slice.ts     the 2D slice view, fitting and zooming (1138–1235, 1496–1526, 2969–2975)
     strokes.ts   strokes with their local preview (1237–1327)
     mouse.ts     the pointer, wheel and trackpad in both views, the 2D bucket (1329–1573)
     modes.ts     tools, 2D / 3D, axis, slices, brush, the frames fold, the pixel grid (463–477, 2918–2968)
     controls.ts  play, review, the shortcuts list (2977–3013, 4321–4342)
     resizers.ts  panel sizes (3087–3122)
     init.ts      startup, the key handler, the frame loop, thumbnail sizes (1654–1662, 3228–3284), actions and compat names
   The components (this file, LeftSide.tsx, Stage.tsx, Frames.tsx, RightPanel.tsx, EditorDialogs.tsx) hold the markup
   and what wire() attached to it. The chat panel (#chat-sec) is chat/ChatPane, mounted in the left panel; #toast is
   the kit's <Toast/>. Editor itself renders once; each piece reads the store it draws. */
import type { ReactElement, ReactNode } from 'react';
import { closeMenus, onMenuButton } from '../kit';
import { nativeAction } from '../lib/host';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { S } from '../state/ui';
import { showReview } from './controls';
import { appView, modeView, panelsView, tool } from './core';
import { FramesPanel } from './Frames';
import './init';
import { LeftPanel, Rail } from './LeftSide';
import { setMode } from './modes';
import { resetSize, startResize } from './resizers';
import { RightPanel } from './RightPanel';
import { Stage } from './Stage';

/** #app: its classes say how the editor is laid out: `mode-slice` (the 2D canvas shows), `left-closed`, `frames-closed`. */
function AppGrid({ children }: { children: ReactNode }): ReactElement {
  const a = useStore(appView);
  const cls = [a.leftClosed ? 'left-closed' : '', a.framesClosed ? 'frames-closed' : '', a.modeSlice ? 'mode-slice' : ''].filter(Boolean).join(' ');
  return <div id="app" className={cls || undefined}>{children}</div>;
}

function ModeSwitch(): ReactElement {
  const { mode } = useStore(modeView);
  return (
    <div className="seg" id="mode-seg">
      <button data-mode="slice" title="2D canvas (⌘1)" className={mode === 'slice' ? 'on' : undefined} onClick={() => setMode('slice')}>2D</button>
      <button data-mode="3d" title="3D view (⌘2)" className={mode === '3d' ? 'on' : undefined} onClick={() => setMode('3d')}>3D</button>
    </div>
  );
}
function UndoRedo(): ReactElement {
  const p = useStore(panelsView);
  return (
    <>
      <button className="btn icon" id="undo" title="Undo (⌘Z)" disabled={p.undoOff} onClick={() => { tool('undo'); }}>
        <Icon name="undo-2" />
      </button>
      <button className="btn icon" id="redo" title="Redo (⇧⌘Z)" disabled={p.redoOff} onClick={() => { tool('redo'); }}>
        <Icon name="redo-2" />
      </button>
    </>
  );
}
const exportAs = (format: string) => (): void => {
  closeMenus();
  const opts = ['png', 'svg'].includes(format) && !S.isSprite ? { yaw: S.previewYaw, pitch: S.previewPitch } : {};
  nativeAction('export', { format, options: opts });
};

function TopBar(): ReactElement {
  return (
    <header id="top">
      <div className="left"></div>
      <ModeSwitch />
      <div className="right">
        <UndoRedo />
        <button className="btn outline haptic" id="review-btn" title="Review (⌘R)" onClick={() => { showReview(); }}>
          <Icon name="scan-eye" />
          <span className="lbl">Review</span>
        </button>
        <div className="menu right" id="export-menu">
          <button className="btn primary haptic" data-menu="export-menu" onClick={onMenuButton}>
            <Icon name="download" />
            <span className="lbl">Export</span>
          </button>
          <div className="menu-list">
            <div data-export="png" onClick={exportAs('png')}>PNG picture</div>
            <div data-export="svg" onClick={exportAs('svg')}>SVG vector</div>
            <div data-export="html" onClick={exportAs('html')}>HTML page</div>
            <div data-export="gif" onClick={exportAs('gif')}>Animated GIF</div>
            <div data-export="sheet" onClick={exportAs('sheet')}>Sprite sheet</div>
            <hr />
            <div data-export="vox" onClick={exportAs('vox')}>MagicaVoxel .vox</div>
            <div data-export="obj" onClick={exportAs('obj')}>OBJ mesh</div>
          </div>
        </div>
      </div>
    </header>
  );
}

export function Editor(): ReactElement {
  return (
    <AppGrid>
      <TopBar />
      {/* The editor's left side, like Figma's: a rail (the app menu, then Layers and Activity) and the panel the active one fills. The panel starts with the file's name and where it lives, and hides with the collapse button (⌘\). */}
      <Rail />
      <LeftPanel />
      <Stage />
      <FramesPanel />
      <RightPanel />
      {/* Side panel handles live on the app grid (not inside the panels) so nothing clips or scrolls them. */}
      <div className="resizer v" data-resize="left" onMouseDown={(e) => startResize(e.currentTarget, e)} onDoubleClick={(e) => resetSize(e.currentTarget)}></div>
      <div className="resizer v" data-resize="right" onMouseDown={(e) => startResize(e.currentTarget, e)} onDoubleClick={(e) => resetSize(e.currentTarget)}></div>
    </AppGrid>
  );
}
