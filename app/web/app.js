'use strict';
/* OpenPixel design canvas.
   The Swift engine owns the model; this page draws it (WebGL for 3D, a 2D canvas for slices), lets the
   person edit it, and shows what agents are doing. Every edit goes through the same tools agents use. */

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const bridge = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pc;
const SCREENSHOT = window.OPENPIXEL_SCREENSHOT === true || new URLSearchParams(location.search).has('screenshot');

async function call(name, args = {}) {
  if (!bridge) throw new Error('OpenPixel engine is not connected');
  return bridge.postMessage({ kind: 'tool', name, args });
}
function nativeAction(action, extra = {}) {
  return bridge ? bridge.postMessage({ kind: 'native', action, ...extra }) : Promise.resolve(null);
}

// Zoom levels (the classic pixel-editor steps from 1/64 to 64×); the 2D view uses the ones >= 1.
const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 48, 64];
// Canvas defaults: checkered 16x16 background in (128,128,128)/(192,192,192),
// pixel grid (200,200,200) at opacity 160, onion skin opacity 68 stepping by 28.
const CHECK = { size: 16, c1: '#808080', c2: '#c0c0c0' };
const PIXEL_GRID = 'rgba(200,200,200,';
const ONION = { base: 68, step: 28 };

const S = {
  sx: 32, sy: 32, sz: 32, palette: [], rgb: [], comp: new Uint8Array(0), act: new Uint8Array(0), onion: [],
  layers: [], frames: [], layer: 0, frame: 0, celsFilled: [], name: '', file: null, dirty: false,
  undo: 0, redo: 0, revision: -1,
  fg: 1, tool: 'pencil', brush: 1, mirror: { x: false, y: false, z: false },
  mode: '3d', axis: 'z', slice: 0, ghost: true, onionOn: false,
  edges: true, grid: true, ortho: false,
  // Lines between pixels on the 2D canvas; remembered between launches.
  pixelGrid: (() => { try { return localStorage.getItem('openpixel.pixelGrid') !== 'off'; } catch (e) { return true; } })(),
  previewYaw: 45, previewPitch: 30, previewScale: 3,
  playing: false, lastActivity: 0, hover: null,
};

const idx = (x, y, z) => (y * S.sz + z) * S.sx + x;
const inBounds = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < S.sx && y < S.sy && z < S.sz;

function toast(msg, agent = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('agent', agent);
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), agent ? 1800 : 2600);
}
const errorText = (e) => String(e && e.message ? e.message : e).replace(/^Error: /, '');

/* ---------------------------------------------------------------- tooltips
   The app draws its own tooltips, like the dock labels on the website (solid, not glass): a short name and the
   shortcut as key caps, above the control (below it when there is no room), the arrow pointing at the control.
   The first one waits a moment so moving across the toolbar doesn't flash labels; while one is showing, the next
   control's label appears at once and without animation. Leaving hides it at once. Titles in the markup feed it. */
const tipEl = document.createElement('div');
tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip');
let tipFor = null, tipTimer = 0, tipShownAt = 0, tipHiddenAt = 0;
function tipParts(text) {
  const m = text.match(/^([\s\S]*?)\s*\(([^()]{1,14})\)$/);
  const shortcut = m && /^[⌘⇧⌥⌃]*(\w|[[\]'+=,./↩⌫−←→↑↓-]|PgUp|PgDn|Tab|Space)$/.test(m[2]);
  if (!shortcut) return { label: text, keys: [] };
  const mods = m[2].match(/^[⌘⇧⌥⌃]*/)[0];
  return { label: m[1], keys: [...mods, m[2].slice(mods.length)] };
}
/** Moves an element's title into data-tip (no system tooltip), keeping an accessible name for icon buttons. */
function adoptTitle(el) {
  const t = el.getAttribute('title');
  el.removeAttribute('title');
  if (!t) return;
  el.dataset.tip = t;
  if (!el.getAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', tipParts(t).label);
}
function showTip(el, instant) {
  const { label, keys } = tipParts(el.dataset.tip || '');
  if (!label) return;
  tipEl.replaceChildren();
  const l = document.createElement('span'); l.textContent = label; tipEl.appendChild(l);
  if (keys.length) {
    const k = document.createElement('span'); k.className = 'keys';
    for (const key of keys) { const c = document.createElement('kbd'); c.textContent = key; k.appendChild(c); }
    tipEl.appendChild(k);
  }
  if (!tipEl.isConnected) document.body.appendChild(tipEl);
  tipEl.classList.add('on');
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const above = r.top - h - 10 >= 4;
  const cx = r.left + r.width / 2;
  const x = Math.max(6, Math.min(window.innerWidth - w - 6, cx - w / 2));
  const ax = Math.max(10, Math.min(w - 10, cx - x));
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(above ? r.top - h - 9 : r.bottom + 9)}px`;
  tipEl.style.setProperty('--ax', `${Math.round(ax)}px`);
  tipEl.dataset.side = above ? 'top' : 'bottom';
  tipShownAt = Date.now();
  if (!instant && tipEl.animate && !reducedMotion.matches) {
    tipEl.style.transformOrigin = `${Math.round(ax)}px ${above ? '100%' : '0%'}`;
    tipEl.animate([{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: EASE_OUT });
  }
}
function hideTip() {
  clearTimeout(tipTimer);
  if (tipEl.classList.contains('on')) tipHiddenAt = Date.now();
  tipEl.classList.remove('on');
  tipFor = null;
}
document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const el = e.target.closest('[title], [data-tip]');
  if (el && el.hasAttribute('title')) adoptTitle(el);
  if (!el || !el.dataset.tip || el === tipFor) return;
  const warm = tipEl.classList.contains('on') || Date.now() - tipHiddenAt < 400;
  hideTip();
  tipFor = el;
  tipTimer = setTimeout(() => { if (tipFor === el && el.isConnected) showTip(el, warm); }, warm ? 0 : 500);
});
document.addEventListener('pointerout', (e) => { if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip(); });
for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, () => { clearTimeout(tipTimer); if (tipFor) { tipEl.classList.remove('on'); tipFor = null; } }, true);
window.addEventListener('blur', hideTip);
// Give icon-only buttons their accessible names right away (titles move to data-tip on first hover anyway).
document.querySelectorAll('[title]').forEach(adoptTitle);

/* Copy buttons answer in place, like the website's: "Copy" cross-fades (with a touch of blur) to a check and "Copied",
   and back after a moment. Both labels share one grid cell, so the button keeps its width. */
function copyButton(btn, text) {
  btn.classList.add('swapper');
  btn.innerHTML = `<span class="swap">${icon('copy', 13)}Copy</span><span class="swap out">${icon('check', 13)}Copied</span>`;
  const [idle, done] = btn.children;
  const show = (copied) => {
    idle.classList.toggle('out', copied); done.classList.toggle('out', !copied);
    if (copied) btn.setAttribute('aria-label', 'Copied'); else btn.removeAttribute('aria-label');
  };
  btn.onclick = () => {
    nativeAction('copyText', { text: typeof text === 'function' ? text() : text });
    show(true);
    clearTimeout(btn.copyTimer);
    btn.copyTimer = setTimeout(() => show(false), 1500);
  };
}

/* ---------------------------------------------------------------- motion
   Popups grow out of whatever opened them: the point of the popup nearest the trigger is the transform origin,
   so a menu under a button grows down from the button, one that flips upward grows up, and the colour picker grows
   sideways from its swatch. Dialogs are not anchored to anything, so they grow from the centre. Only popups a pointer
   opened animate (keyboard use is constant and must feel instant), exits are instant, and reduced motion fades only. */
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastInput = 'pointer';
window.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
window.addEventListener('keydown', (e) => { if (!['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) lastInput = 'key'; }, true);

function originFrom(trigger, box) {
  box.getAnimations().forEach((a) => a.cancel()); // measure at full size, not mid-animation
  const t = trigger.getBoundingClientRect(), b = box.getBoundingClientRect();
  const x = Math.max(0, Math.min(b.width, t.left + t.width / 2 - b.left));
  const y = Math.max(0, Math.min(b.height, t.top + t.height / 2 - b.top));
  return `${Math.round(x)}px ${Math.round(y)}px`;
}
function popIn(el, origin = '50% 50%', { scale = 0.96, duration = 150 } = {}) {
  if (!el || !el.animate || lastInput !== 'pointer') return;
  el.getAnimations().forEach((a) => a.cancel());
  el.style.transformOrigin = origin;
  const still = reducedMotion.matches;
  el.animate(still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `scale(${scale})` }, { opacity: 1, transform: 'none' }],
    { duration: still ? 120 : duration, easing: EASE_OUT });
}

/* ---------------------------------------------------------------- icons (Lucide, ISC licence: web/LUCIDE-LICENSE.txt) */
function icon(name, size = 16) {
  const nodes = (window.LUCIDE || {})[name];
  if (!nodes) return '';
  const kids = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="i" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${kids}</svg>`;
}
function fillIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    const t = document.createElement('template');
    t.innerHTML = icon(el.dataset.icon);
    const svg = t.content.firstChild;
    if (svg && el.id) svg.id = el.id;
    if (svg && el.classList.length) svg.classList.add(...el.classList);
    if (svg) el.replaceWith(svg);
  });
}

const TOOLS = [
  { id: 'pencil', icon: 'pencil', name: 'Pencil', key: 'B', tip: 'Add pixels / voxels' },
  { id: 'eraser', icon: 'eraser', name: 'Eraser', key: 'E', tip: 'Remove from the active layer' },
  { id: 'recolor', icon: 'paintbrush', name: 'Recolour', key: 'R', tip: 'Paint what is already there' },
  { id: 'fill', icon: 'paint-bucket', name: 'Fill', key: 'G', tip: 'Fill connected cells of one colour' },
  { id: 'picker', icon: 'pipette', name: 'Eyedropper', key: 'I', tip: 'Pick a colour (or Alt+click)' },
  { sep: true },
  { id: 'rect', icon: 'square', name: 'Rectangle', key: 'U', tip: 'Drag a filled rectangle' },
  { id: 'line', icon: 'slash', name: 'Line', key: 'L', tip: 'Drag a straight line' },
  { id: 'move', icon: 'move', name: 'Move', key: 'V', tip: 'Move the active layer (arrow keys too)' },
  { id: 'orbit', icon: 'rotate-3d', name: 'Orbit / pan', key: 'H', tip: 'Turn the 3D camera or pan the canvas' },
];

/* ---------------------------------------------------------------- state from the engine */
function b64(s) {
  const bin = atob(s || '');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function hexToRgb(h) {
  if (!h || h === 'transparent') return [0, 0, 0];
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

let refreshing = false, refreshAgain = false;
async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const st = await call('ui_state', { onion: S.onionOn });
    applyState(st);
    refreshActivity();
  } catch (e) { toast(errorText(e)); }
  refreshing = false;
  if (refreshAgain) { refreshAgain = false; refresh(); }
}

function applyState(st) {
  const [sx, sy, sz] = st.size;
  const resized = sx !== S.sx || sy !== S.sy || sz !== S.sz || S.revision < 0;
  Object.assign(S, { sx, sy, sz });
  S.name = st.name; S.file = st.file; S.dirty = st.unsaved_changes;
  S.palette = st.palette; S.rgb = st.palette.map(hexToRgb);
  S.comp = b64(st.composite); S.act = b64(st.active_cel);
  S.onion = (st.onion || []).map((o) => ({ frame: o.frame, data: b64(o.data) }));
  S.layers = st.layers; S.frames = st.frames; S.layer = st.active_layer; S.frame = st.active_frame;
  S.celsFilled = st.cels_filled; S.undo = st.undo_steps; S.redo = st.redo_steps; S.revision = st.revision;
  if (S.fg >= S.palette.length) S.fg = Math.max(1, S.palette.length - 1);
  const sprite = sz === 1;
  const kindChanged = sprite !== S.isSprite;
  S.isSprite = sprite;
  if (resized || kindChanged) {
    resetCamera();
    if (kindChanged || S.revision < 0) {
      // 2D sprites open on the flat canvas with a front preview; 3D models open in the 3D view.
      S.previewYaw = sprite ? 0 : 45; S.previewPitch = sprite ? 0 : 30;
      setAxis('z');
      setMode(sprite ? 'slice' : '3d');
    }
    S.slice = Math.min(S.slice, sliceSize().depth - 1);
    fitSlice();
  }
  stroke = null;
  meshDirty = true; sliceDirty = true; render3dDirty = true;
  updatePanels();
  schedulePreview();
}

