/* The colour picker and the two ways into it. The Picker component (EditorDialogs.tsx) has
   the markup and what wirePicker() attached; the colour square is drawn here, by hand, as before. */
import { $ } from '../lib/dom';
import { lastInput, originFrom, popIn } from '../lib/motion';
import { changed, store } from '../lib/store';
import { S } from '../state/ui';
import { tool } from './core';
import { setFg } from './engine';

type OnOk = ((hex: string) => unknown) | null;
/** The picker's colour (hue 0–360, saturation and value 0–1) and what OK does with it; `open` and `okLabel` are what
 *  openPicker() and closePicker() show. */
export const pk = store<{ h: number; s: number; v: number; onOk: OnOk; open: boolean; okLabel: string }>({ h: 0, s: 0, v: 0, onOk: null, open: false, okLabel: 'Add' });

function hsvToRgb(h: number, s: number, v: number): number[] {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
function rgbToHsv(r: number, g: number, b: number): number[] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
const toHex = (rgb: number[]): string => '#' + rgb.map((x) => x.toString(16).padStart(2, '0')).join('');
export function pickerHex(): string { return toHex(hsvToRgb(pk.h, pk.s, pk.v)); }
export function drawPicker(): void {
  const c = $<HTMLCanvasElement>('#sv'), g = c.getContext('2d')!, w = c.width, h = c.height;
  g.fillStyle = toHex(hsvToRgb(pk.h, 1, 1)); g.fillRect(0, 0, w, h);
  const white = g.createLinearGradient(0, 0, w, 0); white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = white; g.fillRect(0, 0, w, h);
  const black = g.createLinearGradient(0, 0, 0, h); black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
  g.fillStyle = black; g.fillRect(0, 0, w, h);
  g.lineWidth = 3; g.strokeStyle = '#fff';
  g.beginPath(); g.arc(pk.s * w, (1 - pk.v) * h, 9, 0, Math.PI * 2); g.stroke();
  const hex = pickerHex();
  $('#pk-swatch').style.background = hex;
  const field = $<HTMLInputElement>('#pk-hex');
  if (document.activeElement !== field) field.value = hex;
  $<HTMLInputElement>('#hue').value = String(pk.h);
}
export function setPickerHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(hex).trim());
  if (!m) return false;
  let s = m[1];
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const v = parseInt(s, 16);
  [pk.h, pk.s, pk.v] = rgbToHsv((v >> 16) & 255, (v >> 8) & 255, v & 255);
  drawPicker();
  return true;
}
export function openPicker(anchor: HTMLElement, hex: string | undefined, okLabel: string, onOk: OnOk): void {
  const p = $('#picker');
  pk.onOk = onOk;
  pk.okLabel = okLabel;
  setPickerHex(hex && hex !== 'transparent' ? hex : '#ff4a1c');
  pk.open = true;
  changed(pk);
  const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let left = r.left - pw - 10, top = r.top;
  if (left < 8) left = Math.min(window.innerWidth - pw - 8, r.right + 10);
  top = Math.max(8, Math.min(window.innerHeight - ph - 8, top));
  p.style.left = left + 'px'; p.style.top = top + 'px';
  popIn(p, originFrom(anchor, p), { duration: 170 });
  if (lastInput === 'key') $('#pk-hex').focus();
}
export function closePicker(): void { pk.open = false; pk.onOk = null; changed(pk); }

export function editColor(i: number, anchor?: HTMLElement | null): void {
  openPicker(anchor || $('#fg'), S.palette[i], 'Apply', (hex) => tool('set_palette_color', { index: i, color: hex }));
}
export function addColor(anchor?: HTMLElement | null): void {
  openPicker(anchor || $('#add-color'), S.palette[S.fg] || '#ff4a1c', 'Add', async (hex) => {
    const r = await tool('add_colors', { colors: [hex] });
    if (r && r.indexes) setFg(r.indexes[0]);
  });
}
