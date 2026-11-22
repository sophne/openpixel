/* The palette presets (app.js 1576–1582): the editor's "Palette preset…" menu and the New file dialog list them. */
export interface PalettePreset { value: string; label: string; colors: string[] }
export const PRESETS: PalettePreset[] = [
  { value: 'db32', label: 'DawnBringer 32', colors: ['#222034', '#663931', '#df7126', '#fbf236', '#6abe30', '#306082', '#5b6ee1', '#d95763'] },
  { value: 'db16', label: 'DawnBringer 16', colors: ['#140c1c', '#442434', '#30346d', '#854c30', '#346524', '#d04648', '#597dce', '#dad45e'] },
  { value: 'pico8', label: 'PICO-8', colors: ['#1d2b53', '#7e2553', '#008751', '#ab5236', '#ff004d', '#ffa300', '#29adff', '#ffccaa'] },
  { value: 'edg32', label: 'Endesga 32', colors: ['#be4a2f', '#d87644', '#feae34', '#63c74d', '#124e89', '#2ce8f5', '#b55088', '#e8b796'] },
  { value: 'grayscale', label: 'Grayscale', colors: ['#111111', '#333333', '#555555', '#777777', '#999999', '#bbbbbb', '#dddddd', '#ffffff'] },
];