/* ---------------------------------------------------------------- panels */
function updatePanels() {
  renderPalette();
  renderLayers();
  renderFrames();
  $('#doc-name').textContent = S.name;
  $('#doc-kind').textContent = (S.isSprite ? `${S.sx}×${S.sy} sprite` : `${S.sx}×${S.sy}×${S.sz} model`) + (S.dirty ? ' · edited' : '');
  if (document.activeElement !== $('#duration')) $('#duration').value = S.frames[S.frame] ? S.frames[S.frame].duration_ms : 100;
  $('#undo').disabled = S.undo === 0;
  $('#redo').disabled = S.redo === 0;
  $('#onion').classList.toggle('on', S.onionOn);
  $('#layer-del').disabled = S.layers.length < 2;
  $('#layer-merge').disabled = S.layer === 0;
  $('#frame-del').disabled = S.frames.length < 2;
  updateViewPanel();
  updateInfoChip();
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function renderPalette() {
  const pal = $('#palette');
  pal.innerHTML = '';
  S.palette.forEach((hex, i) => {
    if (i === 0) return;
    const d = document.createElement('div');
    d.className = 'sw' + (i === S.fg ? ' on' : '');
    d.style.background = hex;
    d.title = hex;
    d.onclick = () => setFg(i);
    d.ondblclick = () => editColor(i, d);
    pal.appendChild(d);
  });
  if (S.palette.length < 256) {
    const add = document.createElement('div');
    add.className = 'sw add'; add.title = 'Add a colour'; add.innerHTML = icon('plus', 12);
    add.onclick = () => addColor(add);
    pal.appendChild(add);
  }
  updateFg();
}

function renderLayers() {
  const box = $('#layers');
  box.innerHTML = '';
  for (let li = S.layers.length - 1; li >= 0; li--) {
    const L = S.layers[li];
    const row = document.createElement('div');
    row.className = 'layer' + (li === S.layer ? ' on' : '') + (L.visible ? '' : ' hidden-layer');
    row.innerHTML = `<span class="lic">${icon(S.isSprite ? 'image' : 'box', 14)}</span><span class="lname"></span>` +
      `<span class="tog ${L.locked ? 'set' : ''}" title="Lock / unlock">${icon(L.locked ? 'lock' : 'lock-open', 14)}</span>` +
      `<span class="tog ${L.visible ? '' : 'set'}" title="Show / hide">${icon(L.visible ? 'eye' : 'eye-off', 14)}</span>`;
    const name = row.querySelector('.lname');
    name.textContent = L.name;
    name.title = 'Double-click to rename';
    const [lock, eye] = row.querySelectorAll('.tog');
    lock.onclick = (e) => { e.stopPropagation(); tool('set_layer', { layer: li, locked: !L.locked }); };
    eye.onclick = (e) => { e.stopPropagation(); tool('set_layer', { layer: li, visible: !L.visible }); };
    row.onclick = () => { if (li !== S.layer) setActive({ layer: li }); };
    name.ondblclick = (e) => { e.stopPropagation(); renameLayer(name, li); };
    box.appendChild(row);
  }
}

const thumbs = {};
let thumbTimer = null;
function renderFrames() {
  const strip = $('#strip');
  strip.innerHTML = '';
  S.frames.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'fr' + (i === S.frame ? ' on' : '');
    d.title = `Frame ${i + 1} · ${f.duration_ms} ms`;
    // Frames are numbered from 1 for people.
    d.innerHTML = `<div class="thumb"><img alt=""></div><div class="lbl mono">${i + 1} · ${f.duration_ms}ms</div>`;
    if (thumbs[i]) d.querySelector('img').src = thumbs[i];
    d.onclick = () => setActive({ frame: i });
    strip.appendChild(d);
  });
  const add = document.createElement('div');
  add.className = 'fr add'; add.title = 'New frame'; add.innerHTML = icon('plus', 16);
  add.onclick = () => tool('add_frame', { after: S.frame, copy: true });
  strip.appendChild(add);
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(renderThumbs, 250);
}
async function renderThumbs() {
  const count = Math.min(S.frames.length, 60);
  for (let i = 0; i < count; i++) {
    try {
      const r = await call('render_view', { frame: i, scale: S.isSprite ? 2 : 2, outline: !S.isSprite });
      if (r.images && r.images[0]) {
        thumbs[i] = r.images[0];
        const img = $$('#strip .fr .thumb img')[i];
        if (img) img.src = thumbs[i];
      }
    } catch (e) { return; }
  }
}

function updateInfoChip() {
  const names = { x: 'Side', y: 'Top', z: 'Front' };
  let t;
  if (S.mode === '3d') t = `3D · ${S.ortho ? 'orthographic' : 'perspective'}`;
  else if (S.isSprite) t = `Sprite · ${sv.zoom * 100}%`;
  else t = `${names[S.axis]} slice ${S.slice}/${sliceSize().depth - 1} · ${sv.zoom * 100}%`;
  $('#info-chip').textContent = t;
}
/* The Frames strip folds down to its bar (play, onion and duration stay at hand) to give the canvas more room. */
function setFramesOpen(open) {
  $('#app').classList.toggle('frames-closed', !open);
  const b = $('#frames-toggle');
  b.setAttribute('aria-expanded', String(open));
  b.title = open ? 'Hide frames (F)' : 'Show frames (F)';
  try { localStorage.setItem('openpixel.framesClosed', open ? '0' : '1'); } catch (e) { /* not remembered */ }
  render3dDirty = true; sliceDirty = true;
}
function setPixelGrid(on) {
  S.pixelGrid = on;
  $('#pixel-grid-btn').classList.toggle('on', on);
  try { localStorage.setItem('openpixel.pixelGrid', on ? 'on' : 'off'); } catch (e) { /* not remembered */ }
  sliceDirty = true;
}
function updateViewPanel() {
  const slice = S.mode === 'slice';
  $('#view-slice').hidden = !slice || S.isSprite;
  $('#view-sprite').hidden = !S.isSprite;
  $('#view-2d').hidden = !slice;
  $('#ghost-btn').hidden = S.isSprite; // a sprite has no slice behind it
  $('#view-3d').hidden = slice;
  $$('[data-axis]').forEach((b) => b.classList.toggle('on', b.dataset.axis === S.axis));
  $('#slice-index').textContent = `${S.slice}/${sliceSize().depth - 1}`;
  $('#zoom-label').textContent = `${sv.zoom * 100}%`;
  $$('[data-proj]').forEach((b) => b.classList.toggle('on', (b.dataset.proj === 'ortho') === S.ortho));
}

function setFg(i) {
  if (!i) return;
  S.fg = i;
  $$('#palette .sw').forEach((d, k) => d.classList.toggle('on', k + 1 === i));
  updateFg();
}
function updateFg() {
  const hex = S.palette[S.fg] || '#000000';
  $('#fg').style.background = hex;
  const tb = $('#tb-color');
  if (tb) tb.style.background = hex;
  if (document.activeElement !== $('#fg-hex')) $('#fg-hex').value = hex;
  $('#fg-index').textContent = `#${S.fg}`;
}
function editColor(i, anchor) {
  openPicker(anchor || $('#fg'), S.palette[i], 'Apply', (hex) => tool('set_palette_color', { index: i, color: hex }));
}
function addColor(anchor) {
  openPicker(anchor || $('#add-color'), S.palette[S.fg] || '#ff4a1c', 'Add', async (hex) => {
    const r = await tool('add_colors', { colors: [hex] });
    if (r && r.indexes) setFg(r.indexes[0]);
  });
}
function renameLayer(el, li) {
  const input = document.createElement('input');
  input.value = S.layers[li].name;
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
  let finished = false;
  const done = (ok) => {
    if (finished) return; finished = true;
    const v = input.value.trim();
    if (ok && v && v !== S.layers[li].name) tool('set_layer', { layer: li, name: v });
    else renderLayers();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
  input.onblur = () => done(true);
  input.onclick = (e) => e.stopPropagation();
}

async function tool(name, args = {}) {
  try { return await call(name, args); } catch (e) { toast(errorText(e)); return null; }
}
function setActive(a) { stopPlay(); return tool('set_active', a); }
function target() { return { layer: S.layer, frame: S.frame }; }

/* ---------------------------------------------------------------- colour picker */
const pk = { h: 0, s: 0, v: 0, onOk: null };
function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
const toHex = (rgb) => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');
function pickerHex() { return toHex(hsvToRgb(pk.h, pk.s, pk.v)); }
function drawPicker() {
  const c = $('#sv'), g = c.getContext('2d'), w = c.width, h = c.height;
  g.fillStyle = toHex(hsvToRgb(pk.h, 1, 1)); g.fillRect(0, 0, w, h);
  const white = g.createLinearGradient(0, 0, w, 0); white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = white; g.fillRect(0, 0, w, h);
  const black = g.createLinearGradient(0, 0, 0, h); black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
  g.fillStyle = black; g.fillRect(0, 0, w, h);
  g.lineWidth = 3; g.strokeStyle = '#fff';
  g.beginPath(); g.arc(pk.s * w, (1 - pk.v) * h, 9, 0, Math.PI * 2); g.stroke();
  const hex = pickerHex();
  $('#pk-swatch').style.background = hex;
  if (document.activeElement !== $('#pk-hex')) $('#pk-hex').value = hex;
  $('#hue').value = pk.h;
}
function setPickerHex(hex) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) return false;
  let s = m[1];
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const v = parseInt(s, 16);
  [pk.h, pk.s, pk.v] = rgbToHsv((v >> 16) & 255, (v >> 8) & 255, v & 255);
  drawPicker();
  return true;
}
function openPicker(anchor, hex, okLabel, onOk) {
  const p = $('#picker');
  pk.onOk = onOk;
  $('#pk-ok').textContent = okLabel;
  setPickerHex(hex && hex !== 'transparent' ? hex : '#ff4a1c');
  p.hidden = false;
  const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let left = r.left - pw - 10, top = r.top;
  if (left < 8) left = Math.min(window.innerWidth - pw - 8, r.right + 10);
  top = Math.max(8, Math.min(window.innerHeight - ph - 8, top));
  p.style.left = left + 'px'; p.style.top = top + 'px';
  popIn(p, originFrom(anchor, p), { duration: 170 });
  if (lastInput === 'key') $('#pk-hex').focus();
}
function closePicker() { $('#picker').hidden = true; pk.onOk = null; }
function wirePicker() {
  const sv = $('#sv');
  const setFromMouse = (e) => {
    const r = sv.getBoundingClientRect();
    pk.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    pk.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    drawPicker();
  };
  let dragging = false;
  sv.addEventListener('mousedown', (e) => { dragging = true; setFromMouse(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) setFromMouse(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  $('#hue').addEventListener('input', () => { pk.h = +$('#hue').value; drawPicker(); });
  $('#pk-hex').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { if (setPickerHex($('#pk-hex').value)) $('#pk-ok').click(); }
    if (e.key === 'Escape') closePicker();
  });
  $('#pk-hex').addEventListener('input', () => setPickerHex($('#pk-hex').value));
  $('#pk-cancel').onclick = closePicker;
  $('#pk-ok').onclick = () => { const f = pk.onOk, hex = pickerHex(); closePicker(); if (f) f(hex); };
  document.addEventListener('mousedown', (e) => {
    if ($('#picker').hidden || $('#picker').contains(e.target)) return;
    if (e.target.closest('#palette, #add-color, #fg, #tb-color')) return;
    closePicker();
  });
}

/* ---------------------------------------------------------------- activity (who did what) */
async function refreshActivity() {
  let act;
  try { act = (await call('ui_activity')).activity || []; } catch (e) { return; }
  const box = $('#activity');
  box.innerHTML = '';
  const now = Date.now() / 1000;
  act.slice().reverse().forEach((e) => {
    const d = document.createElement('div');
    d.className = 'act' + (e.ok ? '' : ' bad');
    const ago = Math.max(0, Math.round(now - e.time));
    const when = ago < 60 ? `${ago}s` : ago < 3600 ? `${Math.round(ago / 60)}m` : `${Math.round(ago / 3600)}h`;
    const who = e.source === 'agent' ? 'agent' : e.source === 'person' ? 'you' : e.source;
    d.innerHTML = `<span class="who ${e.source === 'agent' ? 'agent' : ''}">${escapeHtml(who)}</span>` +
      `<span class="tool-name mono"></span><span class="spacer"></span><span class="muted mono">${when}</span>`;
    d.querySelector('.tool-name').textContent = e.tool;
    if (e.note) d.title = e.note;
    box.appendChild(d);
  });
  const agentCalls = act.filter((e) => e.source === 'agent').length;
  $('#activity-count').textContent = agentCalls ? `${agentCalls} agent call${agentCalls > 1 ? 's' : ''}` : '';
  const last = act[act.length - 1];
  if (last && last.time > S.lastActivity) {
    if (last.source === 'agent' && S.lastActivity) toast(`Agent: ${last.tool}`, true);
    S.lastActivity = last.time;
  }
}

/* ---------------------------------------------------------------- pixel-art preview (rendered by the engine) */
let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const r = await call('render_view', { yaw: S.previewYaw, pitch: S.previewPitch, scale: S.previewScale, frame: S.frame });
      if (r.images && r.images[0]) {
        const img = $('#preview');
        img.onload = () => { img.style.width = (img.naturalWidth * 2 / Math.max(1, window.devicePixelRatio || 1)) + 'px'; };
        img.src = r.images[0];
      }
    } catch (e) { /* the preview is optional */ }
    const names = { '45,30': 'iso', '0,0': 'front', '90,0': 'right', '180,0': 'back', '270,0': 'left' };
    $$('[data-pview]').forEach((b) => b.classList.toggle('on', (b.dataset.pview === 'front') === (S.previewPitch === 0 && S.previewYaw % 360 === 0)));
    $('#preview-angle').textContent = names[`${S.previewYaw % 360},${S.previewPitch}`] || `${S.previewYaw % 360}°`;
  }, 120);
}

