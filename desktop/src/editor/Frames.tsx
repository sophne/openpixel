/* The Frames panel under the canvas: the bar (fold, play, onion, duration, add, delete) and the strip of frame
   previews. */
import type { ReactElement } from 'react';
import { pressableProps, Stepper, useTitle } from '../kit';
import { $ } from '../lib/dom';
import { Icon } from '../lib/icons';
import { useStore } from '../lib/store';
import { S } from '../state/ui';
import { togglePlay } from './controls';
import { framesBar, framesView, panelsView, playView, thumbs, tool } from './core';
import { refresh, setActive } from './engine';
import { setFramesOpen } from './modes';
import { resetSize, startResize } from './resizers';

function FramesToggle(): ReactElement {
  const v = useStore(framesBar);
  // setFramesOpen() writes the title each time, as before (it starts as "Hide frames (F)").
  return (
    <button type="button" className="collapse-btn" id="frames-toggle" aria-expanded={v.open} aria-controls="strip" ref={useTitle<HTMLButtonElement>(v.title)}
      onClick={() => setFramesOpen($('#app').classList.contains('frames-closed'))}>
      <Icon name="chevron-down" className="chev" />
      <span className="title">Frames</span>
    </button>
  );
}
function PlayButton(): ReactElement {
  const { playing } = useStore(playView);
  return (
    <button className={playing ? 'btn small icon on' : 'btn small icon'} id="play" title="Play (↩)" onClick={togglePlay}>
      <Icon key={playing ? 'pause' : 'play'} name={playing ? 'pause' : 'play'} />
    </button>
  );
}
function OnionChip(): ReactElement {
  const { onion } = useStore(panelsView);
  return (
    <button className={onion ? 'chip on' : 'chip'} id="onion" title="Onion skin (O)" onClick={() => { S.onionOn = !S.onionOn; refresh(); }}>
      <Icon name="ghost" />
      <span className="lbl">Onion</span>
    </button>
  );
}
function FrameDelete(): ReactElement {
  const { frameDelOff } = useStore(panelsView);
  return (
    <button className="btn small icon" id="frame-del" title="Delete frame (⌥⌘⌫)" disabled={frameDelOff} onClick={() => { tool('delete_frame', { frame: S.frame }); }}>
      <Icon name="trash" />
    </button>
  );
}
const addFrame = (): void => { tool('add_frame', { after: S.frame, copy: true }); };

/** #strip: one card per frame and a + card. Each renderFrames() builds them anew (the key carries its count); the
 *  previews arrive later and are put into the <img>s by renderThumbs(). sizeThumbs() sets --thumb and `compact` on
 *  #strip by hand, so it has no className or style here. */
function Strip(): ReactElement {
  const v = useStore(framesView);
  return (
    <div id="strip">
      {v.frames.map((f, i) => (
        // Frames are numbered from 1 for people.
        <div key={`${v.n}:${i}`} className={'fr' + (i === v.frame ? ' on' : '')} title={`Frame ${i + 1} · ${f.duration_ms} ms`}
          {...pressableProps(`Frame ${i + 1}, ${f.duration_ms} milliseconds${i === v.frame ? ', selected' : ''}`)}
          onClick={() => { setActive({ frame: i }); }}>
          <div className="thumb"><img alt="" src={thumbs[i] || undefined} /></div><div className="lbl mono">{`${i + 1} · ${f.duration_ms}ms`}</div>
        </div>
      ))}
      {v.n > 0 ? (
        <div key={`${v.n}:add`} className="fr add" title="New frame" {...pressableProps('New frame')} onClick={addFrame}>
          <Icon name="plus" size={16} />
        </div>
      ) : null}
    </div>
  );
}

export function FramesPanel(): ReactElement {
  return (
    <section id="frames">
      <div className="resizer h" data-resize="bottom" onMouseDown={(e) => startResize(e.currentTarget, e)} onDoubleClick={(e) => resetSize(e.currentTarget)}></div>
      <div id="frames-bar">
        <FramesToggle />
        <PlayButton />
        <OnionChip />
        <span className="spacer"></span>
        <span className="muted lbl">Duration</span>
        <Stepper min={1} max={65535} stepSize={10} title="Frame duration" input={{ id: 'duration', 'aria-label': 'Frame duration in milliseconds', className: 'mono', inputMode: 'numeric' }}
          onCommit={(value) => { const v = parseInt(value, 10); if (v > 0) tool('set_frame_duration', { frame: S.frame, duration_ms: v }); }} />
        <span className="muted">ms</span>
        <button className="btn small icon" id="frame-add" title="New frame (⌥⌘N)" onClick={addFrame}>
          <Icon name="plus" />
        </button>
        <FrameDelete />
      </div>
      <Strip />
    </section>
  );
}
