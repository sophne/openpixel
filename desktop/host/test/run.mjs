// `npm test`: type-checks the host (host/tsconfig.json: no Node; host/node/tsconfig.json: Node) and runs every
// *.test.ts under host/ with Node's own test runner. The tests are bundled first (esbuild), since the sources
// import each other without file extensions, the way the shell and the page bundle them.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const desktop = path.dirname(host);
const flags = process.argv.slice(2);
const only = flags.filter((f) => !f.startsWith('--'));

function find(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) find(file, out);
    else if (entry.name.endsWith('.test.ts')) out.push(file);
  }
  return out;
}

if (!flags.includes('--no-typecheck')) {
  const tsc = path.join(desktop, 'node_modules', 'typescript', 'bin', 'tsc');
  for (const project of ['host/tsconfig.json', 'host/node/tsconfig.json']) {
    const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', project], { cwd: desktop, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const tests = find(host).filter((f) => only.length === 0 || only.some((o) => f.includes(o))).sort();
const outdir = path.join(desktop, 'dist', 'host-test');
fs.rmSync(outdir, { recursive: true, force: true });
await build({
  entryPoints: tests,
  outdir,
  outbase: host,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outExtension: { '.js': '.mjs' },
  sourcemap: 'inline',
  packages: 'external',
  logLevel: 'warning',
});
const built = tests.map((f) => path.join(outdir, path.relative(host, f)).replace(/\.ts$/, '.mjs'));
const run = spawnSync(process.execPath, ['--enable-source-maps', '--test', '--test-reporter=spec', ...built], { cwd: desktop, stdio: 'inherit' });
process.exit(run.status ?? 1);