/* ---------------------------------------------------------------- 3D view (WebGL2) */
const glCanvas = $('#gl');
const gl = glCanvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false });
let meshDirty = true, render3dDirty = true;
const cam = { yaw: 45, pitch: 30, dist: 60, tx: 16, ty: 10, tz: 16 };

const VS = `#version 300 es
in vec3 aPos; in vec4 aCol; in vec2 aUV;
uniform mat4 uMVP; uniform float uAlpha;
out vec4 vCol; out vec2 vUV;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vCol = vec4(aCol.rgb, aCol.a * uAlpha); vUV = aUV; }`;
const FS = `#version 300 es
precision highp float;
in vec4 vCol; in vec2 vUV; uniform float uEdges; out vec4 o;
void main() {
  vec4 c = vCol;
  if (uEdges > 0.5) {
    vec2 d = min(vUV, 1.0 - vUV);
    float e = min(d.x, d.y);
    float w = fwidth(e) * 1.4;
    c.rgb *= mix(0.74, 1.0, smoothstep(0.0, w, e));
  }
  o = c;
}`;

let prog, loc, meshBuf, ghostBufs = [], lineBufs = {};
function initGL() {
  if (!gl) { toast('WebGL 2 is not available; use the Slice view'); return; }
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  loc = {
    pos: gl.getAttribLocation(prog, 'aPos'), col: gl.getAttribLocation(prog, 'aCol'), uv: gl.getAttribLocation(prog, 'aUV'),
    mvp: gl.getUniformLocation(prog, 'uMVP'), alpha: gl.getUniformLocation(prog, 'uAlpha'), edges: gl.getUniformLocation(prog, 'uEdges'),
  };
  meshBuf = makeMeshBuffers();
}
function makeMeshBuffers() {
  return { pos: gl.createBuffer(), col: gl.createBuffer(), uv: gl.createBuffer(), idx: gl.createBuffer(), count: 0 };
}

// Faces with their corner offsets and a fixed light: top brightest, bottom darkest (reads like pixel art).
const FACES = [
  { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], s: 0.80 },
  { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], s: 0.90 },
  { n: [0, 1, 0], v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0 },
  { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.55 },
  { n: [0, 0, 1], v: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], s: 0.94 },
  { n: [0, 0, -1], v: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], s: 0.72 },
];
const CORNER_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];

function buildMesh(grid, buf, alpha = 255) {
  const { sx, sy, sz } = S;
  const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && grid[(y * sz + z) * sx + x] !== 0;
  let faces = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    if (!grid[(y * sz + z) * sx + x]) continue;
    for (const f of FACES) if (!solid(x + f.n[0], y + f.n[1], z + f.n[2])) faces++;
  }
  const pos = new Float32Array(faces * 12), col = new Uint8Array(faces * 16), uv = new Uint8Array(faces * 8);
  const ind = new Uint32Array(faces * 6);
  let k = 0;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const v = grid[(y * sz + z) * sx + x];
    if (!v) continue;
    const rgb = S.rgb[v] || [255, 0, 255];
    for (const f of FACES) {
      if (solid(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
      for (let c = 0; c < 4; c++) {
        const p = k * 4 + c;
        pos[p * 3] = x + f.v[c][0]; pos[p * 3 + 1] = y + f.v[c][1]; pos[p * 3 + 2] = z + f.v[c][2];
        col[p * 4] = rgb[0] * f.s; col[p * 4 + 1] = rgb[1] * f.s; col[p * 4 + 2] = rgb[2] * f.s; col[p * 4 + 3] = alpha;
        uv[p * 2] = CORNER_UV[c][0]; uv[p * 2 + 1] = CORNER_UV[c][1];
      }
      const b = k * 4;
      ind[k * 6] = b; ind[k * 6 + 1] = b + 1; ind[k * 6 + 2] = b + 2; ind[k * 6 + 3] = b; ind[k * 6 + 4] = b + 2; ind[k * 6 + 5] = b + 3;
      k++;
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.col); gl.bufferData(gl.ARRAY_BUFFER, col, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf.uv); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.DYNAMIC_DRAW);
  buf.count = ind.length;
}

function lineBuffer(name, points) {
  if (!gl) return;
  if (!lineBufs[name]) lineBufs[name] = { buf: gl.createBuffer(), count: 0 };
  const lb = lineBufs[name];
  gl.bindBuffer(gl.ARRAY_BUFFER, lb.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
  lb.count = points.length / 3;
}
function boxLines(x0, y0, z0, x1, y1, z1) {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return e.flatMap(([a, b]) => [...c[a], ...c[b]]);
}
function buildStaticLines() {
  const pts = [];
  for (let x = 0; x <= S.sx; x++) pts.push(x, 0, 0, x, 0, S.sz);
  for (let z = 0; z <= S.sz; z++) pts.push(0, 0, z, S.sx, 0, z);
  lineBuffer('grid', pts);
  lineBuffer('box', boxLines(0, 0, 0, S.sx, S.sy, S.sz));
}

// --- small matrix kit (column-major, like WebGL)
const M = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fovy, asp, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  },
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt(e, c, u) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const f = norm(sub(c, e)), s = norm(cross(f, u)), uu = cross(s, f);
    return new Float32Array([s[0], uu[0], -f[0], 0, s[1], uu[1], -f[1], 0, s[2], uu[2], -f[2], 0, -dot(s, e), -dot(uu, e), dot(f, e), 1]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    det = det ? 1 / det : 0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
  apply(m, v) {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
    return o;
  },
};

function resetCamera() {
  const m = Math.max(S.sx, S.sy, S.sz);
  Object.assign(cam, { yaw: 45, pitch: 30, dist: m * 2.3, tx: S.sx / 2, ty: S.sy * 0.32, tz: S.sz / 2 });
  render3dDirty = true;
  buildStaticLines();
}
function eye() {
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  return [cam.tx + cam.dist * Math.sin(y) * Math.cos(p), cam.ty + cam.dist * Math.sin(p), cam.tz + cam.dist * Math.cos(y) * Math.cos(p)];
}
let VP = null;
function viewProj() {
  const w = glCanvas.clientWidth || 1, h = glCanvas.clientHeight || 1, asp = w / h;
  const view = M.lookAt(eye(), [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
  const far = cam.dist * 6 + 500;
  let proj;
  if (S.ortho) {
    const hh = cam.dist * Math.tan(20 * Math.PI / 180);
    proj = M.ortho(-hh * asp, hh * asp, -hh, hh, -far, far);
  } else proj = M.persp(40 * Math.PI / 180, asp, 0.1, far);
  return M.mul(proj, view);
}

function resizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}

function draw3d() {
  if (!gl) return;
  if (resizeCanvas(glCanvas)) render3dDirty = true;
  if (meshDirty) {
    buildMesh(S.comp, meshBuf);
    while (ghostBufs.length < S.onion.length) ghostBufs.push(makeMeshBuffers());
    S.onion.forEach((o, i) => buildMesh(o.data, ghostBufs[i], 255));
    if (!lineBufs.grid) buildStaticLines();
    meshDirty = false; render3dDirty = true;
  }
  if (!render3dDirty) return;
  render3dDirty = false;
  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.clearColor(0x1e / 255, 0x1e / 255, 0x1e / 255, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  VP = viewProj();
  gl.uniformMatrix4fv(loc.mvp, false, VP);

  const drawMesh = (b, alpha, edges) => {
    if (!b.count) return;
    gl.uniform1f(loc.alpha, alpha); gl.uniform1f(loc.edges, edges ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.pos); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.col); gl.enableVertexAttribArray(loc.col); gl.vertexAttribPointer(loc.col, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.uv); gl.enableVertexAttribArray(loc.uv); gl.vertexAttribPointer(loc.uv, 2, gl.UNSIGNED_BYTE, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
    gl.drawElements(gl.TRIANGLES, b.count, gl.UNSIGNED_INT, 0);
  };
  const drawLines = (name, rgba) => {
    const lb = lineBufs[name];
    if (!lb || !lb.count) return;
    gl.uniform1f(loc.alpha, 1); gl.uniform1f(loc.edges, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, lb.buf); gl.enableVertexAttribArray(loc.pos); gl.vertexAttribPointer(loc.pos, 3, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(loc.col); gl.vertexAttrib4f(loc.col, rgba[0], rgba[1], rgba[2], rgba[3]);
    gl.disableVertexAttribArray(loc.uv); gl.vertexAttrib2f(loc.uv, 0.5, 0.5);
    gl.drawArrays(gl.LINES, 0, lb.count);
  };

  gl.disable(gl.BLEND);
  drawMesh(meshBuf, 1, S.edges);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (S.grid) {
    gl.depthMask(false);
    drawLines('grid', [200 / 255, 200 / 255, 200 / 255, 0.10]);
    drawLines('box', [200 / 255, 200 / 255, 200 / 255, 0.28]);
    gl.depthMask(true);
  }
  // Onion skin: neighbouring frames, faded (opacity 68 for the nearest frame).
  if (S.onionOn) {
    gl.depthMask(false);
    S.onion.forEach((o, i) => drawMesh(ghostBufs[i], ONION.base / 255, false));
    gl.depthMask(true);
  }
  if (lineBufs.cursor && lineBufs.cursor.count) {
    gl.disable(gl.DEPTH_TEST);
    drawLines('cursor', [1, 0x4a / 255, 0x1c / 255, 0.95]);
    gl.enable(gl.DEPTH_TEST);
  }
  drawAxes();
}

function drawAxes() {
  const c = $('#axes'), g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  if (S.mode !== '3d') return;
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const v = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  // screen-up vector, negated because canvas y grows downward
  const up = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  const axes = [['X', [1, 0, 0], '#d95763'], ['Y', [0, 1, 0], '#6abe30'], ['Z', [0, 0, 1], '#5b6ee1']];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  axes.sort((a, b) => dot(a[1], v) - dot(b[1], v));
  g.lineWidth = 2; g.font = 'bold 10px -apple-system, sans-serif';
  for (const [name, a, col] of axes) {
    const px = dot(a, r), py = -dot(a, up);
    g.strokeStyle = col; g.fillStyle = col;
    g.beginPath(); g.moveTo(35, 35); g.lineTo(35 + px * 22, 35 + py * 22); g.stroke();
    g.fillText(name, 32 + px * 30, 39 + py * 30);
  }
}

/* --- picking: a ray from the mouse through the grid */
function ray(mx, my) {
  const w = glCanvas.clientWidth, h = glCanvas.clientHeight;
  const inv = M.invert(VP || viewProj());
  const nx = 2 * mx / w - 1, ny = 1 - 2 * my / h;
  const a = M.apply(inv, [nx, ny, -1, 1]), b = M.apply(inv, [nx, ny, 1, 1]);
  const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]], l = Math.hypot(d[0], d[1], d[2]);
  return { o, d: d.map((t) => t / l) };
}
function castGrid(r, grid) {
  const size = [S.sx, S.sy, S.sz];
  let tmin = 0, tmax = Infinity, axis = -1;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(r.d[k]) < 1e-12) { if (r.o[k] < 0 || r.o[k] > size[k]) return null; continue; }
    let t1 = -r.o[k] / r.d[k], t2 = (size[k] - r.o[k]) / r.d[k];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) { tmin = t1; axis = k; }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  const p = r.o.map((o, k) => o + r.d[k] * (tmin + 1e-6));
  const c = p.map((v, k) => Math.min(Math.max(Math.floor(v), 0), size[k] - 1));
  const step = r.d.map((d) => (d > 0 ? 1 : -1));
  const tDelta = r.d.map((d) => (Math.abs(d) < 1e-12 ? Infinity : Math.abs(1 / d)));
  const tMax = r.d.map((d, k) => (Math.abs(d) < 1e-12 ? Infinity : ((c[k] + (step[k] > 0 ? 1 : 0)) - r.o[k]) / d));
  for (let guard = 0; guard < 2000; guard++) {
    if (grid[idx(c[0], c[1], c[2])]) {
      const n = [0, 0, 0];
      if (axis >= 0) n[axis] = -step[axis]; else n[1] = 1;
      return { x: c[0], y: c[1], z: c[2], n };
    }
    const k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    c[k] += step[k]; tMax[k] += tDelta[k]; axis = k;
    if (c[k] < 0 || c[k] >= size[k]) return null;
  }
  return null;
}
function groundHit(r) {
  if (r.d[1] >= -1e-6) return null;
  const t = -r.o[1] / r.d[1];
  const x = Math.floor(r.o[0] + r.d[0] * t), z = Math.floor(r.o[2] + r.d[2] * t);
  return inBounds(x, 0, z) ? { x, y: 0, z, n: [0, 1, 0], ground: true } : null;
}
/** Where a click lands: the voxel under the mouse (`hit`) and the empty cell in front of it (`place`). */
function pick(mx, my, grid = S.comp) {
  const r = ray(mx, my);
  const hit = castGrid(r, grid);
  if (hit) {
    const place = [hit.x + hit.n[0], hit.y + hit.n[1], hit.z + hit.n[2]];
    return { hit, place: inBounds(place[0], place[1], place[2]) ? place : null, n: hit.n, ray: r };
  }
  const g = groundHit(r);
  return g ? { hit: null, place: [g.x, 0, g.z], n: g.n, ray: r } : null;
}
function planeCell(r, axis, cell) {
  const k = axis, v = cell + 0.5;
  if (Math.abs(r.d[k]) < 1e-9) return null;
  const t = (v - r.o[k]) / r.d[k];
  if (t < 0) return null;
  const p = r.o.map((o, i) => Math.floor(o + r.d[i] * t));
  p[k] = cell;
  return p;
}

