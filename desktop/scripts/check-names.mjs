// Fails when two files would be the same file on macOS or Windows, whose disks ignore letter case: `Home.tsx` next
// to `home.ts` builds on Linux, but there `./Home` finds `home.ts`. Run by `npm run typecheck`.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.', '../core'], { encoding: 'utf8' }).split('\n').filter(Boolean))];
const seen = new Map();
const clashes = [];
for (const file of files) {
  // Same name in other case, and the same module name in other case (imports leave out .ts / .tsx / .js).
  const keys = [file.toLowerCase(), path.join(path.dirname(file), path.parse(file).name).toLowerCase() + '/module'];
  for (const key of keys) {
    const other = seen.get(key);
    if (other && other !== file && (key.endsWith('/module') ? path.parse(other).name !== path.parse(file).name : true)) clashes.push([other, file]);
    else seen.set(key, file);
  }
}
if (clashes.length) {
  console.error('These names are one file on macOS and Windows (letter case is ignored there):');
  for (const [a, b] of clashes) console.error(`  ${a}  ↔  ${b}`);
  process.exit(1);
}
