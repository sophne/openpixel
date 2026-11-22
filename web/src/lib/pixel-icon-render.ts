/**
 * Drawing and exporting the pixel icons. An icon is stored as its stroke only (32 rows of 32 bits, base64; see
 * web/scripts/icons/build.py): the outline is the stroke grown by one pixel up, down, left and right, and the shadow
 * is stroke and outline moved one pixel down and to the right. That's why every colour can change freely.
 *
 * Nothing here touches the DOM except the PNG and clipboard helpers, so the paths also render on the server.
 */

export const N = 32;

export type IconStyle = {
  stroke: string;
  outline: string;
  shadow: string;
  /** Draw the outline (the border around the stroke). */
  border: boolean;
  /** Draw the drop shadow. */
  drop: boolean;
  /** Size in CSS or image pixels; whole multiples of 32 keep every pixel square. */
  size: number;
};

export const DEFAULT_STYLE: IconStyle = {
  stroke: "#ffffff",
  outline: "#000000",
  shadow: "#4b4b55",
  border: true,
  drop: true,
  size: 64,
};

export type Masks = { stroke: Uint8Array; outline: Uint8Array; shadow: Uint8Array };
export type Paths = { stroke: string; outline: string; shadow: string };

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

/** The three layers of an icon, one byte per pixel (row by row, top to bottom). */
export function masks(packed: string): Masks {
  const bytes = decodeBase64(packed);
  const stroke = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) stroke[y * N + x] = (bytes[y * 4 + (x >> 3)] >> (7 - (x & 7))) & 1;
  const at = (m: Uint8Array, x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? m[y * N + x] : 0);
  const outline = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!stroke[i] && (at(stroke, x - 1, y) || at(stroke, x + 1, y) || at(stroke, x, y - 1) || at(stroke, x, y + 1)))
        outline[i] = 1;
    }
  const shadow = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      if (!stroke[i] && !outline[i] && (at(stroke, x - 1, y - 1) || at(outline, x - 1, y - 1))) shadow[i] = 1;
    }
  return { stroke, outline, shadow };
}

/** An SVG path of the set pixels, one rectangle per horizontal run. */
function runs(m: Uint8Array): string {
  let d = "";
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      if (m[y * N + x]) {
        const s = x;
        while (x < N && m[y * N + x]) x++;
        d += `M${s} ${y}h${x - s}v1h${s - x}z`;
      } else x++;
    }
  }
  return d;
}

export function paths(m: Masks): Paths {
  return { stroke: runs(m.stroke), outline: runs(m.outline), shadow: runs(m.shadow) };
}

/** Layers to draw, back to front, with their colours. */
function visible(p: Paths, style: IconStyle): [d: string, color: string][] {
  const out: [string, string][] = [];
  if (style.drop && p.shadow) out.push([p.shadow, style.shadow]);
  if (style.border && p.outline) out.push([p.outline, style.outline]);
  if (p.stroke) out.push([p.stroke, style.stroke]);
  return out;
}

export function toSvg(p: Paths, style: IconStyle): string {
  const body = visible(p, style)
    .map(([d, c]) => `<path fill="${c}" d="${d}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${style.size}" height="${style.size}" ` +
    `viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${body}</svg>`
  );
}

/** "arrow-big-down" → "ArrowBigDown"; names starting with a digit get a prefix to stay valid identifiers. */
export function componentName(name: string): string {
  const pascal = name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  return /^[0-9]/.test(pascal) ? `Icon${pascal}` : pascal;
}

export function toJsx(name: string, p: Paths, style: IconStyle): string {
  const body = visible(p, style)
    .map(([d, c]) => `      <path fill="${c}" d="${d}" />`)
    .join("\n");
  return [
    `export function ${componentName(name)}Pixel(props: React.SVGProps<SVGSVGElement>) {`,
    "  return (",
    `    <svg xmlns="http://www.w3.org/2000/svg" width={${style.size}} height={${style.size}} viewBox="0 0 ${N} ${N}" shapeRendering="crispEdges" {...props}>`,
    body,
    "    </svg>",
    "  );",
    "}",
    "",
  ].join("\n");
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** The icon as a PNG of `size` pixels, scaled with nearest-neighbour. */
export function toPngBlob(m: Masks, style: IconStyle, size = style.size): Promise<Blob> {
  const small = document.createElement("canvas");
  small.width = small.height = N;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(N, N);
  const layers: [Uint8Array, string, boolean][] = [
    [m.shadow, style.shadow, style.drop],
    [m.outline, style.outline, style.border],
    [m.stroke, style.stroke, true],
  ];
  for (const [mask, color, on] of layers) {
    if (!on) continue;
    const [r, g, b] = rgb(color);
    for (let i = 0; i < N * N; i++)
      if (mask[i]) {
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
  }
  sctx.putImageData(img, 0, 0);
  const big = document.createElement("canvas");
  big.width = big.height = size;
  const ctx = big.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, size, size);
  return new Promise((resolve, reject) => big.toBlob((b) => (b ? resolve(b) : reject(new Error("no PNG"))), "image/png"));
}

/** A raw DEFLATE stream of stored (uncompressed) blocks: what .openpixel cels hold, with no compressor needed. */
function storedDeflate(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(data.length + blocks * 5);
  let o = 0;
  for (let b = 0; b < blocks; b++) {
    const chunk = data.subarray(b * 65535, Math.min(data.length, (b + 1) * 65535));
    out[o++] = b === blocks - 1 ? 1 : 0;
    out[o++] = chunk.length & 255;
    out[o++] = chunk.length >> 8;
    out[o++] = ~chunk.length & 255;
    out[o++] = (~chunk.length >> 8) & 255;
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * The icon as an OpenPixel file: a 32×32 sprite with the outline, stroke and shadow as palette colours 1-3, so it
 * opens in the app ready to edit. Cells run x fastest, then z, then y from the bottom row up.
 */
export function toOpenPixel(name: string, m: Masks, style: IconStyle): string {
  const cells = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const v = m.stroke[i] ? 2 : style.border && m.outline[i] ? 1 : style.drop && m.shadow[i] ? 3 : 0;
      cells[(N - 1 - y) * N + x] = v;
    }
  const file = {
    cels: [{ data: base64(storedDeflate(cells)), encoding: "zlib-base64", frame: 0, layer: 0 }],
    format: "openpixel",
    frames: [{ duration: 100 }],
    layers: [{ locked: false, name, visible: true }],
    name,
    palette: ["transparent", style.outline, style.stroke, style.shadow],
    size: [N, N, 1],
    version: 1,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

// ---------- zip (stored), for downloading many icons at once without a library

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { path: string; data: Uint8Array };

/** A zip of uncompressed entries (PNG and the small SVGs gain little from compressing). */
export function zip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 2026-01-01 00:00 in DOS time, so the same icons always give the same file.
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const crc = crc32(e.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, e.data.length, true);
    local.setUint32(22, e.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, e.data);

    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, 0, true);
    head.setUint16(14, date, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, e.data.length, true);
    head.setUint32(24, e.data.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + e.data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

/** Saves a Blob or text as a file. */
export function save(data: Blob | string, file: string, type = "application/octet-stream") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