/* ---------------------------------------------------------------- slice view (2D, like a sprite) */
const sliceCanvas = $('#slice');
const sctx = sliceCanvas.getContext('2d');
const sv = { zoom: 16, panX: 0, panY: 0 };
let sliceDirty = true;

function sliceSize(axis = S.axis) {
  if (axis === 'y') return { cols: S.sx, rows: S.sz, depth: S.sy };
  if (axis === 'x') return { cols: S.sz, rows: S.sy, depth: S.sx };
  return { cols: S.sx, rows: S.sy, depth: S.sz };
}
function sliceCell(col, row, k = S.slice, axis = S.axis) {
  if (axis === 'y') return [col, k, row];
  if (axis === 'x') return [k, S.sy - 1 - row, col];
  return [col, S.sy - 1 - row, k];
}
function fitSlice() {
  const { cols, rows } = sliceSize();
  const w = sliceCanvas.clientWidth || 800, h = sliceCanvas.clientHeight || 500;
  let z = ZOOMS[0];
  for (const l of ZOOMS) if (cols * l <= w * 0.86 && rows * l <= h * 0.86) z = l;
  sv.zoom = z;
  sv.panX = Math.round((w - cols * z) / 2); sv.panY = Math.round((h - rows * z) / 2);
  sliceDirty = true;
  updateSliceLabel();
}
function updateSliceLabel() {
  updateViewPanel();
  updateInfoChip();
}

let sliceImage = null;
function drawSlice() {
  if (S.mode !== 'slice') return;
  if (resizeCanvas(sliceCanvas)) sliceDirty = true;
  if (!sliceDirty) return;
  sliceDirty = false;
  const dpr = window.devicePixelRatio || 1;
  const g = sctx;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#1e1e1e';
  g.fillRect(0, 0, sliceCanvas.clientWidth, sliceCanvas.clientHeight);
  const { cols, rows } = sliceSize();
  const z = sv.zoom, ox = sv.panX, oy = sv.panY;
  // checkered background (16x16 cells, grey 128/192)
  for (let cy = 0; cy < rows; cy += CHECK.size) for (let cx = 0; cx < cols; cx += CHECK.size) {
    g.fillStyle = ((cx + cy) / CHECK.size) % 2 ? CHECK.c2 : CHECK.c1;
    g.fillRect(ox + cx * z, oy + cy * z, Math.min(CHECK.size, cols - cx) * z, Math.min(CHECK.size, rows - cy) * z);
  }
  // cells -> a small image, scaled up without smoothing
  if (!sliceImage || sliceImage.width !== cols || sliceImage.height !== rows) {
    sliceImage = document.createElement('canvas'); sliceImage.width = cols; sliceImage.height = rows;
  }
  const ig = sliceImage.getContext('2d');
  const data = ig.createImageData(cols, rows);
  const px = data.data;
  const behind = [];
  if (S.onionOn) S.onion.forEach((o) => behind.push({ grid: o.data, k: S.slice, a: ONION.base / 255, tint: o.frame < S.frame ? [255, 120, 120] : [120, 150, 255] }));
  if (S.ghost && S.slice > 0) behind.push({ grid: S.comp, k: S.slice - 1, a: 0.22, tint: null });
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = sliceCell(c, r);
    const v = S.comp[idx(cell[0], cell[1], cell[2])];
    const p = (r * cols + c) * 4;
    if (v) { const rgb = S.rgb[v]; px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = 255; continue; }
    for (const L of behind) {
      const gc = sliceCell(c, r, L.k);
      const gv = L.grid[idx(gc[0], gc[1], gc[2])];
      if (!gv) continue;
      let rgb = S.rgb[gv];
      if (L.tint) rgb = rgb.map((t, i) => (t + L.tint[i]) / 2);
      px[p] = rgb[0]; px[p + 1] = rgb[1]; px[p + 2] = rgb[2]; px[p + 3] = Math.round(L.a * 255);
      break;
    }
  }
  ig.putImageData(data, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(sliceImage, ox, oy, cols * z, rows * z);
  // pixel grid, fading in as you zoom in (the Grid button in the View panel turns it off)
  if (S.pixelGrid && z >= 6) {
    const a = Math.min(160, (z - 4) * 14) / 255;
    g.strokeStyle = PIXEL_GRID + a + ')'; g.lineWidth = 1 / dpr;
    g.beginPath();
    for (let c = 0; c <= cols; c++) { g.moveTo(ox + c * z, oy); g.lineTo(ox + c * z, oy + rows * z); }
    for (let r = 0; r <= rows; r++) { g.moveTo(ox, oy + r * z); g.lineTo(ox + cols * z, oy + r * z); }
    g.stroke();
  }
  g.strokeStyle = '#000'; g.lineWidth = 1;
  g.strokeRect(ox - 0.5, oy - 0.5, cols * z + 1, rows * z + 1);
  if (S.hover && S.hover.slice) {
    const [c, r] = S.hover.slice;
    const b = S.brush, o = Math.floor((b - 1) / 2);
    g.strokeStyle = '#ff4a1c'; g.lineWidth = 2;
    g.strokeRect(ox + (c - o) * z, oy + (r - o) * z, b * z, b * z);
  }
}

/* ---------------------------------------------------------------- strokes (local preview, one engine call at the end) */
let stroke = null;

function mirrored(cells) {
  const out = new Map();
  for (const [x, y, z] of cells) {
    const xs = S.mirror.x ? [x, S.sx - 1 - x] : [x], ys = S.mirror.y ? [y, S.sy - 1 - y] : [y], zs = S.mirror.z ? [z, S.sz - 1 - z] : [z];
    for (const a of xs) for (const b of ys) for (const c of zs) if (inBounds(a, b, c)) out.set(idx(a, b, c), [a, b, c]);
  }
  return [...out.values()];
}
function planeAxes(axis) { return [0, 1, 2].filter((k) => k !== axis); }
function squareOnPlane(cell, axis) {
  const b = S.brush, o = Math.floor((b - 1) / 2), cells = [];
  const [u, v] = planeAxes(axis);
  for (let i = 0; i < b; i++) for (let j = 0; j < b; j++) {
    const p = cell.slice(); p[u] += i - o; p[v] += j - o; cells.push(p);
  }
  return cells;
}
function lineOnPlane(a, b, axis) {
  const [u, v] = planeAxes(axis);
  const du = b[u] - a[u], dv = b[v] - a[v], n = Math.max(Math.abs(du), Math.abs(dv), 1), out = [];
  for (let i = 0; i <= n; i++) {
    const p = a.slice(); p[u] = Math.round(a[u] + du * i / n); p[v] = Math.round(a[v] + dv * i / n);
    out.push(...squareOnPlane(p, axis));
  }
  return out;
}
function rectOnPlane(a, b, axis) {
  const [u, v] = planeAxes(axis), out = [];
  for (let i = Math.min(a[u], b[u]); i <= Math.max(a[u], b[u]); i++)
    for (let j = Math.min(a[v], b[v]); j <= Math.max(a[v], b[v]); j++) { const p = a.slice(); p[u] = i; p[v] = j; out.push(p); }
  return out;
}

function beginStroke(kind, start, axis) {
  stroke = { kind, start, axis, last: start, cells: new Map(), baseComp: S.comp.slice(), baseAct: S.act.slice(), move: [0, 0, 0] };
}
function strokeTo(cell) {
  if (!stroke || !cell) return;
  const s = stroke;
  if (s.kind === 'rect' || s.kind === 'line') {
    s.cells.clear();
    const list = s.kind === 'rect' ? rectOnPlane(s.start, cell, s.axis) : lineOnPlane(s.start, cell, s.axis);
    for (const p of mirrored(list)) s.cells.set(idx(p[0], p[1], p[2]), p);
  } else if (s.kind === 'move') {
    s.move = [cell[0] - s.start[0], cell[1] - s.start[1], cell[2] - s.start[2]];
  } else {
    for (const p of mirrored(lineOnPlane(s.last, cell, s.axis))) {
      const i = idx(p[0], p[1], p[2]);
      if ((s.kind === 'erase' || s.kind === 'recolor') && !s.baseAct[i]) continue;
      s.cells.set(i, p);
    }
  }
  s.last = cell;
  applyStrokePreview();
}
function applyStrokePreview() {
  const s = stroke;
  S.comp = s.baseComp.slice(); S.act = s.baseAct.slice();
  if (s.kind === 'move') {
    // Show the active layer shifted (other layers stay put).
    const [dx, dy, dz] = s.move;
    for (let i = 0; i < s.baseAct.length; i++) if (s.baseAct[i] && S.comp[i] === s.baseAct[i]) S.comp[i] = 0;
    for (let y = 0; y < S.sy; y++) for (let z = 0; z < S.sz; z++) for (let x = 0; x < S.sx; x++) {
      const v = s.baseAct[idx(x, y, z)];
      if (v && inBounds(x + dx, y + dy, z + dz)) S.comp[idx(x + dx, y + dy, z + dz)] = v;
    }
  } else {
    const v = s.kind === 'erase' ? 0 : S.fg;
    for (const i of s.cells.keys()) { S.comp[i] = v; S.act[i] = v; }
  }
  meshDirty = true; sliceDirty = true;
}
async function endStroke() {
  const s = stroke;
  if (!s) return;
  const cells = [...s.cells.values()];
  try {
    if (s.kind === 'move') {
      const [dx, dy, dz] = s.move;
      if (dx || dy || dz) await call('transform', { op: 'move', dx, dy, dz, ...target() });
    } else if (cells.length) {
      if (s.kind === 'erase') await call('erase_voxels', { voxels: cells, ...target() });
      else await call('set_voxels', { voxels: cells, color: S.fg, mode: s.kind === 'recolor' ? 'paint' : 'replace', ...target() });
    }
  } catch (e) { toast(errorText(e)); }
  stroke = null;
  refresh();
}

/* ---------------------------------------------------------------- mouse: 3D view */
let drag = null, spaceDown = false;
function stageXY(e, el) { const r = el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

glCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
glCanvas.addEventListener('mousedown', (e) => {
  const [mx, my] = stageXY(e, glCanvas);
  if (e.button === 2 || e.button === 1 || S.tool === 'orbit' || spaceDown) {
    drag = { kind: (e.button === 1 || e.shiftKey) ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
    return;
  }
  if (e.button !== 0) return;
  const p = pick(mx, my);
  const toolId = e.altKey ? 'picker' : S.tool;
  if (toolId === 'picker') { if (p && p.hit) setFg(S.comp[idx(p.hit.x, p.hit.y, p.hit.z)]); return; }
  if (toolId === 'fill') {
    if (p) tool('flood_fill', { at: p.hit ? [p.hit.x, p.hit.y, p.hit.z] : p.place, color: S.fg, ...target() });
    return;
  }
  if (S.layers[S.layer] && S.layers[S.layer].locked) { toast('This layer is locked'); return; }
  if (toolId === 'eraser' || toolId === 'recolor') {
    const pa = pick(mx, my, S.act);
    if (!pa || !pa.hit) { toast('Nothing of the active layer here'); return; }
    const axis = pa.n.findIndex((v) => v !== 0);
    const cell = [pa.hit.x, pa.hit.y, pa.hit.z];
    beginStroke(toolId === 'eraser' ? 'erase' : 'recolor', cell, axis);
    stroke.planeValue = cell[axis];
    strokeTo(cell);
  } else if (p && p.place) {
    const axis = p.n.findIndex((v) => v !== 0);
    const kind = toolId === 'pencil' ? 'add' : toolId;
    beginStroke(kind, p.place, axis);
    stroke.planeValue = p.place[axis];
    if (kind !== 'move') strokeTo(p.place);
  } else return;
  drag = { kind: 'tool' };
});
window.addEventListener('mousemove', (e) => {
  if (S.mode !== '3d') return;
  const [mx, my] = stageXY(e, glCanvas);
  if (drag && (drag.kind === 'orbit' || drag.kind === 'pan')) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.kind === 'orbit') {
      cam.yaw -= dx * 0.4; cam.pitch = Math.max(-89, Math.min(89, cam.pitch + dy * 0.4));
    } else panCamera(dx, dy);
    render3dDirty = true;
    return;
  }
  if (drag && drag.kind === 'tool' && stroke) {
    const cell = planeCell(ray(mx, my), stroke.axis, stroke.planeValue);
    if (cell && inBounds(cell[0], cell[1], cell[2])) strokeTo(cell);
  }
  updateHover3d(mx, my);
});
window.addEventListener('mouseup', () => {
  if (drag && drag.kind === 'tool') endStroke();
  drag = null;
});
glCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || Math.abs(e.deltaX) < 0.01) {
    cam.dist = Math.max(3, Math.min(2000, cam.dist * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
  } else {
    cam.yaw -= e.deltaX * 0.25;
  }
  render3dDirty = true;
}, { passive: false });
function panCamera(dx, dy) {
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const up = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  const k = cam.dist / (glCanvas.clientHeight || 600) * 0.75;
  cam.tx += (-dx * r[0] + dy * up[0]) * k; cam.ty += (-dx * r[1] + dy * up[1]) * k; cam.tz += (-dx * r[2] + dy * up[2]) * k;
}
function updateHover3d(mx, my) {
  if (!gl) return;
  const rect = glCanvas.getBoundingClientRect();
  if (mx < 0 || my < 0 || mx > rect.width || my > rect.height) return;
  const p = pick(mx, my, (S.tool === 'eraser' || S.tool === 'recolor') ? S.act : S.comp);
  let cell = null;
  if (p) {
    if (['eraser', 'recolor', 'picker', 'fill'].includes(S.tool) && p.hit) cell = [p.hit.x, p.hit.y, p.hit.z];
    else if (p.place) cell = p.place;
  }
  const key = cell ? cell.join(',') : '';
  if (key !== (S.hover && S.hover.key)) {
    S.hover = cell ? { key, cell } : null;
    if (cell) {
      const axis = p.n.findIndex((v) => v !== 0);
      const cells = ['pencil', 'eraser', 'recolor'].includes(S.tool) ? squareOnPlane(cell, axis) : [cell];
      lineBuffer('cursor', cells.flatMap((c) => boxLines(c[0] - 0.01, c[1] - 0.01, c[2] - 0.01, c[0] + 1.01, c[1] + 1.01, c[2] + 1.01)));
    } else lineBuffer('cursor', []);
    render3dDirty = true;
    $('#cursor-chip').textContent = cell ? `x ${cell[0]}  y ${cell[1]}  z ${cell[2]}` : '';
  }
}

