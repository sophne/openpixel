/* The 3D view (WebGL2): mesh building, the camera, drawing, the axes gizmo and picking (app.js 778–1136).
   Plain drawing code, as before; the Stage component hands over its canvases with attachGL() and attachAxes(). */
import { $ } from '../lib/dom';
import { toast } from '../kit';
import { S } from '../state/ui';
import { cam, dirty, idx, inBounds, ONION } from './core';

export let glCanvas: HTMLCanvasElement;
export let gl: WebGL2RenderingContext | null = null;
let axesCanvas: HTMLCanvasElement | null = null;

/** The #gl canvas, from its ref: `const glCanvas = $('#gl'); const gl = glCanvas.getContext('webgl2', …)`. */
export function attachGL(canvas: HTMLCanvasElement | null): void {
  if (!canvas || canvas === glCanvas) return;
  glCanvas = canvas;
  gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false });
}
export function attachAxes(canvas: HTMLCanvasElement | null): void { if (canvas) axesCanvas = canvas; }

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

interface MeshBuffers { pos: WebGLBuffer | null; col: WebGLBuffer | null; uv: WebGLBuffer | null; idx: WebGLBuffer | null; count: number }
interface LineBuffer { buf: WebGLBuffer | null; count: number }
interface Locations {
  pos: number; col: number; uv: number;
  mvp: WebGLUniformLocation | null; alpha: WebGLUniformLocation | null; edges: WebGLUniformLocation | null;
}
let prog: WebGLProgram | null = null, loc: Locations, meshBuf: MeshBuffers;
const ghostBufs: MeshBuffers[] = [];
const lineBufs: Record<string, LineBuffer> = {};

export function initGL(): void {
  if (!gl) { toast('WebGL 2 is not available; use the Slice view'); return; }
  const g = gl;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!; g.shaderSource(s, src); g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) console.error(g.getShaderInfoLog(s));
    return s;
  };
  prog = g.createProgram();
  g.attachShader(prog, sh(g.VERTEX_SHADER, VS));
  g.attachShader(prog, sh(g.FRAGMENT_SHADER, FS));
  g.linkProgram(prog);
  loc = {
    pos: g.getAttribLocation(prog, 'aPos'), col: g.getAttribLocation(prog, 'aCol'), uv: g.getAttribLocation(prog, 'aUV'),
    mvp: g.getUniformLocation(prog, 'uMVP'), alpha: g.getUniformLocation(prog, 'uAlpha'), edges: g.getUniformLocation(prog, 'uEdges'),
  };
  meshBuf = makeMeshBuffers();
}
function makeMeshBuffers(): MeshBuffers {
  const g = gl!;
  return { pos: g.createBuffer(), col: g.createBuffer(), uv: g.createBuffer(), idx: g.createBuffer(), count: 0 };
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

function buildMesh(grid: Uint8Array, buf: MeshBuffers, alpha = 255): void {
  const g = gl!;
  const { sx, sy, sz } = S;
  const solid = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && grid[(y * sz + z) * sx + x] !== 0;
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
  g.bindBuffer(g.ARRAY_BUFFER, buf.pos); g.bufferData(g.ARRAY_BUFFER, pos, g.DYNAMIC_DRAW);
  g.bindBuffer(g.ARRAY_BUFFER, buf.col); g.bufferData(g.ARRAY_BUFFER, col, g.DYNAMIC_DRAW);
  g.bindBuffer(g.ARRAY_BUFFER, buf.uv); g.bufferData(g.ARRAY_BUFFER, uv, g.DYNAMIC_DRAW);
  g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, buf.idx); g.bufferData(g.ELEMENT_ARRAY_BUFFER, ind, g.DYNAMIC_DRAW);
  buf.count = ind.length;
}

export function lineBuffer(name: string, points: number[]): void {
  if (!gl) return;
  if (!lineBufs[name]) lineBufs[name] = { buf: gl.createBuffer(), count: 0 };
  const lb = lineBufs[name];
  gl.bindBuffer(gl.ARRAY_BUFFER, lb.buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
  lb.count = points.length / 3;
}
export function boxLines(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[] {
  const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return e.flatMap(([a, b]) => [...c[a], ...c[b]]);
}
function buildStaticLines(): void {
  const pts: number[] = [];
  for (let x = 0; x <= S.sx; x++) pts.push(x, 0, 0, x, 0, S.sz);
  for (let z = 0; z <= S.sz; z++) pts.push(0, 0, z, S.sx, 0, z);
  lineBuffer('grid', pts);
  lineBuffer('box', boxLines(0, 0, 0, S.sx, S.sy, S.sz));
}

// --- small matrix kit (column-major, like WebGL)
type Mat = Float32Array;
const M = {
  mul(a: Mat, b: Mat): Mat {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
    }
    return o;
  },
  persp(fovy: number, asp: number, n: number, f: number): Mat {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o;
  },
  ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
  },
  lookAt(e: number[], c: number[], u: number[]): Mat {
    const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const f = norm(sub(c, e)), s = norm(cross(f, u)), uu = cross(s, f);
    return new Float32Array([s[0], uu[0], -f[0], 0, s[1], uu[1], -f[1], 0, s[2], uu[2], -f[2], 0, -dot(s, e), -dot(uu, e), dot(f, e), 1]);
  },
  invert(m: Mat): Mat {
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
  apply(m: Mat, v: number[]): number[] {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) o[r] = m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * v[3];
    return o;
  },
};

