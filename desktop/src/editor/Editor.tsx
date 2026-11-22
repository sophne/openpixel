/* PLACEHOLDER (kit): the editor, #app and everything inside it (index.html 21–227)
   The static markup of app/web/index.html, as JSX, with no behaviour. The editor port replaces this file: keep the
   path and the exported names (src/App.tsx imports them), and keep every tag, id, class and attribute.
   The chat panel (#chat-sec) is chat/ChatPane, mounted here in the left panel; #toast is the kit's <Toast/>. */
import { useLayoutEffect, type ReactElement } from 'react';
import { ChatPane } from '../chat/ChatPane';
import { Dropdown, onMenuButton, Stepper, Toast } from '../kit';
import { stopKeys } from '../lib/dom';
import { Icon } from '../lib/icons';
import { shortcutLabel } from '../lib/platform';
import { PRESETS } from '../state/palettes';

export function Editor(): ReactElement {
  // Placeholder for initResizers(): the widths the old page starts with (app.js 3088–3100).
  useLayoutEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--left-w', '264px'); root.setProperty('--right-w', '264px'); root.setProperty('--bottom-h', '104px');
  }, []);
  return (
    <div id="app">
      <header id="top">
        <div className="left"></div>
        <div className="seg" id="mode-seg">
          <button data-mode="slice" title="2D canvas (⌘1)">2D</button>
          <button data-mode="3d" title="3D view (⌘2)">3D</button>
        </div>
        <div className="right">
          <button className="btn icon" id="undo" title="Undo (⌘Z)">
            <Icon name="undo-2" />
          </button>
          <button className="btn icon" id="redo" title="Redo (⇧⌘Z)">
            <Icon name="redo-2" />
          </button>
          <button className="btn outline haptic" id="review-btn" title="Review (⌘R)">
            <Icon name="scan-eye" />
            <span className="lbl">Review</span>
          </button>
          <div className="menu right" id="export-menu">
            <button className="btn primary haptic" data-menu="export-menu" onClick={onMenuButton}>
              <Icon name="download" />
              <span className="lbl">Export</span>
            </button>
            <div className="menu-list">
              <div data-export="png">PNG picture</div>
              <div data-export="svg">SVG vector</div>
              <div data-export="html">HTML page</div>
              <div data-export="gif">Animated GIF</div>
              <div data-export="sheet">Sprite sheet</div>
              <hr />
              <div data-export="vox">MagicaVoxel .vox</div>
              <div data-export="obj">OBJ mesh</div>
            </div>
          </div>
        </div>
      </header>
      {/* The editor's left side, like Figma's: a rail (the app menu, then Layers and Activity) and the panel the active one fills. The panel starts with the file's name and where it lives, and hides with the collapse button (⌘\). */}
      <nav id="rail" aria-label="Editor sidebar">
        <div className="menu" id="file-menu">
          <button type="button" className="rail-app" data-menu="file-menu" title="Main menu" aria-label="Main menu" aria-haspopup="menu" onClick={onMenuButton}>
            <Icon name="file-2d" />
          </button>
          <div className="menu-list" role="menu">
            <div data-action="new"><Icon name="file-plus" />New…<span className="k">{shortcutLabel('⌘N')}</span></div>
            <div data-action="open"><Icon name="folder-open" />Open…<span className="k">{shortcutLabel('⌘O')}</span></div>
            <div data-action="save"><Icon name="save" />Save<span className="k">{shortcutLabel('⌘S')}</span></div>
            <div data-action="saveAs"><Icon name="save" />Save As…<span className="k">{shortcutLabel('⇧⌘S')}</span></div>
            <hr />
            <div data-action="checkUpdates"><Icon name="download" />Check for updates…</div>
          </div>
        </div>
        <hr className="rail-sep" aria-hidden="true" />
        <button type="button" className="rail-btn" data-pane="layers" aria-controls="left" aria-label="Layers" data-tip="Layers">
          <span className="ri">
            <Icon name="layers" />
          </span>
        </button>
        <button type="button" className="rail-btn" data-pane="chat" aria-controls="left" aria-label="Agent Chat" data-tip="Agent Chat">
          <span className="ri">
            <Icon name="sparkle" />
            <span className="rail-dot" id="chat-dot" hidden></span>
          </span>
        </button>
        <button type="button" className="rail-btn" data-pane="activity" aria-controls="left" aria-label="Activity" data-tip="Activity">
          <span className="ri">
            <Icon name="history" />
            <span className="rail-dot" id="activity-dot" hidden></span>
          </span>
        </button>
      </nav>
      <aside id="left">
        <div className="doc-head">
          <div className="doc-row">
            <span className="doc-name" id="doc-name" title="Double-click to rename"></span>
            <button type="button" className="btn icon small doc-more" id="doc-title" aria-haspopup="menu" aria-label="File options" title="File options">
              <Icon name="chevron-down" />
            </button>
            <span className="spacer"></span>
            <button type="button" className="btn small icon" id="left-collapse" title="Hide sidebar (⌘\)" aria-label="Hide sidebar" aria-expanded="true" aria-controls="left">
              <Icon name="panel-left" />
            </button>
          </div>
        </div>
        <section className="sec grow pane" data-pane="layers">
          <div className="sec-head">Layers<span className="spacer"></span><button className="btn small icon" id="layer-add" title="New layer (⇧⌘N)"><Icon name="plus" /></button><button className="btn small icon" id="layer-dup" title="Duplicate layer (⌘D)"><Icon name="copy" /></button><button className="btn small icon" id="layer-merge" title="Merge down (⌘E)"><Icon name="merge" /></button><button className="btn small icon" id="layer-del" title="Delete layer (⌘⌫)"><Icon name="trash" /></button></div>
          <div id="layers"></div>
        </section>
        {/* Chat with the person's own agents (Claude Code, Codex, Cursor, Gemini CLI) on their subscriptions: the agent works on this file through OpenPixel's tools. The message box grows with its text, then scrolls; send sits inside it, and the agent + model and effort menus sit under it. */}
        <ChatPane />
        <section className="sec grow pane" id="activity-sec" data-pane="activity" hidden>
          <div className="sec-head" id="activity-head">Activity<span className="spacer"></span><span className="muted" id="activity-count"></span></div>
          <div id="activity"></div>
        </section>
      </aside>
      <main id="stage" aria-label="Canvas">
        <canvas id="gl" role="img" aria-label="3D view of the model"></canvas>
        <canvas id="slice" role="img" aria-label="Drawing canvas"></canvas>
        <canvas id="axes" width="70" height="70"></canvas>
        <div className="chip-float" id="info-chip"></div>
        <div className="chip-float mono" id="cursor-chip"></div>
        <div id="toolbar"></div>
        <Toast />
      </main>
      <section id="frames">
        <div className="resizer h" data-resize="bottom"></div>
        <div id="frames-bar">
          <button type="button" className="collapse-btn" id="frames-toggle" aria-expanded="true" aria-controls="strip" title="Hide frames (F)">
            <Icon name="chevron-down" className="chev" />
            <span className="title">Frames</span>
          </button>
          <button className="btn small icon" id="play" title="Play (↩)">
            <Icon name="play" />
          </button>
          <button className="chip" id="onion" title="Onion skin (O)">
            <Icon name="ghost" />
            <span className="lbl">Onion</span>
          </button>
          <span className="spacer"></span>
          <span className="muted lbl">Duration</span>
          <Stepper min={1} max={65535} stepSize={10} title="Frame duration" input={{ id: 'duration', 'aria-label': 'Frame duration in milliseconds', className: 'mono', inputMode: 'numeric' }} />
          <span className="muted">ms</span>
          <button className="btn small icon" id="frame-add" title="New frame (⌥⌘N)">
            <Icon name="plus" />
          </button>
          <button className="btn small icon" id="frame-del" title="Delete frame (⌥⌘⌫)">
            <Icon name="trash" />
          </button>
        </div>
        <div id="strip"></div>
      </section>
      <aside id="right">
        <section className="sec">
          <div className="sec-head">Colour<span className="spacer"></span><button className="btn small icon" id="add-color" title="Add a colour"><Icon name="plus" /></button></div>
          <div id="color-row">
            <div id="fg" title="Edit colour" role="button" tabIndex={0} aria-label="Edit the current colour"></div>
            <input id="fg-hex" className="field mono" spellCheck={false} title="Hex colour" aria-label="Colour as hex" onKeyDown={stopKeys} />
            <span className="muted mono" id="fg-index"></span>
          </div>
          <div id="palette"></div>
          <div className="row">
            <Dropdown id="preset" style={{ flex: 1 }} title="Palette preset" aria-label="Palette preset" options={PRESETS} placeholder="Palette preset…" keepLabel />
          </div>
        </section>
        <section className="sec">
          <div className="sec-head">Brush</div>
          <div className="row">
            <label>Size</label>
            <input type="range" id="brush" min="1" max="16" defaultValue="1" aria-label="Brush size" />
            <span className="mono" id="brush-size" style={{ width: '18px', textAlign: 'right' }}>1</span>
          </div>
          <div className="row">
            <label>Mirror</label>
            <button className="chip" data-mirror="x" title="Mirror left–right (⇧X)"><Icon name="square-split-horizontal" />X</button>
            <button className="chip" data-mirror="y" title="Mirror up–down (⇧Y)"><Icon name="square-split-vertical" />Y</button>
            <button className="chip" data-mirror="z" title="Mirror front–back (⇧Z)">Z</button>
          </div>
        </section>
        <section className="sec" id="view-sec">
          <div className="sec-head">View</div>
          <div id="view-slice">
            <div className="row">
              <label>Slice</label>
              <div className="seg">
                <button data-axis="x" title="Side view">X</button>
                <button data-axis="y" title="Top view">Y</button>
                <button data-axis="z" title="Front view">Z</button>
              </div>
              <span className="keep start">
                <button className="btn small icon" id="slice-down" title="Previous slice (PgDn)">
                  <Icon name="minus" />
                </button>
                <span className="mono" id="slice-index">0</span>
                <button className="btn small icon" id="slice-up" title="Next slice (PgUp)">
                  <Icon name="plus" />
                </button>
              </span>
            </div>
          </div>
          <div id="view-sprite">
            <div className="row">
              <label>Make 3D</label>
              <Stepper min={1} max={256} title="Depth" input={{ id: 'extrude-depth', 'aria-label': 'Depth to extrude', className: 'mono', defaultValue: '4', inputMode: 'numeric' }} />
              <button className="btn small outline" id="extrude-btn" title="Make 3D">
                <Icon name="cuboid" />
                <span className="lbl">Extrude</span>
              </button>
            </div>
          </div>
          <div id="view-2d">
            <div className="row">
              <label>Zoom</label>
              <span className="keep start">
                <button className="btn small icon" id="zoom-out" title="Zoom out (⌘−)">
                  <Icon name="zoom-out" />
                </button>
                <span className="mono" id="zoom-label" style={{ minWidth: '44px', textAlign: 'center' }}></span>
                <button className="btn small icon" id="zoom-in" title="Zoom in (⌘+)">
                  <Icon name="zoom-in" />
                </button>
              </span>
              <button className="btn small outline" id="zoom-fit" title="Fit (⌘0)">
                <Icon name="focus" />
                <span className="lbl">Fit</span>
              </button>
            </div>
            <div className="row">
              <label>Show</label>
              <button className="chip on" id="pixel-grid-btn" title="Pixel grid (⌘')">
                <Icon name="grid-3x3" />
                <span className="lbl">Grid</span>
              </button>
              <button className="chip on" id="ghost-btn" title="Ghost slice">
                <Icon name="ghost" />
                <span className="lbl">Ghost</span>
              </button>
            </div>
          </div>
          <div id="view-3d">
            <div className="row">
              <label>Camera</label>
              <div className="seg">
                <button data-proj="persp">Perspective</button>
                <button data-proj="ortho">Ortho</button>
              </div>
            </div>
            <div className="row">
              <label>Show</label>
              <button className="chip on" id="edges-btn" title="Voxel edges">
                <Icon name="grid-3x3" />
                <span className="lbl">Edges</span>
              </button>
              <button className="chip on" id="grid-btn" title="Ground and bounds">
                <Icon name="square-dashed" />
                <span className="lbl">Bounds</span>
              </button>
            </div>
            <div className="row">
              <label></label>
              <button className="btn small outline" id="reset-cam" title="Reset view (⌘0)">
                <Icon name="focus" />
                <span className="lbl">Reset view</span>
              </button>
            </div>
          </div>
        </section>
        <section className="sec">
          <div className="sec-head">Preview<span className="spacer"></span><span className="muted" id="preview-angle">iso</span></div>
          <div id="preview-wrap">
            <img id="preview" alt="" />
          </div>
          <div className="row">
            <div className="seg">
              <button data-pview="front">Front</button>
              <button data-pview="iso">Iso</button>
            </div>
            <span className="spacer"></span>
            <div className="seg">
              <button data-pscale="2" title="Small preview">S</button>
              <button data-pscale="3" title="Medium preview">M</button>
              <button data-pscale="4" title="Large preview">L</button>
            </div>
          </div>
        </section>
      </aside>
      {/* Side panel handles live on the app grid (not inside the panels) so nothing clips or scrolls them. */}
      <div className="resizer v" data-resize="left"></div>
      <div className="resizer v" data-resize="right"></div>
    </div>
  );
}