/* ---------------------------------------------------------------- mouse: slice view */
let sdrag = null;
function sliceHit(e) {
  const [mx, my] = stageXY(e, sliceCanvas);
  const c = Math.floor((mx - sv.panX) / sv.zoom), r = Math.floor((my - sv.panY) / sv.zoom);
  const { cols, rows } = sliceSize();
  return { c, r, inside: c >= 0 && r >= 0 && c < cols && r < rows, cell: sliceCell(c, r) };
}
const sliceAxisIndex = () => ({ x: 0, y: 1, z: 2 }[S.axis]);
sliceCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
sliceCanvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || spaceDown || S.tool === 'orbit') { sdrag = { pan: true, x: e.clientX, y: e.clientY }; return; }
  const h = sliceHit(e);
  if (!h.inside) return;
  // Right-click paints the background colour, which here is empty: it erases.
  const toolId = e.altKey ? 'picker' : e.button === 2 ? 'eraser' : S.tool;
  if (toolId === 'picker') { const v = S.comp[idx(h.cell[0], h.cell[1], h.cell[2])]; if (v) setFg(v); return; }
  if (S.layers[S.layer] && S.layers[S.layer].locked) { toast('This layer is locked'); return; }
  if (toolId === 'fill') { sliceFill(h); return; }
  const kind = { pencil: 'add', eraser: 'erase', recolor: 'recolor', rect: 'rect', line: 'line', move: 'move' }[toolId];
  if (!kind) return;
  beginStroke(kind, h.cell, sliceAxisIndex());
  if (kind !== 'move') strokeTo(h.cell);
  sdrag = { tool: true };
});
window.addEventListener('mousemove', (e) => {
  if (S.mode !== 'slice') return;
  if (sdrag && sdrag.pan) {
    sv.panX += e.clientX - sdrag.x; sv.panY += e.clientY - sdrag.y;
    sdrag.x = e.clientX; sdrag.y = e.clientY; sliceDirty = true; return;
  }
  const h = sliceHit(e);
  if (sdrag && sdrag.tool && stroke) {
    const { cols, rows } = sliceSize();
    const c = Math.max(0, Math.min(cols - 1, h.c)), r = Math.max(0, Math.min(rows - 1, h.r));
    strokeTo(sliceCell(c, r));
  }
  const prev = S.hover && S.hover.key;
  S.hover = h.inside ? { key: `${h.c},${h.r}`, slice: [h.c, h.r], cell: h.cell } : null;
  if ((S.hover && S.hover.key) !== prev) {
    sliceDirty = true;
    $('#cursor-chip').textContent = !h.inside ? '' : S.isSprite ? `x ${h.c}  y ${h.r}` : `x ${h.cell[0]}  y ${h.cell[1]}  z ${h.cell[2]}`;
  }
});
window.addEventListener('mouseup', () => {
  if (sdrag && sdrag.tool) endStroke();
  sdrag = null;
});
sliceCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [mx, my] = stageXY(e, sliceCanvas);
  if (e.ctrlKey || Math.abs(e.deltaX) < 0.01) {
    // Zoom through the levels, keeping the cell under the mouse in place.
    let i = ZOOMS.indexOf(sv.zoom);
    if (i < 0) i = 0;
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    if (ni === i) return;
    const cx = (mx - sv.panX) / sv.zoom, cy = (my - sv.panY) / sv.zoom;
    sv.zoom = ZOOMS[ni];
    sv.panX = Math.round(mx - cx * sv.zoom); sv.panY = Math.round(my - cy * sv.zoom);
    updateSliceLabel();
  } else { sv.panX -= e.deltaX; sv.panY -= e.deltaY; }
  sliceDirty = true;
}, { passive: false });

function sliceFill(h) {
  // 2D bucket inside the slice, on the active layer.
  const { cols, rows } = sliceSize();
  const at = (c, r) => { const p = sliceCell(c, r); return S.act[idx(p[0], p[1], p[2])]; };
  const from = at(h.c, h.r);
  if (from === S.fg) return;
  const seen = new Uint8Array(cols * rows), stack = [[h.c, h.r]], cells = [];
  seen[h.r * cols + h.c] = 1;
  while (stack.length) {
    const [c, r] = stack.pop();
    cells.push(sliceCell(c, r));
    for (const [nc, nr] of [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]]) {
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[nr * cols + nc] || at(nc, nr) !== from) continue;
      seen[nr * cols + nc] = 1; stack.push([nc, nr]);
    }
  }
  tool('set_voxels', { voxels: mirrored(cells), color: S.fg, ...target() });
}

/* ---------------------------------------------------------------- own dropdowns and number steppers */
const PRESETS = [
  { value: 'db32', label: 'DawnBringer 32', colors: ['#222034', '#663931', '#df7126', '#fbf236', '#6abe30', '#306082', '#5b6ee1', '#d95763'] },
  { value: 'db16', label: 'DawnBringer 16', colors: ['#140c1c', '#442434', '#30346d', '#854c30', '#346524', '#d04648', '#597dce', '#dad45e'] },
  { value: 'pico8', label: 'PICO-8', colors: ['#1d2b53', '#7e2553', '#008751', '#ab5236', '#ff004d', '#ffa300', '#29adff', '#ffccaa'] },
  { value: 'edg32', label: 'Endesga 32', colors: ['#be4a2f', '#d87644', '#feae34', '#63c74d', '#124e89', '#2ce8f5', '#b55088', '#e8b796'] },
  { value: 'grayscale', label: 'Grayscale', colors: ['#111111', '#333333', '#555555', '#777777', '#999999', '#bbbbbb', '#dddddd', '#ffffff'] },
];
function dropdown(el, options, { value = null, placeholder = '', onChange = null, keepLabel = false } = {}) {
  el.classList.add('dropdown', 'menu');
  el.innerHTML = `<button class="dd-btn" type="button"><span class="v"></span>${icon('chevron-down', 14)}</button><div class="menu-list dd-list"></div>`;
  const btn = el.querySelector('.dd-btn'), list = el.querySelector('.dd-list');
  const api = {
    value,
    set(v) { api.value = v; const o = options.find((x) => x.value === v); btn.querySelector('.v').textContent = o && !keepLabel ? o.label : placeholder; },
  };
  for (const o of options) {
    const d = document.createElement('div');
    d.className = 'opt'; d.dataset.value = o.value;
    d.innerHTML = `<span class="ck">${icon('check', 14)}</span><span class="ol"></span>` +
      (o.colors ? `<span class="mini">${o.colors.map((c) => `<span style="background:${c}"></span>`).join('')}</span>` : '');
    d.querySelector('.ol').textContent = o.label;
    d.onclick = (e) => { e.stopPropagation(); closeMenus(); api.set(o.value); if (onChange) onChange(o.value); };
    list.appendChild(d);
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = !el.classList.contains('open');
    closeMenus();
    if (!open) return;
    el.classList.add('open');
    list.querySelectorAll('.opt').forEach((d) => d.classList.toggle('sel', d.dataset.value === api.value));
    // Fixed position so the list is never clipped by a scrolling panel.
    const r = btn.getBoundingClientRect();
    list.style.minWidth = r.width + 'px';
    list.style.left = Math.max(8, Math.min(r.left, window.innerWidth - list.offsetWidth - 8)) + 'px';
    const below = r.bottom + 4, h = list.offsetHeight;
    list.style.top = (below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 4) : below) + 'px';
    openedMenu(list, btn);
  };
  api.set(value);
  return api;
}
function wireSteppers() {
  $$('.stepper').forEach((st) => {
    const input = st.querySelector('input');
    const min = +st.dataset.min || 1, max = +st.dataset.max || 9999, size = +st.dataset.stepSize || 1;
    const clamp = (v) => Math.max(min, Math.min(max, Math.round(v)));
    st.querySelectorAll('button[data-step]').forEach((b) => {
      b.onclick = () => {
        input.value = clamp((parseInt(input.value, 10) || min) + Number(b.dataset.step) * size);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); st.querySelector(`button[data-step="${e.key === 'ArrowUp' ? 1 : -1}"]`).click(); }
      if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('blur', () => { const v = parseInt(input.value, 10); input.value = clamp(isNaN(v) ? min : v); });
  });
}

/* Thumbnails follow the frames panel height. */
function sizeThumbs() {
  const st = $('#strip');
  const room = st.clientHeight - 14;            // strip padding
  const label = room >= 58 ? 16 : 0;            // drop the label when it gets tight
  const t = Math.max(14, room - 10 - label);    // frame padding + border
  st.style.setProperty('--thumb', t + 'px');
  st.classList.toggle('compact', !label);
}

/* ---------------------------------------------------------------- home screen */
const home = { recents: [], samples: null, view: 'recents', card: null };
async function showHome(view) {
  stopPlay(); closeModals(); closePicker(); closeMenus();
  if (typeof view === 'string') home.view = view;
  S.home = true;
  $('#home').hidden = false;
  await loadHome();
}
function hideHome() {
  if (!S.home) return;
  clearInterval(agentsState.timer);
  S.home = false;
  $('#home').hidden = true;
  $('#card-menu').classList.toggle('open', false);
  render3dDirty = true; sliceDirty = true;
  requestAnimationFrame(() => { if (S.mode === 'slice') fitSlice(); });
}
async function loadHome() {
  home.recents = (await nativeAction('recents')) || [];
  if (!home.samples) home.samples = (await nativeAction('samples')) || [];
  renderHome();
}
function timeAgo(t) {
  const s = Math.max(0, Date.now() / 1000 - t);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.round(s / 86400)} days ago`;
  return new Date(t * 1000).toLocaleDateString();
}
function card({ title, sub, folder, thumb, badge, missing }) {
  const c = document.createElement('div');
  c.className = 'card' + (missing ? ' missing' : '');
  c.innerHTML = `<div class="pv">${thumb ? `<img alt="" src="${thumb}">` : icon('image', 28)}</div>` +
    `<div class="meta"><div class="t"></div><div class="s"></div>${folder ? '<div class="s path"></div>' : ''}</div>` +
    (badge ? `<span class="badge">${badge}</span>` : '');
  c.querySelector('.t').textContent = title;
  c.querySelector('.s').textContent = sub;
  if (folder) c.querySelector('.s.path').textContent = folder;
  c.title = folder ? `${sub}\n${folder}` : sub;
  return c;
}
function renderHome() {
  $$('.home-nav[data-home]').forEach((n) => n.classList.toggle('on', n.dataset.home === home.view));
  $('#home-title').textContent = { samples: 'Samples', agents: 'Agents' }[home.view] || 'Recents';
  const agentsView = home.view === 'agents';
  $('#home-recents-wrap').hidden = home.view !== 'recents';
  $('#home-samples-wrap').hidden = agentsView;
  $('.home-actions').hidden = agentsView;
  $('#home-search').hidden = agentsView;
  $('#home-agents-wrap').hidden = !agentsView;
  clearInterval(agentsState.timer);
  if (agentsView) {
    loadAgents();
    agentsState.timer = setInterval(() => { if (S.home && home.view === 'agents') loadAgents(); else clearInterval(agentsState.timer); }, 2500);
    return;
  }
  const q = $('#home-search').value.trim().toLowerCase();
  const box = $('#home-recents');
  box.innerHTML = '';
  const list = home.recents.filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  for (const r of list) {
    const size = r.kind === '2d' ? `${r.size[0]}×${r.size[1]}` : r.size.join('×');
    const c = card({
      title: r.name, thumb: r.thumb, badge: r.kind === '2d' ? '2D' : '3D', missing: !r.exists,
      sub: r.exists ? `${timeAgo(r.touched)} · ${size}` : 'File not found', folder: r.folder,
    });
    c.dataset.path = r.path;
    c.onclick = () => openRecent(r, c);
    const more = document.createElement('button');
    more.className = 'btn small icon more'; more.title = 'More'; more.innerHTML = icon('ellipsis', 16);
    more.onclick = (e) => { e.stopPropagation(); openCardMenu(more, r); };
    c.appendChild(more);
    box.appendChild(c);
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">${q ? 'No recent files match your search.' : 'Files you save or open show up here, with a preview and where they are saved.'}</div>`;
  }
  const sb = $('#home-samples');
  sb.innerHTML = '';
  for (const smp of home.samples || []) {
    if (q && !smp.name.toLowerCase().includes(q)) continue;
    const size = smp.kind === '2d' ? `${smp.size[0]}×${smp.size[1]}` : smp.size.join('×');
    const c = card({ title: smp.name, thumb: smp.thumb, badge: smp.kind === '2d' ? '2D' : '3D', sub: `Built-in example · ${size}` });
    c.dataset.sample = smp.id;
    c.onclick = async () => { await nativeAction(smp.id); hideHome(); };
    sb.appendChild(c);
  }
}
async function openRecent(r, cardEl) {
  if (!r.exists) { openCardMenu((cardEl && cardEl.querySelector('.more')) || $('#home-search'), r); return; }
  const res = await nativeAction('openPath', { path: r.path });
  if (res === true) hideHome(); else toast(String(res || 'Could not open the file'));
}
function openCardMenu(anchor, r) {
  const m = $('#card-menu');
  home.card = r;
  m.querySelector('[data-card="open"]').hidden = !r.exists;
  m.querySelector('[data-card="reveal"]').hidden = !r.exists;
  m.classList.add('open');
  const a = anchor.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(a.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.min(a.bottom + 4, window.innerHeight - m.offsetHeight - 8) + 'px';
  openedMenu(m, anchor);
}
function wireHome() {
  $('#home-btn').onclick = () => showHome('recents');
  $('#home-back').onclick = hideHome;
  $('#home-open').onclick = () => nativeAction('open');
  $$('[data-home]').forEach((n) => { n.onclick = () => { home.view = n.dataset.home; renderHome(); }; });
  $$('[data-new]').forEach((t) => { t.onclick = () => openNewDialog(t.dataset.new); });
  $('#home-search').addEventListener('input', renderHome);
  $('#home-search').addEventListener('keydown', (e) => e.stopPropagation());
  $$('#card-menu [data-card]').forEach((d) => {
    d.onclick = async (e) => {
      e.stopPropagation();
      $('#card-menu').classList.toggle('open', false);
      const r = home.card;
      if (!r) return;
      if (d.dataset.card === 'open') openRecent(r);
      else if (d.dataset.card === 'reveal') nativeAction('reveal', { path: r.path });
      else { await nativeAction('removeRecent', { path: r.path }); loadHome(); }
    };
  });
  document.addEventListener('click', () => $('#card-menu').classList.toggle('open', false));
}

/* ---------------------------------------------------------------- Agents page */
// Logos: @lobehub/icons-static-svg (MIT), see web/agents/ATTRIBUTION.txt. Single-colour ones are drawn as masks.
const AGENTS = [
  { id: 'chatgpt', name: 'ChatGPT', by: 'OpenAI · desktop and web app', logo: 'openai.svg', mono: true },
  { id: 'codex', name: 'Codex', by: 'OpenAI · CLI, IDE extension and app', logo: 'codex-color.svg' },
  { id: 'claude', name: 'Claude', by: 'Anthropic · desktop app', logo: 'claude-color.svg' },
  { id: 'claude-code', name: 'Claude Code', by: 'Anthropic · terminal and IDE', logo: 'claudecode-color.svg' },
  { id: 'cursor', name: 'Cursor', by: 'Anysphere · code editor', logo: 'cursor.svg', mono: true },
  { id: 'openclaw', name: 'OpenClaw', by: 'Open-source personal agent', logo: 'openclaw-color.svg' },
  { id: 'hermes', name: 'Hermes Agent', by: 'Nous Research · open-source agent', logo: 'hermesagent.svg', mono: true },
];
const agentsState = { data: null, timer: null };

function agentLogo(a, big = false) {
  const svg = (window.AGENT_LOGOS || {})[a.logo.replace(/\.svg$/, '')] || icon('bot', 18);
  return `<div class="alogo${big ? ' big' : ''}${a.mono ? ' mono' : ''}" title="${escapeHtml(a.name)}">${svg}</div>`;
}
function exeCommand() { return (agentsState.data && agentsState.data.command) || '/Applications/OpenPixel.app/Contents/MacOS/OpenPixel'; }
const shq = (p) => `"${p.replace(/(["\\$`])/g, '\\$1')}"`;

