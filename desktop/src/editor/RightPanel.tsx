/* The right panel: Colour (the palette and the current colour), Brush, View and Preview. */
import { useRef, type ReactElement } from 'react';
import { Dropdown, pressableProps, Stepper } from '../kit';
import { $, useEvent } from '../lib/dom';
import { Icon } from '../lib/icons';
import { changed, useStore } from '../lib/store';
import { PRESETS } from '../state/palettes';
import { S } from '../state/ui';
import { addColor, editColor } from './colour';
import { chipsView, dirty, fgView, paletteView, previewView, tool, viewPanel, type Axis } from './core';
import { schedulePreview, setFg } from './engine';
import { resetCamera } from './gl';
import { setAxis, setBrush, setPixelGrid, stepSlice } from './modes';
import { fitSlice, updateInfoChip, updateViewPanel, zoomStep } from './slice';

/* ---------------------------------------------------------------- colour */
function CurrentColor(): ReactElement {
  const { hex } = useStore(fgView);
  return <div id="fg" title="Edit colour" {...pressableProps('Edit the current colour')} style={hex ? { background: hex } : undefined}
    onClick={(e) => editColor(S.fg, e.currentTarget)}></div>;
}
function ColorIndex(): ReactElement {
  const { index } = useStore(fgView);
  return <span className="muted mono" id="fg-index">{index}</span>;
}
/** #palette: a swatch per colour (index 0 is "no colour") and a + while there is room. Each renderPalette() builds
 *  them anew (the key carries its count); setFg() only moves the ring. */
