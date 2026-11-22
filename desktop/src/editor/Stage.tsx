/* The canvas area (index.html 122–130; app.js 2919–2937 buildTools): the WebGL 3D view, the 2D slice canvas, the axes
   gizmo, the two chips and the drawing toolbar. The canvases are drawn by gl.ts and slice.ts, which get them here. */
import type { ReactElement } from 'react';
import { pressableProps, Toast } from '../kit';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { addColor } from './colour';
import { fgView, infoView, live, TOOLS, toolsView } from './core';
import { attachAxes, attachGL } from './gl';
import { setTool } from './modes';
import { attachSlice } from './slice';

function InfoChip(): ReactElement {
  const { text } = useStore(infoView);
  return <div className="chip-float" id="info-chip">{text}</div>;
}

/** The toolbar's own swatch: shows the current colour, opens the picker to add one. */
function ToolbarColor(): ReactElement {
  const { hex } = useStore(fgView);
  return <div id="tb-color" title="Current colour" {...pressableProps('Add a colour')} style={hex ? { background: hex } : undefined}
    onClick={(e) => addColor(e.currentTarget)}></div>;
}
function Toolbar(): ReactElement {
  const v = useStore(toolsView);
  return (
    <div id="toolbar">
      {v.built ? (
        <>
          {TOOLS.map((t, i) => t.sep
            ? <div key={i} className="tb-sep"></div>
            : (
              <div key={t.id} className={t.id === v.tool ? 'tool on' : 'tool'} data-tool={t.id} title={`${t.name} (${t.key})`}
                {...pressableProps(t.name)} aria-pressed={t.id === v.tool} onClick={() => setTool(t.id)}>
                <Icon name={t.icon} size={18} />
              </div>
            ))}
          <div className="tb-sep"></div>
          <ToolbarColor />
        </>
      ) : null}
    </div>
  );
}

const cursorChip = (el: HTMLDivElement | null): void => { live.cursorChip = el; };

export function Stage(): ReactElement {
  return (
    <main id="stage" aria-label="Canvas">
      <canvas id="gl" role="img" aria-label="3D view of the model" ref={attachGL}></canvas>
      <canvas id="slice" role="img" aria-label="Drawing canvas" ref={attachSlice}></canvas>
      <canvas id="axes" width="70" height="70" ref={attachAxes}></canvas>
      <InfoChip />
      {/* The pointer's cell: written straight to the element on every move (core.ts setCursorChip). */}
      <div className="chip-float mono" id="cursor-chip" ref={cursorChip}></div>
      <Toolbar />
      <Toast />
    </main>
  );
}