/** Set-up steps per agent. Each step: text, optional code (copyable), optional note. */
function agentSteps(id) {
  const exe = exeCommand();
  const json = JSON.stringify({ mcpServers: { openpixel: { command: exe, args: ['--mcp'] } } }, null, 2);
  switch (id) {
    case 'chatgpt': return [
      { text: 'ChatGPT cannot start programs on your Mac: it talks to MCP servers over the internet, as a <b>connector</b> in <b>Developer mode</b> (Settings → Apps & Connectors → Advanced; names vary a little between versions, and it needs a plan that offers Developer mode).' },
      { text: 'Start OpenPixel\'s web server in Terminal. It listens on this Mac only and prints an address with a secret part:', code: `${shq(exe)} --mcp-http 8765` },
      { text: 'Make that port reachable with a tunnel you trust, for example Cloudflare\'s free quick tunnel:', code: 'cloudflared tunnel --url http://127.0.0.1:8765' },
      { text: 'In ChatGPT, create a connector with the tunnel\'s https address followed by the <span class="mono">/mcp/…</span> path OpenPixel printed, and choose <b>No authentication</b>.' },
      { note: 'Anyone who has the full address can edit your open model. Keep it private and stop the tunnel (Ctrl+C) when you are done.' },
    ];
    case 'codex': return [
      { text: 'Add OpenPixel with one command:', code: `codex mcp add openpixel -- ${shq(exe)} --mcp` },
      { text: 'Or add it to <span class="mono">~/.codex/config.toml</span> yourself:', code: `[mcp_servers.openpixel]\ncommand = ${JSON.stringify(exe)}\nargs = ["--mcp"]` },
      { text: 'Restart Codex. The CLI, the IDE extension and the Codex app all read this file.' },
    ];
    case 'claude': return [
      { text: 'In the Claude desktop app open <b>Settings → Developer → Edit Config</b>. This opens <span class="mono">claude_desktop_config.json</span>.' },
      { text: 'Add OpenPixel under <span class="mono">mcpServers</span> (merge it with any servers already there):', code: json },
      { text: 'Quit and reopen Claude. OpenPixel\'s tools appear in the tools menu of the message box.' },
    ];
    case 'claude-code': return [
      { text: 'Run this once in Terminal (it adds OpenPixel for all your projects):', code: `claude mcp add --scope user openpixel -- ${shq(exe)} --mcp` },
      { text: 'Check it with <span class="mono">claude mcp list</span>, or type <span class="mono">/mcp</span> inside Claude Code.' },
    ];
    case 'cursor': return [
      { text: 'Click <b>Add to Cursor</b> below, or open Cursor Settings → <b>Tools & MCP</b> → New MCP server.' },
      { text: 'Or paste this into <span class="mono">~/.cursor/mcp.json</span>:', code: json },
      { text: 'Turn the openpixel server on in Cursor\'s MCP settings if it is not already.' },
    ];
    case 'openclaw': return [
      { text: 'OpenClaw reaches MCP servers through its MCP support (the <span class="mono">mcporter</span> tool). Add a server named <b>openpixel</b> that runs this command:', code: `${shq(exe)} --mcp` },
      { text: 'Most MCP settings files take the same shape:', code: json },
      { note: 'Where this goes depends on your OpenClaw version, so check OpenClaw\'s MCP documentation. OpenPixel looks for it in ~/.openclaw/openclaw.json and ~/.mcporter/mcporter.json to show the status here.' },
    ];
    case 'hermes': return [
      { text: 'Add OpenPixel to <span class="mono">~/.hermes/config.yaml</span>:', code: `mcp_servers:\n  openpixel:\n    command: ${JSON.stringify(exe)}\n    args: ["--mcp"]` },
      { text: 'Restart Hermes so it loads the new server.' },
      { note: 'Hermes Agent changes quickly; if this key has moved, see the MCP section of its documentation. The command and argument stay the same.' },
    ];
    default: return [{ text: 'Add an MCP server named openpixel that runs:', code: `${shq(exe)} --mcp` }];
  }
}

function agentStatus(a) {
  // Two states: Connected (OpenPixel is in the app's settings, or it is talking to this window now) and Disconnected.
  const d = agentsState.data || {};
  const live = (d.sessions || []).filter((s) => s.open && s.agent === a.id);
  const setup = (d.setup || {})[a.id] || {};
  const seen = (d.last_seen || {})[a.id];
  if (live.length) {
    const calls = live.reduce((n, s) => n + s.calls, 0);
    const last = Math.max(...live.map((s) => s.last_call || s.connected));
    const tool = live.map((s) => s.last_tool).find(Boolean);
    return { cls: 'connected live', label: live.length > 1 ? `Connected ×${live.length}` : 'Connected',
      act: calls ? `<b>${calls} call${calls === 1 ? '' : 's'}</b> · ${timeAgo(last)}${tool ? `<span class="mono">last: ${escapeHtml(tool)}</span>` : ''}`
        : `Ready, no calls yet · connected ${timeAgo(Math.min(...live.map((s) => s.connected)))}` };
  }
  if (setup.configured) return { cls: 'connected', label: 'Connected', act: seen ? `Last used ${timeAgo(seen)}` : 'Not used yet' };
  if (a.id === 'chatgpt') return { cls: 'disconnected', label: 'Disconnected', act: 'Needs a tunnel (see How to connect)' };
  if (setup.installed) return { cls: 'disconnected', label: 'Disconnected', act: 'Installed, not set up yet' };
  return { cls: 'missing', label: 'Not found', act: '' }; // the status says it all
}

async function loadAgents() {
  try { agentsState.data = await nativeAction('agents'); } catch (e) { agentsState.data = null; }
  renderAgents();
}
function renderAgents() {
  const d = agentsState.data || {};
  $('#agent-cmd').textContent = `${exeCommand()} --mcp`;
  const body = $('#agents-body');
  body.innerHTML = '';
  const rows = AGENTS.map((a) => ({ a, st: agentStatus(a) }));
  // Clients OpenPixel doesn't know by name still show up while connected.
  for (const s of (d.sessions || []).filter((x) => x.open && !x.agent)) {
    rows.push({ a: { id: 'other', name: s.client === 'unknown' ? 'Unknown agent' : s.client, by: `MCP client ${s.version || ''} · ${s.transport}`, logo: null },
      st: { cls: 'connected live', label: 'Connected', act: s.calls ? `<b>${s.calls} call${s.calls === 1 ? '' : 's'}</b> · ${timeAgo(s.last_call || s.connected)}` : 'Ready, no calls yet' } });
  }
  for (const { a, st } of rows) {
    const tr = document.createElement('tr');
    tr.dataset.agent = a.id;
    tr.innerHTML = `<td class="c-agent"><div class="agent-cell">${a.logo ? agentLogo(a) : `<div class="alogo">${icon('bot', 18)}</div>`}` +
      `<div class="aname"></div></div></td>` +
      `<td class="c-status"><span class="pill ${st.cls}">${st.label}</span></td>` +
      `<td class="c-act"><div class="act-cell">${st.act}</div></td>` +
      `<td class="c-info">${a.id === 'other' ? '' : `<button class="btn small outline info-btn" title="How to connect ${escapeHtml(a.name)}">${icon('info', 14)}<span class="lbl">How to connect</span></button>`}</td>`;
    tr.querySelector('.aname').textContent = a.name;
    const b = tr.querySelector('.info-btn');
    if (b) b.onclick = () => showAgentInfo(a);
    body.appendChild(tr);
  }
  const anyLive = (d.sessions || []).some((s) => s.open);
  $('#nav-agent-dot').hidden = !anyLive;
  const topDot = $('#agent-btn .dot');
  if (topDot) topDot.style.background = anyLive ? 'var(--ok)' : '#777';
}
function showAgentInfo(a) {
  const t = document.createElement('template');
  t.innerHTML = agentLogo(a, true);
  t.content.firstChild.id = 'ai-logo';
  $('#ai-logo').replaceWith(t.content.firstChild);
  $('#ai-title').textContent = `Connect ${a.name}`;
  $('#ai-sub').textContent = a.by;
  const st = agentStatus(a);
  const body = $('#ai-body');
  body.innerHTML = `<p><span class="pill ${st.cls}">${st.label}</span></p><ol class="steps"></ol>`;
  const ol = body.querySelector('ol');
  for (const step of agentSteps(a.id)) {
    const li = document.createElement('li');
    if (step.note) { li.style.listStyle = 'none'; li.innerHTML = `<div class="note">${step.note}</div>`; ol.appendChild(li); continue; }
    li.innerHTML = step.text;
    if (step.code) {
      const box = document.createElement('div');
      box.className = 'codebox';
      box.innerHTML = '<pre class="code"></pre><button class="btn small copy"></button>';
      box.querySelector('pre').textContent = step.code;
      copyButton(box.querySelector('.copy'), step.code);
      li.appendChild(box);
    }
    ol.appendChild(li);
  }
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = 'Then ask, for example: “Use OpenPixel to draw a 32×32 treasure chest sprite, review it and fix what looks off.”';
  body.appendChild(p);
  const extra = $('#ai-extra');
  extra.innerHTML = '';
  if (a.id === 'cursor') {
    const cfg = btoa(JSON.stringify({ command: exeCommand(), args: ['--mcp'] }));
    const btn = document.createElement('button');
    btn.className = 'btn outline'; btn.innerHTML = `${icon('external-link', 14)}Add to Cursor`;
    btn.onclick = () => nativeAction('openURL', { url: `cursor://anysphere.cursor-deeplink/mcp/install?name=openpixel&config=${encodeURIComponent(cfg)}` });
    extra.appendChild(btn);
  }
  const setup = ((agentsState.data || {}).setup || {})[a.id];
  if (setup && setup.config_exists) {
    const btn = document.createElement('button');
    btn.className = 'btn outline'; btn.innerHTML = `${icon('folder-open', 14)}Show settings file`;
    btn.onclick = () => nativeAction('revealConfig', { path: setup.config_file });
    extra.appendChild(btn);
  }
  openModal('#agent-info');
}
function showAgentHelp() { return showHome('agents'); }
/* The top bar's Agents button shows a green dot while any agent is connected (no settings files read here). */
async function pollAgentDot() {
  try {
    const d = await nativeAction('agents', { setup: false });
    const live = ((d && d.sessions) || []).filter((s) => s.open);
    const dot = $('#agent-btn .dot');
    if (dot) dot.style.background = live.length ? 'var(--ok)' : '#777';
    $('#agent-btn').title = live.length ? `Agents: ${[...new Set(live.map((s) => s.client))].join(', ')} working` : 'Agents';
    $('#nav-agent-dot').hidden = !live.length;
  } catch (e) { /* not available */ }
}