/** The starting view: from the front right, a little above, standing back just far enough that the whole model
    (its bounding sphere) fits the canvas, above the drawing toolbar and with a small margin. */
export function resetCamera(): void {
  const st = $('#stage'), tb = $('#toolbar');
  const w = st.clientWidth || 1000, h = st.clientHeight || 600;
  const sr = st.getBoundingClientRect(), tr = tb && tb.offsetHeight ? tb.getBoundingClientRect() : null;
  const band = tr && sr.height ? Math.max(0, sr.bottom - tr.top + 8) : 0; // the toolbar and its gap, kept clear
  const half = 20 * Math.PI / 180, tanH = Math.tan(half) * (w / h);
  const r = 0.5 * Math.hypot(S.sx, S.sy, S.sz);
  const room = Math.max(0.5, (h - band) / h);
  const dist = Math.max(r / Math.sin(half) / room, r / Math.sin(Math.atan(tanH))) * 1.02;
  // Lift the picture by half the toolbar band, so the model sits in the middle of the free space.
  const lift = (band / 2) * (2 * dist * Math.tan(half) / h) / Math.cos(30 * Math.PI / 180);
  Object.assign(cam, { yaw: 45, pitch: 30, dist, tx: S.sx / 2, ty: S.sy / 2 - lift, tz: S.sz / 2 });
  dirty.render3d = true;
  buildStaticLines();
}
function eye(): number[] {
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  return [cam.tx + cam.dist * Math.sin(y) * Math.cos(p), cam.ty + cam.dist * Math.sin(p), cam.tz + cam.dist * Math.cos(y) * Math.cos(p)];
}
let VP: Mat | null = null;
export function viewProj(): Mat {
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

export function resizeCanvas(c: HTMLCanvasElement): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}

export function draw3d(): void {
  if (!gl) return;
  const g = gl;
  if (resizeCanvas(glCanvas)) dirty.render3d = true;
  if (dirty.mesh) {
    buildMesh(S.comp, meshBuf);
    while (ghostBufs.length < S.onion.length) ghostBufs.push(makeMeshBuffers());
    S.onion.forEach((o, i) => buildMesh(o.data, ghostBufs[i], 255));
    if (!lineBufs.grid) buildStaticLines();
    dirty.mesh = false; dirty.render3d = true;
  }
  if (!dirty.render3d) return;
  dirty.render3d = false;
  g.viewport(0, 0, glCanvas.width, glCanvas.height);
  g.clearColor(0x1e / 255, 0x1e / 255, 0x1e / 255, 1);
  g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
  g.enable(g.DEPTH_TEST);
  g.useProgram(prog);
  VP = viewProj();
  g.uniformMatrix4fv(loc.mvp, false, VP);

  const drawMesh = (b: MeshBuffers, alpha: number, edges: boolean) => {
    if (!b.count) return;
    g.uniform1f(loc.alpha, alpha); g.uniform1f(loc.edges, edges ? 1 : 0);
    g.bindBuffer(g.ARRAY_BUFFER, b.pos); g.enableVertexAttribArray(loc.pos); g.vertexAttribPointer(loc.pos, 3, g.FLOAT, false, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, b.col); g.enableVertexAttribArray(loc.col); g.vertexAttribPointer(loc.col, 4, g.UNSIGNED_BYTE, true, 0, 0);
    g.bindBuffer(g.ARRAY_BUFFER, b.uv); g.enableVertexAttribArray(loc.uv); g.vertexAttribPointer(loc.uv, 2, g.UNSIGNED_BYTE, false, 0, 0);
    g.bindBuffer(g.ELEMENT_ARRAY_BUFFER, b.idx);
    g.drawElements(g.TRIANGLES, b.count, g.UNSIGNED_INT, 0);
  };
  const drawLines = (name: string, rgba: number[]) => {
    const lb = lineBufs[name];
    if (!lb || !lb.count) return;
    g.uniform1f(loc.alpha, 1); g.uniform1f(loc.edges, 0);
    g.bindBuffer(g.ARRAY_BUFFER, lb.buf); g.enableVertexAttribArray(loc.pos); g.vertexAttribPointer(loc.pos, 3, g.FLOAT, false, 0, 0);
    g.disableVertexAttribArray(loc.col); g.vertexAttrib4f(loc.col, rgba[0], rgba[1], rgba[2], rgba[3]);
    g.disableVertexAttribArray(loc.uv); g.vertexAttrib2f(loc.uv, 0.5, 0.5);
    g.drawArrays(g.LINES, 0, lb.count);
  };

  g.disable(g.BLEND);
  drawMesh(meshBuf, 1, S.edges);
  g.enable(g.BLEND);
  g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
  if (S.grid) {
    g.depthMask(false);
    drawLines('grid', [200 / 255, 200 / 255, 200 / 255, 0.10]);
    drawLines('box', [200 / 255, 200 / 255, 200 / 255, 0.28]);
    g.depthMask(true);
  }
  // Onion skin: neighbouring frames, faded (opacity 68 for the nearest frame).
  if (S.onionOn) {
    g.depthMask(false);
    S.onion.forEach((_o, i) => drawMesh(ghostBufs[i], ONION.base / 255, false));
    g.depthMask(true);
  }
  if (lineBufs.cursor && lineBufs.cursor.count) {
    g.disable(g.DEPTH_TEST);
    drawLines('cursor', [1, 0x4a / 255, 0x1c / 255, 0.95]);
    g.enable(g.DEPTH_TEST);
  }
  drawAxes();
}

