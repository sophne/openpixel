// TEMPORARY (remove before merging): what Electron on Windows writes to standard output when an agent starts it
// with pipes, in a few variations, to find where a stray "\r\n" before the MCP answer comes from.
//   node stdout-probe.mjs <folder with node_modules/electron>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const electron = createRequire(path.join(root, 'x.js'))('electron');
const child = path.join(root, 'child.cjs');
writeFileSync(child, "process.stdout.write('CHILD\\n');\n");

const app = (name, main) => {
  const dir = path.join(root, 'apps', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, main: 'main.cjs' }));
  writeFileSync(path.join(dir, 'main.cjs'), main);
  return dir;
};
const node = JSON.stringify(process.execPath), childJs = JSON.stringify(child);
const apps = {
  exit: app('exit', 'process.exit(0);\n'),
  stdoutWrite: app('stdoutWrite', "process.stdout.write('MAIN\\n'); process.exit(0);\n"),
  spawnHidden: app('spawnHidden', `const r = require('child_process').spawnSync(${node}, [${childJs}], { stdio: 'inherit', windowsHide: true }); process.exit(r.status ?? 1);\n`),
  spawnShown: app('spawnShown', `const r = require('child_process').spawnSync(${node}, [${childJs}], { stdio: 'inherit', windowsHide: false }); process.exit(r.status ?? 1);\n`),
  requireElectronThenExit: app('requireElectronThenExit', "require('electron'); process.exit(0);\n"),
  readyThenExit: app('readyThenExit', "require('electron').app.whenReady().then(() => process.exit(0));\n"),
};

function run(dir, args, env) {
  return new Promise((resolve) => {
    const p = spawn(electron, [dir, ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const t = setTimeout(() => p.kill(), 30_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
    p.stdin.end();
  });
}

const short = process.argv.includes('--short');
const allVariants = [
  ['plain', [], {}],
  ['--mcp --headless', ['--mcp', '--headless'], {}],
  ['ELECTRON_NO_ATTACH_CONSOLE=1', [], { ELECTRON_NO_ATTACH_CONSOLE: '1' }],
  ['--headless only', ['--headless'], {}],
];
const variants = short ? allVariants.slice(0, 1) : allVariants;
const chosen = short ? ['exit', 'stdoutWrite'] : Object.keys(apps);
console.log(`Electron ${createRequire(path.join(root, 'x.js'))('electron/package.json').version}`);
for (const name of chosen) {
  const dir = apps[name];
  for (const [vname, args, env] of variants) {
    const r = await run(dir, args, env);
    console.log(`${name.padEnd(24)} ${vname.padEnd(30)} exit ${r.code}  stdout ${JSON.stringify(r.out)}  stderr ${JSON.stringify(r.err.slice(0, 160))}`);
  }
}