/* ---------------------------------------------------------------- UI wiring */
function buildTools() {
  const bar = $('#toolbar');
  for (const t of TOOLS) {
    if (t.sep) { bar.appendChild(Object.assign(document.createElement('div'), { className: 'tb-sep' })); continue; }
    const d = document.createElement('div');
    d.className = 'tool'; d.dataset.tool = t.id; d.title = `${t.name} (${t.key})`;
    d.innerHTML = icon(t.icon, 18);
    d.onclick = () => setTool(t.id);
    bar.appendChild(d);
  }
  bar.appendChild(Object.assign(document.createElement('div'), { className: 'tb-sep' }));
  const c = document.createElement('div');
  c.id = 'tb-color'; c.title = 'Current colour';
  c.onclick = () => addColor(c);
  bar.appendChild(c);
  setTool('pencil');
}
function setTool(id) {
  S.tool = id;
  $$('.tool').forEach((d) => d.classList.toggle('on', d.dataset.tool === id));
  lineBuffer('cursor', []);
  S.hover = null; render3dDirty = true; sliceDirty = true;
}
function setMode(m) {
  S.mode = m;
  $('#app').classList.toggle('mode-slice', m === 'slice');
  $$('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  S.hover = null;
  $('#cursor-chip').textContent = '';
  if (m === 'slice') requestAnimationFrame(fitSlice);
  render3dDirty = true; sliceDirty = true;
  updateViewPanel(); updateInfoChip();
}
function setAxis(a) {
  S.axis = a;
  const { depth } = sliceSize();
  S.slice = a === 'y' ? 0 : Math.floor(depth / 2);
  fitSlice();
}
function stepSlice(d) {
  const { depth } = sliceSize();
  S.slice = Math.max(0, Math.min(depth - 1, S.slice + d));
  sliceDirty = true; updateSliceLabel();
}
function setBrush(b) {
  S.brush = Math.max(1, Math.min(16, b));
  $('#brush').value = S.brush; $('#brush-size').textContent = S.brush;
}
function zoomStep(dir) {
  let i = ZOOMS.indexOf(sv.zoom);
  if (i < 0) i = 0;
  const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + dir));
  const w = sliceCanvas.clientWidth / 2, h = sliceCanvas.clientHeight / 2;
  const cx = (w - sv.panX) / sv.zoom, cy = (h - sv.panY) / sv.zoom;
  sv.zoom = ZOOMS[ni];
  sv.panX = Math.round(w - cx * sv.zoom); sv.panY = Math.round(h - cy * sv.zoom);
  sliceDirty = true; updateSliceLabel();
}

let playTimer = null;
function togglePlay() {
  if (S.playing) { stopPlay(); return; }
  if (S.frames.length < 2) { toast('Add a frame to animate'); return; }
  S.playing = true; $('#play').innerHTML = icon('pause'); $('#play').classList.add('on');
  const tick = async () => {
    if (!S.playing) return;
    const next = (S.frame + 1) % S.frames.length;
    await tool('set_active', { frame: next });
    playTimer = setTimeout(tick, (S.frames[next] && S.frames[next].duration_ms) || 100);
  };
  playTimer = setTimeout(tick, (S.frames[S.frame] && S.frames[S.frame].duration_ms) || 100);
}
function stopPlay() {
  S.playing = false; clearTimeout(playTimer);
  $('#play').innerHTML = icon('play'); $('#play').classList.remove('on');
}

async function showReview() {
  try {
    const r = await call('review_model', { frame: S.frame });
    const img = $('#review-img');
    img.onload = () => { img.style.width = Math.min(860, img.naturalWidth * 1.5) + 'px'; };
    img.src = r.images[0];
    const b = r.bounds ? r.bounds.size.join('×') : '—';
    $('#review-stats').textContent = `${r.voxels} ${S.isSprite ? 'pixels' : 'voxels'} · bounds ${b} · ${r.parts || 0} part(s) · ${(r.colors || []).length} colours · left/right symmetry ${Math.round((r.symmetry_x || 0) * 100)}%`;
    const ul = $('#review-issues');
    ul.innerHTML = '';
    (r.issues && r.issues.length ? r.issues : ['No problems found.']).forEach((t) => {
      const li = document.createElement('li'); li.textContent = t; ul.appendChild(li);
    });
    openModal('#review-dialog');
  } catch (e) { toast(errorText(e)); }
}

let modalReturnFocus = null;
function openModal(id) {
  closeMenus();
  const bg = $(id);
  if (!bg.classList.contains('open')) modalReturnFocus = document.activeElement;
  bg.classList.add('open');
  popIn(bg, '50% 50%', { scale: 1, duration: 160 }); // the dimmed backdrop only fades
  popIn(bg.querySelector('.modal'), '50% 50%', { scale: 0.96, duration: 200 });
  // Keyboard users land inside the dialog; pointer users keep their place.
  if (lastInput === 'key') {
    const first = bg.querySelector('.modal input:not([type=hidden]), .modal .btn.primary, .modal button');
    if (first) first.focus();
  }
}
function closeModals() {
  const wasOpen = $$('.modal-bg.open').length > 0;
  $$('.modal-bg').forEach((m) => m.classList.toggle('open', false));
  if (wasOpen && modalReturnFocus && document.contains(modalReturnFocus) && modalReturnFocus.focus) modalReturnFocus.focus();
  modalReturnFocus = null;
}

/* Menus: the arrow keys move through the items of the open menu, Return chooses, Escape closes and returns focus. */
let menuTrigger = null;
function openedMenu(list, trigger) {
  menuTrigger = trigger;
  popIn(list, originFrom(trigger, list), { duration: 140, scale: 0.97 });
  list.querySelectorAll('.kb').forEach((d) => d.classList.toggle('kb', false));
  if (lastInput === 'key') moveMenu(list, 1);
}
function openMenuList() { return $('.menu.open > .menu-list') || $('.card-menu.open'); }
function menuItems(list) { return [...list.children].filter((d) => d.tagName === 'DIV' && !d.hidden && d.offsetParent !== null); }
function moveMenu(list, step, to) {
  const items = menuItems(list);
  if (!items.length) return;
  const cur = items.findIndex((d) => d.classList.contains('kb'));
  const next = to === 'first' ? 0 : to === 'last' ? items.length - 1 : (cur + step + items.length) % items.length;
  items.forEach((d, i) => d.classList.toggle('kb', i === next));
  items[next].scrollIntoView({ block: 'nearest' });
}
window.addEventListener('keydown', (e) => {
  const list = openMenuList();
  if (!list) return;
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
    moveMenu(list, k === 'ArrowUp' ? -1 : 1, k === 'Home' ? 'first' : k === 'End' ? 'last' : null);
  } else if (k === 'Enter' || k === ' ') {
    const d = list.querySelector('.kb');
    if (!d) return;
    d.click();
    if (menuTrigger && menuTrigger.focus) menuTrigger.focus();
  } else if (k === 'Escape' || k === 'Tab') {
    closeMenus();
    if (menuTrigger && menuTrigger.focus) menuTrigger.focus();
  } else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);
function closeMenus() { $$('.menu, .card-menu').forEach((m) => m.classList.remove('open')); }