function drawAxes(): void {
  const c = axesCanvas || $<HTMLCanvasElement>('#axes'), g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  if (S.mode !== '3d') return;
  const y = cam.yaw * Math.PI / 180, p = cam.pitch * Math.PI / 180;
  const r = [Math.cos(y), 0, -Math.sin(y)];
  const v = [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  // screen-up vector, negated because canvas y grows downward
  const up = [-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)];
  const axes: [string, number[], string][] = [['X', [1, 0, 0], '#d95763'], ['Y', [0, 1, 0], '#6abe30'], ['Z', [0, 0, 1], '#5b6ee1']];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
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
export interface Ray { o: number[]; d: number[] }
export interface Hit { x: number; y: number; z: number; n: number[]; ground?: boolean }
export interface Pick { hit: Hit | null; place: number[] | null; n: number[]; ray: Ray }

export function ray(mx: number, my: number): Ray {
  const w = glCanvas.clientWidth, h = glCanvas.clientHeight;
  const inv = M.invert(VP || viewProj());
  const nx = 2 * mx / w - 1, ny = 1 - 2 * my / h;
  const a = M.apply(inv, [nx, ny, -1, 1]), b = M.apply(inv, [nx, ny, 1, 1]);
  const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]], l = Math.hypot(d[0], d[1], d[2]);
  return { o, d: d.map((t) => t / l) };
}
function castGrid(r: Ray, grid: Uint8Array): Hit | null {
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
function groundHit(r: Ray): Hit | null {
  if (r.d[1] >= -1e-6) return null;
  const t = -r.o[1] / r.d[1];
  const x = Math.floor(r.o[0] + r.d[0] * t), z = Math.floor(r.o[2] + r.d[2] * t);
  return inBounds(x, 0, z) ? { x, y: 0, z, n: [0, 1, 0], ground: true } : null;
}
/** Where a click lands: the voxel under the mouse (`hit`) and the empty cell in front of it (`place`). */
export function pick(mx: number, my: number, grid: Uint8Array = S.comp): Pick | null {
  const r = ray(mx, my);
  const hit = castGrid(r, grid);
  if (hit) {
    const place = [hit.x + hit.n[0], hit.y + hit.n[1], hit.z + hit.n[2]];
    return { hit, place: inBounds(place[0], place[1], place[2]) ? place : null, n: hit.n, ray: r };
  }
  const g = groundHit(r);
  return g ? { hit: null, place: [g.x, 0, g.z], n: g.n, ray: r } : null;
}
export function planeCell(r: Ray, axis: number, cell: number): number[] | null {
  const k = axis, v = cell + 0.5;
  if (Math.abs(r.d[k]) < 1e-9) return null;
  const t = (v - r.o[k]) / r.d[k];
  if (t < 0) return null;
  const p = r.o.map((o, i) => Math.floor(o + r.d[i] * t));
  p[k] = cell;
  return p;
}