function Palette(): ReactElement {
  const v = useStore(paletteView);
  return (
    <div id="palette">
      {v.palette.map((hex, i) => i === 0 ? null : (
        <div key={`${v.n}:${i}`} className={'sw' + (i === v.fg ? ' on' : '')} style={{ background: hex }} title={hex}
          onClick={() => setFg(i)} onDoubleClick={(e) => editColor(i, e.currentTarget)}></div>
      ))}
      {v.n > 0 && v.palette.length < 256 ? (
        <div key={`${v.n}:add`} className="sw add" title="Add a colour" onClick={(e) => addColor(e.currentTarget)}><Icon name="plus" size={12} /></div>
      ) : null}
    </div>
  );
}
function ColourSection(): ReactElement {
  return (
    <section className="sec">
      <div className="sec-head">Colour<span className="spacer"></span><button className="btn small icon" id="add-color" title="Add a colour" onClick={(e) => addColor(e.currentTarget)}><Icon name="plus" /></button></div>
      <div id="color-row">
        <CurrentColor />
        <input id="fg-hex" className="field mono" spellCheck={false} title="Hex colour" aria-label="Colour as hex"
          onKeyDown={async (e) => {
            e.stopPropagation();
            if (e.key !== 'Enter') return;
            const field = e.currentTarget;
            const r = await tool('add_colors', { colors: [field.value.trim()] });
            if (r && r.indexes) { setFg(r.indexes[0]); field.blur(); }
          }} />
        <ColorIndex />
      </div>
      <Palette />
      <div className="row">
        <Dropdown id="preset" style={{ flex: 1 }} title="Palette preset" aria-label="Palette preset" options={PRESETS} placeholder="Palette preset…" keepLabel
          onChange={(v) => { tool('set_palette', { preset: v }); }} />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- brush */
function BrushSize(): ReactElement {
  const { brush } = useStore(chipsView);
  return <span className="mono" id="brush-size" style={{ width: '18px', textAlign: 'right' }}>{brush}</span>;
}
function MirrorChips(): ReactElement {
  const { mirror } = useStore(chipsView);
  const flip = (a: 'x' | 'y' | 'z') => (): void => { S.mirror[a] = !S.mirror[a]; chipsView.mirror = { ...S.mirror }; changed(chipsView); };
  return (
    <>
      <button className={mirror.x ? 'chip on' : 'chip'} data-mirror="x" title="Mirror left–right (⇧X)" onClick={flip('x')}><Icon name="square-split-horizontal" />X</button>
      <button className={mirror.y ? 'chip on' : 'chip'} data-mirror="y" title="Mirror up–down (⇧Y)" onClick={flip('y')}><Icon name="square-split-vertical" />Y</button>
      <button className={mirror.z ? 'chip on' : 'chip'} data-mirror="z" title="Mirror front–back (⇧Z)" onClick={flip('z')}>Z</button>
    </>
  );
}
function BrushSection(): ReactElement {
  const range = useRef<HTMLInputElement>(null);
  // The slider's own `input` event, on the element itself (as before; React's onChange only hears events that bubble).
  useEvent(range, 'input', () => setBrush(+range.current!.value));
  return (
    <section className="sec">
      <div className="sec-head">Brush</div>
      <div className="row">
        <label>Size</label>
        <input type="range" id="brush" min="1" max="16" defaultValue="1" aria-label="Brush size" ref={range} />
        <BrushSize />
      </div>
      <div className="row">
        <label>Mirror</label>
        <MirrorChips />
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- view */
function ViewSection(): ReactElement {
  const v = useStore(viewPanel), c = useStore(chipsView);
  const axis = (a: Axis): ReactElement => <button data-axis={a} title={{ x: 'Side view', y: 'Top view', z: 'Front view' }[a]} className={v.axis === a ? 'on' : undefined} onClick={() => setAxis(a)}>{a.toUpperCase()}</button>;
  const proj = (p: 'persp' | 'ortho', label: string): ReactElement => (
    <button data-proj={p} className={v.ortho != null && (p === 'ortho') === v.ortho ? 'on' : undefined}
      onClick={() => { S.ortho = p === 'ortho'; dirty.render3d = true; updateViewPanel(); updateInfoChip(); }}>{label}</button>
  );
  return (
    <section className="sec" id="view-sec">
      <div className="sec-head">View</div>
      <div id="view-slice" hidden={v.sliceHidden}>
        <div className="row">
          <label>Slice</label>
          <div className="seg">
            {axis('x')}
            {axis('y')}
            {axis('z')}
          </div>
          <span className="keep start">
            <button className="btn small icon" id="slice-down" title="Previous slice (PgDn)" onClick={() => stepSlice(-1)}>
              <Icon name="minus" />
            </button>
            <span className="mono" id="slice-index">{v.sliceIndex}</span>
            <button className="btn small icon" id="slice-up" title="Next slice (PgUp)" onClick={() => stepSlice(1)}>
              <Icon name="plus" />
            </button>
          </span>
        </div>
      </div>
      <div id="view-sprite" hidden={v.spriteHidden}>
        <div className="row">
          <label>Make 3D</label>
          <Stepper min={1} max={256} title="Depth" input={{ id: 'extrude-depth', 'aria-label': 'Depth to extrude', className: 'mono', defaultValue: '4', inputMode: 'numeric' }} />
          <button className="btn small outline" id="extrude-btn" title="Make 3D"
            onClick={() => { tool('extrude_to_3d', { depth: Math.max(1, +$<HTMLInputElement>('#extrude-depth').value || 4) }); }}>
            <Icon name="cuboid" />
            <span className="lbl">Extrude</span>
          </button>
        </div>
      </div>
      <div id="view-2d" hidden={v.twoDHidden}>
        <div className="row">
          <label>Zoom</label>
          <span className="keep start">
            <button className="btn small icon" id="zoom-out" title="Zoom out (⌘−)" onClick={() => zoomStep(-1, true)}>
              <Icon name="zoom-out" />
            </button>
            <span className="mono" id="zoom-label" style={{ minWidth: '44px', textAlign: 'center' }}>{v.zoomLabel}</span>
            <button className="btn small icon" id="zoom-in" title="Zoom in (⌘+)" onClick={() => zoomStep(1, true)}>
              <Icon name="zoom-in" />
            </button>
          </span>
          <button className="btn small outline" id="zoom-fit" title="Fit (⌘0)" onClick={fitSlice}>
            <Icon name="focus" />
            <span className="lbl">Fit</span>
          </button>
        </div>
        <div className="row">
          <label>Show</label>
          <button className={c.pixelGrid ? 'chip on' : 'chip'} id="pixel-grid-btn" title="Pixel grid (⌘')" onClick={() => setPixelGrid(!S.pixelGrid)}>
            <Icon name="grid-3x3" />
            <span className="lbl">Grid</span>
          </button>
          <button className={c.ghost ? 'chip on' : 'chip'} id="ghost-btn" title="Ghost slice" hidden={v.ghostHidden}
            onClick={() => { S.ghost = !S.ghost; chipsView.ghost = S.ghost; changed(chipsView); dirty.slice = true; }}>
            <Icon name="ghost" />
            <span className="lbl">Ghost</span>
          </button>
        </div>
      </div>
      <div id="view-3d" hidden={v.threeDHidden}>
        <div className="row">
          <label>Camera</label>
          <div className="seg">
            {proj('persp', 'Perspective')}
            {proj('ortho', 'Ortho')}
          </div>
        </div>
        <div className="row">
          <label>Show</label>
          <button className={c.edges ? 'chip on' : 'chip'} id="edges-btn" title="Voxel edges"
            onClick={() => { S.edges = !S.edges; chipsView.edges = S.edges; changed(chipsView); dirty.render3d = true; }}>
            <Icon name="grid-3x3" />
            <span className="lbl">Edges</span>
          </button>
          <button className={c.grid ? 'chip on' : 'chip'} id="grid-btn" title="Ground and bounds"
            onClick={() => { S.grid = !S.grid; chipsView.grid = S.grid; changed(chipsView); dirty.render3d = true; }}>
            <Icon name="square-dashed" />
            <span className="lbl">Bounds</span>
          </button>
        </div>
        <div className="row">
          <label></label>
          <button className="btn small outline" id="reset-cam" title="Reset view (⌘0)" onClick={resetCamera}>
            <Icon name="focus" />
            <span className="lbl">Reset view</span>
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- pixel-art preview (rendered by the engine) */
function PreviewAngle(): ReactElement {
  const { previewAngle } = useStore(chipsView);
  return <span className="muted" id="preview-angle">{previewAngle}</span>;
}
function PreviewPicture(): ReactElement {
  const { src } = useStore(previewView);
  return <img id="preview" alt="" src={src}
    onLoad={(e) => { const img = e.currentTarget; img.style.width = (img.naturalWidth * 2 / Math.max(1, window.devicePixelRatio || 1)) + 'px'; }} />;
}
function PreviewChoices(): ReactElement {
  const c = useStore(chipsView);
  const view = (which: 'front' | 'iso', label: string): ReactElement => (
    <button data-pview={which} className={c.pview === which ? 'on' : undefined}
      onClick={() => {
        if (which === 'front') { S.previewYaw = 0; S.previewPitch = 0; } else { S.previewYaw = 45; S.previewPitch = 30; }
        chipsView.pview = which; changed(chipsView); schedulePreview();
      }}>{label}</button>
  );
  const scale = (n: number, title: string, label: string): ReactElement => (
    <button data-pscale={n} title={title} className={c.pscale === n ? 'on' : undefined}
      onClick={() => { S.previewScale = n; chipsView.pscale = n; changed(chipsView); schedulePreview(); }}>{label}</button>
  );
  return (
    <div className="row">
      <div className="seg">
        {view('front', 'Front')}
        {view('iso', 'Iso')}
      </div>
      <span className="spacer"></span>
      <div className="seg">
        {scale(2, 'Small preview', 'S')}
        {scale(3, 'Medium preview', 'M')}
        {scale(4, 'Large preview', 'L')}
      </div>
    </div>
  );
}

export function RightPanel(): ReactElement {
  return (
    <aside id="right">
      <ColourSection />
      <BrushSection />
      <ViewSection />
      <section className="sec">
        <div className="sec-head">Preview<span className="spacer"></span><PreviewAngle /></div>
        <div id="preview-wrap">
          <PreviewPicture />
        </div>
        <PreviewChoices />
      </section>
    </aside>
  );
}