/* Panels resize by dragging their edges; sizes are remembered. */
const SIZES = { left: [180, 440, 240], right: [230, 460, 264], bottom: [72, 260, 104] };
function setSize(which, px) {
  const [min, max] = SIZES[which];
  const v = Math.round(Math.max(min, Math.min(max, px)));
  document.documentElement.style.setProperty(which === 'bottom' ? '--bottom-h' : `--${which}-w`, v + 'px');
  render3dDirty = true; sliceDirty = true;
  return v;
}
function initResizers() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('openpixel.panels') || '{}'); } catch (e) { saved = {}; }
  for (const k of Object.keys(SIZES)) setSize(k, saved[k] || SIZES[k][2]);
  $$('.resizer').forEach((r) => {
    r.addEventListener('mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const which = r.dataset.resize;
      r.classList.add('active');
      document.body.classList.add(which === 'bottom' ? 'resizing-row' : 'resizing-col');
      const move = (ev) => {
        const px = which === 'left' ? ev.clientX : which === 'right' ? window.innerWidth - ev.clientX : window.innerHeight - ev.clientY;
        saved[which] = setSize(which, px);
      };
      const up = () => {
        r.classList.remove('active');
        document.body.classList.remove('resizing-row', 'resizing-col');
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        try { localStorage.setItem('openpixel.panels', JSON.stringify(saved)); } catch (e) { /* not saved */ }
        if (S.mode === 'slice') updateSliceLabel();
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    r.addEventListener('dblclick', () => { const w = r.dataset.resize; saved[w] = setSize(w, SIZES[w][2]); });
  });
}

function wire() {
  $$('[data-menu]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const m = $('#' + b.dataset.menu), open = !m.classList.contains('open');
      closeMenus();
      m.classList.toggle('open', open);
      if (open) openedMenu(m.querySelector('.menu-list'), b);
    };
  });
  document.addEventListener('click', closeMenus);
  $$('[data-action]').forEach((d) => {
    d.onclick = () => { closeMenus(); if (d.dataset.action === 'new') openNewDialog(S.isSprite ? '2d' : '3d'); else nativeAction(d.dataset.action); };
  });
  $$('[data-export]').forEach((d) => {
    d.onclick = () => {
      closeMenus();
      const opts = ['png', 'svg'].includes(d.dataset.export) && !S.isSprite ? { yaw: S.previewYaw, pitch: S.previewPitch } : {};
      nativeAction('export', { format: d.dataset.export, options: opts });
    };
  });
  $('#undo').onclick = () => tool('undo');
  $('#redo').onclick = () => tool('redo');
  $('#review-btn').onclick = showReview;
  $('#agent-btn').onclick = showAgentHelp;
  copyButton($('#agent-cmd-copy'), () => $('#agent-cmd').textContent);
  $$('[data-close]').forEach((b) => { b.onclick = closeModals; });
  $$('.modal-bg').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) closeModals(); }));
  $$('[data-mode]').forEach((b) => { b.onclick = () => setMode(b.dataset.mode); });
  $$('[data-axis]').forEach((b) => { b.onclick = () => setAxis(b.dataset.axis); });
  $('#slice-down').onclick = () => stepSlice(-1);
  $('#slice-up').onclick = () => stepSlice(1);
  $('#ghost-btn').onclick = () => { S.ghost = !S.ghost; $('#ghost-btn').classList.toggle('on', S.ghost); sliceDirty = true; };
  $('#pixel-grid-btn').onclick = () => setPixelGrid(!S.pixelGrid);
  setPixelGrid(S.pixelGrid);
  $('#zoom-in').onclick = () => zoomStep(1);
  $('#zoom-out').onclick = () => zoomStep(-1);
  $('#zoom-fit').onclick = fitSlice;
  $$('[data-proj]').forEach((b) => { b.onclick = () => { S.ortho = b.dataset.proj === 'ortho'; render3dDirty = true; updateViewPanel(); updateInfoChip(); }; });
  $('#edges-btn').onclick = () => { S.edges = !S.edges; $('#edges-btn').classList.toggle('on', S.edges); render3dDirty = true; };
  $('#grid-btn').onclick = () => { S.grid = !S.grid; $('#grid-btn').classList.toggle('on', S.grid); render3dDirty = true; };
  $('#reset-cam').onclick = resetCamera;
  $('#brush').addEventListener('input', () => setBrush(+$('#brush').value));
  $$('[data-mirror]').forEach((b) => {
    b.onclick = () => { const a = b.dataset.mirror; S.mirror[a] = !S.mirror[a]; b.classList.toggle('on', S.mirror[a]); };
  });
  $('#fg').onclick = () => editColor(S.fg, $('#fg'));
  $('#add-color').onclick = () => addColor($('#add-color'));
  $('#fg-hex').addEventListener('keydown', async (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const r = await tool('add_colors', { colors: [$('#fg-hex').value.trim()] });
    if (r && r.indexes) { setFg(r.indexes[0]); $('#fg-hex').blur(); }
  });
  dropdown($('#preset'), PRESETS, { placeholder: 'Palette preset…', keepLabel: true, onChange: (v) => tool('set_palette', { preset: v }) });
  newPalette = dropdown($('#new-palette'), PRESETS, { value: 'db32' });
  $$('[data-pview]').forEach((b) => {
    b.onclick = () => {
      if (b.dataset.pview === 'front') { S.previewYaw = 0; S.previewPitch = 0; } else { S.previewYaw = 45; S.previewPitch = 30; }
      $$('[data-pview]').forEach((x) => x.classList.toggle('on', x === b)); schedulePreview();
    };
  });
  $$('[data-pscale]').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.pscale) === S.previewScale);
    b.onclick = () => { S.previewScale = Number(b.dataset.pscale); $$('[data-pscale]').forEach((x) => x.classList.toggle('on', x === b)); schedulePreview(); };
  });
  $('#layer-add').onclick = () => tool('add_layer', {});
  $('#layer-del').onclick = () => tool('delete_layer', { layer: S.layer });
  $('#layer-dup').onclick = () => tool('duplicate_layer', { layer: S.layer });
  $('#layer-merge').onclick = () => tool('merge_layer_down', { layer: S.layer });
  $('#frame-add').onclick = () => tool('add_frame', { after: S.frame, copy: true });
  $('#frame-del').onclick = () => tool('delete_frame', { frame: S.frame });
  $('#play').onclick = togglePlay;
  $('#onion').onclick = () => { S.onionOn = !S.onionOn; refresh(); };
  $('#activity-head').onclick = () => $('#activity-sec').classList.toggle('closed');
  $('#frames-toggle').onclick = () => setFramesOpen($('#app').classList.contains('frames-closed'));
  setFramesOpen(!(() => { try { return localStorage.getItem('openpixel.framesClosed') === '1'; } catch (e) { return false; } })());
  $('#duration').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') e.target.blur(); });
  $('#duration').onchange = () => { const v = parseInt($('#duration').value, 10); if (v > 0) tool('set_frame_duration', { frame: S.frame, duration_ms: v }); };
  $$('.presets [data-size]').forEach((b) => { b.onclick = () => { ['#new-x', '#new-y', '#new-z'].forEach((s) => { $(s).value = b.dataset.size; }); }; });
  $$('[data-kind]').forEach((b) => { b.onclick = () => setNewKind(b.dataset.kind); });
  $('#new-ok').onclick = async () => {
    const common = { name: $('#new-name').value || 'Untitled', palette: newPalette ? newPalette.value : 'db32' };
    const r = ($('#new-dialog').dataset.kind || '2d') === '2d'
      ? await tool('new_sprite', { ...common, width: +$('#new-x').value, height: +$('#new-y').value })
      : await tool('new_model', { ...common, size_x: +$('#new-x').value, size_y: +$('#new-y').value, size_z: +$('#new-z').value });
    if (r) closeModals();
  };
  $('#extrude-btn').onclick = () => tool('extrude_to_3d', { depth: Math.max(1, +$('#extrude-depth').value || 4) });
  $$('input').forEach((i) => { if (i.type !== 'range') i.addEventListener('keydown', (e) => e.stopPropagation()); });
  wirePicker();
  wireSteppers();
  wireHome();
  new ResizeObserver(sizeThumbs).observe($('#strip'));
  pollAgentDot();
  setInterval(pollAgentDot, 4000);

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.metaKey) return; // menu shortcuts are handled by the Mac menu bar
    if (e.key === 'Enter' && e.target.tagName === 'BUTTON') return; // the focused button handles Return itself
    if (e.key === ' ') { spaceDown = true; e.preventDefault(); return; }
    if (e.key === 'Escape') { if (S.home && !$$('.modal-bg.open').length) hideHome(); closeModals(); closeMenus(); closePicker(); return; }
    if (S.home) return;
    if (e.key === 'Tab') { e.preventDefault(); setMode(S.mode === '3d' ? 'slice' : '3d'); return; }
    if (e.shiftKey && (e.key === 'X' || e.key === 'Z' || e.key === 'Y')) { $(`[data-mirror="${e.key.toLowerCase()}"]`).click(); return; }
    const t = TOOLS.find((x) => x.key && x.key.toLowerCase() === e.key.toLowerCase());
    if (t && !e.shiftKey) { setTool(t.id); return; }
    if (e.key === '[') setBrush(S.brush - 1);
    else if (e.key === ']') setBrush(S.brush + 1);
    else if (e.key === ',') setActive({ frame: (S.frame - 1 + S.frames.length) % S.frames.length });
    else if (e.key === '.') setActive({ frame: (S.frame + 1) % S.frames.length });
    else if (e.key === 'Enter') togglePlay();
    else if (e.key === "'") setPixelGrid(!S.pixelGrid);
    else if (e.key === 'f' || e.key === 'F') $('#frames-toggle').click();
    else if (e.key === 'o' || e.key === 'O') $('#onion').click();
    else if (e.key === '?') showShortcuts();
    else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      // Layer above / below (the list shows the top layer first).
      e.preventDefault();
      const next = S.layer + (e.key === 'ArrowUp' ? 1 : -1);
      if (next >= 0 && next < S.layers.length) setActive({ layer: next });
    }
    else if (e.key === 'PageUp') stepSlice(1);
    else if (e.key === 'PageDown') stepSlice(-1);
    else if (e.key === '+' || e.key === '=') { if (S.mode === 'slice') zoomStep(1); }
    else if (e.key === '-') { if (S.mode === 'slice') zoomStep(-1); }
    else if (e.key.startsWith('Arrow') && S.tool === 'move') {
      e.preventDefault();
      const d = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: e.shiftKey ? [0, 1, 0] : [0, 0, -1], ArrowDown: e.shiftKey ? [0, -1, 0] : [0, 0, 1] }[e.key];
      tool('transform', { op: 'move', dx: d[0], dy: d[1], dz: d[2], ...target() });
    }
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') spaceDown = false; });
  window.addEventListener('resize', () => { render3dDirty = true; sliceDirty = true; });
}

/* ---------------------------------------------------------------- frame loop */
let frameCount = 0, stateReady = false, framesSent = false;
function loop() {
  if (S.mode === '3d') draw3d(); else drawSlice();
  frameCount++;
  if (SCREENSHOT && stateReady) {
    // Keep drawing so the snapshot has fresh pixels; after ~120 frames tell the app to take the picture.
    render3dDirty = true;
    if (frameCount >= 120 && !framesSent) { framesSent = true; if (bridge) bridge.postMessage({ kind: 'frames', count: frameCount }); }
  }
  requestAnimationFrame(loop);
}

let newPalette = null;
function setNewKind(kind) {
  $$('[data-kind]').forEach((x) => x.classList.toggle('on', x.dataset.kind === kind));
  $('#new-depth-field').hidden = kind !== '3d';
  $('#new-dialog').dataset.kind = kind;
}
function openNewDialog(kind = '2d') { setNewKind(kind); openModal('#new-dialog'); }

window.PC = {
  refresh: (toolName) => {
    // Opening or starting a model from anywhere (menu, home, an agent) leaves the home screen.
    if (S.home && ['open_model', 'new_model', 'new_sprite'].includes(toolName)) hideHome();
    refresh();
  },
  showNewDialog: () => openNewDialog(S.isSprite ? '2d' : '3d'),
  showHome,
  showAgentHelp,
  command(cmd) {
    if (cmd === 'shortcuts') { showShortcuts(); return; }
    if (S.home) return; // editor commands do nothing over the home screen
    // While typing in a field, ⌘⌫ and friends belong to the field, not to the document.
    const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (typing && ['deleteLayer', 'deleteFrame', 'duplicateLayer'].includes(cmd)) return;
    if (cmd === 'view3d') setMode('3d');
    else if (cmd === 'viewSlice') setMode('slice');
    else if (cmd === 'resetCamera') { resetCamera(); fitSlice(); }
    else if (cmd === 'review') showReview();
    else if (cmd === 'newLayer') press('#layer-add');
    else if (cmd === 'duplicateLayer') press('#layer-dup');
    else if (cmd === 'mergeDown') press('#layer-merge', 'The bottom layer has nothing to merge into');
    else if (cmd === 'deleteLayer') press('#layer-del', 'A model keeps at least one layer');
    else if (cmd === 'newFrame') press('#frame-add');
    else if (cmd === 'deleteFrame') press('#frame-del', 'An animation keeps at least one frame');
    else if (cmd === 'playStop') togglePlay();
    else if (cmd === 'onion') press('#onion');
    else if (cmd === 'pixelGrid') setPixelGrid(!S.pixelGrid);
    else if (cmd === 'frames') press('#frames-toggle');
    else if (cmd === 'zoomIn') zoomStep(1);
    else if (cmd === 'zoomOut') zoomStep(-1);
  },
};

/** Clicks a panel button for a shortcut, or says why it can't be used right now. */
function press(sel, whyDisabled) {
  const b = $(sel);
  if (b.disabled) { if (whyDisabled) toast(whyDisabled); return; }
  b.click();
}

/* ---------------------------------------------------------------- keyboard shortcuts (Help ▸ Keyboard Shortcuts, ⌘/ or ?) */
const SHORTCUTS = [
  ['Tools', TOOLS.filter((t) => t.key).map((t) => [t.name, [t.key]]).concat([['Eyedropper while drawing', ['⌥', 'click']], ['Pan the canvas', ['Space', 'drag']]])],
  ['Drawing', [['Smaller / larger brush', ['[', ']']], ['Mirror left/right', ['⇧', 'X']], ['Mirror up/down', ['⇧', 'Y']], ['Mirror front/back', ['⇧', 'Z']],
    ['Move the layer (Move tool)', ['←', '→', '↑', '↓']], ['Undo', ['⌘', 'Z']], ['Redo', ['⇧', '⌘', 'Z']]]],
  ['Layers', [['New layer', ['⇧', '⌘', 'N']], ['Duplicate layer', ['⌘', 'D']], ['Merge down', ['⌘', 'E']], ['Delete layer', ['⌘', '⌫']],
    ['Layer above / below', ['⌥', '↑', '⌥', '↓']]]],
  ['Frames', [['New frame', ['⌥', '⌘', 'N']], ['Delete frame', ['⌥', '⌘', '⌫']], ['Previous / next frame', [',', '.']], ['Play / stop', ['↩']],
    ['Onion skin', ['O']], ['Show / hide the frames', ['F']]]],
  ['View', [['2D canvas / 3D view', ['⌘', '1', '⌘', '2']], ['Switch 2D and 3D', ['Tab']], ['Zoom in / out', ['⌘', '+', '⌘', '−']], ['Fit / reset view', ['⌘', '0']],
    ['Pixel grid', ['⌘', "'"]], ['Previous / next slice', ['PgDn', 'PgUp']], ['Review the model', ['⌘', 'R']]]],
  ['File', [['New', ['⌘', 'N']], ['Open', ['⌘', 'O']], ['Save', ['⌘', 'S']], ['Save as', ['⇧', '⌘', 'S']], ['Export PNG', ['⇧', '⌘', 'E']],
    ['Keyboard shortcuts', ['⌘', '/']]]],
];
function showShortcuts() {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const group = ([name, rows]) => `<section><h3>${name}</h3>${rows.map(([what, keys]) =>
    `<div class="sc"><span>${esc(what)}</span><span>${keys.map((k) => ['click', 'drag'].includes(k) ? `<span class="muted"> ${k}</span>` : `<kbd>${esc(k)}</kbd>`).join('')}</span></div>`).join('')}</section>`;
  // Two columns with their headings on one line: drawing on the left, document and view on the right.
  $('#shortcuts-body').innerHTML = `<div>${SHORTCUTS.slice(0, 3).map(group).join('')}</div><div>${SHORTCUTS.slice(3).map(group).join('')}</div>`;
  openModal('#shortcuts-dialog');
}

fillIcons();
initGL();
buildTools();
initResizers();
wire();
setAxis('z');
setMode('slice');
refresh().then(async () => {
  if (window.OPENPIXEL_START === 'home') await showHome();
  sizeThumbs();
  stateReady = true; frameCount = 0;
});
requestAnimationFrame(loop);
