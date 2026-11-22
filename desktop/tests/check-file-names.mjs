// Fails when two files or folders in desktop/ would be one on a file system that ignores letter case (macOS and
// Windows by default): paths that differ only in case, and files in one folder whose names differ only in case once
// the extension is left off (`NewPage.tsx` next to `newpage.ts`: an import of './NewPage' then finds either, and
// which one depends on the system). Linux keeps such names apart, so nothing else notices until the app is built
// elsewhere. Part of `npm run typecheck`.
//
//   node tests/check-file-names.mjs [<folder>]      the folder defaults to desktop/
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
/** Generated and installed folders: not ours to name. */
const SKIP = new Set(['node_modules', 'dist', 'dist-electron', 'release', 'test-results', 'core-pkg', '.git']);

/** The files to look at, as paths from `root` with forward slashes: what git tracks (its list keeps both of two
    names even where the file system holds only one of them) plus what is on disk and not ignored by SKIP. */
function files() {
  const found = new Set();
  const git = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  if (git.status === 0) for (const f of git.stdout.split('\0')) if (f) found.add(f);
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), at); else found.add(at);
    }
  };
  walk(root, '');
  return [...found].filter((f) => !f.split('/').some((part) => SKIP.has(part))).sort();
}

/** `names` grouped by `key(name)`; only the groups in which the names themselves differ. */
function clashes(names, key) {
  const groups = new Map();
  for (const n of names) groups.set(key(n), [...(groups.get(key(n)) ?? []), n]);
  return [...groups.values()].filter((g) => new Set(g).size > 1).map((g) => [...new Set(g)]);
}

const all = files();
// Every folder on the way to a file counts as a path too.
const paths = new Set(all);
for (const f of all) for (let d = path.posix.dirname(f); d !== '.'; d = path.posix.dirname(d)) paths.add(d);

const problems = [];
for (const g of clashes([...paths], (p) => p.toLowerCase())) problems.push(`differ only in letter case: ${g.join('  and  ')}`);

/** A name without its extension, as an import names it: NewPage.tsx → NewPage, runner.test.ts → runner.test. */
const stem = (name) => (name.includes('.') && !name.startsWith('.') ? name.slice(0, name.lastIndexOf('.')) : name);
const byFolder = new Map();
for (const f of all) byFolder.set(path.posix.dirname(f), [...(byFolder.get(path.posix.dirname(f)) ?? []), path.posix.basename(f)]);
for (const [folder, names] of byFolder) {
  for (const g of clashes(names, (n) => stem(n).toLowerCase())) {
    // The same stem written the same way (index.html and index.ts) is one name on every system: only differing case counts.
    if (new Set(g.map(stem)).size < 2) continue;
    // Already reported above when the whole names differ only in case.
    if (new Set(g.map((n) => n.toLowerCase())).size < g.length) continue;
    problems.push(`differ only in letter case and extension: ${g.map((n) => (folder === '.' ? n : `${folder}/${n}`)).join('  and  ')}`);
  }
}

if (problems.length) {
  console.error(`File names that are one name where letter case is ignored (macOS, Windows), in ${root}:`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('Rename one of each pair (and the imports that name it).');
  process.exit(1);
}
console.log(`file names: ${all.length} files in ${path.basename(root)}/, none differ only in letter case`);
