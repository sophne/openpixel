// Bundles the Electron side into dist-electron/: main.cjs for the main process (the shell in electron/, the app's
// logic in host/ and the core's wasm-bindgen glue from core-pkg/, all in one file), preload.cjs for the page's
// sandboxed preload (which may only be one plain script), and core.wasm, the engine itself, next to them.
// `--watch` rebuilds on every change.
import { build, context } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(desktop, 'dist-electron');

/** The pieces electron/seam.ts stands for, and the first one that is not there (null when all are). */
export function hostPieces() {
  const pkg = path.join(desktop, 'core-pkg');
  const files = existsSync(pkg) ? readdirSync(pkg) : [];
  const pieces = {
    host: path.join(desktop, 'host', 'index.ts'),
    node: path.join(desktop, 'host', 'node', 'platform-node.ts'),
    // wasm-bindgen names its files after the crate; whatever the name, there is one glue script and one .wasm.
    glue: path.join(pkg, files.find((f) => f.endsWith('.js') && !f.endsWith('_bg.js')) ?? 'the .js from `npm run build:core`'),
    wasm: path.join(pkg, files.find((f) => f.endsWith('.wasm')) ?? 'the .wasm from `npm run build:core`'),
  };
  const missing = Object.values(pieces).find((p) => !existsSync(p)) ?? null;
  return { ...pieces, missing: missing && path.relative(path.join(desktop, '..'), missing) };
}

/** electron/seam.ts is a typed blank; here it becomes the real modules, when they exist. */
const seam = {
  name: 'openpixel-seam',
  setup(b) {
    b.onLoad({ filter: /[\\/]electron[\\/]seam\.ts$/ }, () => {
      const p = hostPieces();
      if (p.missing) {
        console.warn(`  note: ${p.missing} is not there; this bundle only runs with OPENPIXEL_FAKE_HOST`);
        rmSync(path.join(out, 'core.wasm'), { force: true });
        return undefined; // the blank as it is written
      }
      mkdirSync(out, { recursive: true });
      copyFileSync(p.wasm, path.join(out, 'core.wasm'));
      const from = (file) => JSON.stringify(file);
      return {
        loader: 'ts',
        resolveDir: desktop,
        watchFiles: [p.wasm],
        contents: `export { createHost } from ${from(p.host)};\nexport { nodePlatform } from ${from(p.node)};\n`
          + `import * as core from ${from(p.glue)};\nexport { core };\nexport const missing = undefined;\n`,
      };
    });
  },
};

/** @param {{ onRebuild?: () => void }} [o] */
export function options(o = {}) {
  return {
    absWorkingDir: desktop,
    entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
    outdir: 'dist-electron',
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: true,
    logLevel: 'info',
    // The core's glue is an ES module that mentions its own address, but only as the default place to fetch the
    // .wasm from. The app hands it the bytes (initSync), so in this CommonJS bundle the address is never read.
    define: { 'import.meta.url': '"file:///openpixel/core.js"' },
    plugins: [seam, ...(o.onRebuild ? [{ name: 'rebuilt', setup: (b) => b.onEnd((r) => { if (!r.errors.length) o.onRebuild(); }) }] : [])],
  };
}

/** Builds once, or keeps building: `onRebuild` runs after every successful build. */
export async function buildElectron({ watch = false, onRebuild } = {}) {
  if (!watch) return build(options());
  const ctx = await context(options({ onRebuild }));
  await ctx.watch();
  return ctx;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildElectron({ watch: process.argv.includes('--watch') });
}
