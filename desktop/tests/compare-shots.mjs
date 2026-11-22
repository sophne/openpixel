// Compares the pictures of two UI-test runs (the old page and the React page): for every picture name present in
// both folders it writes a side-by-side composite (old | new | difference) and a summary with the share of
// differing pixels per picture, as JSON and as Markdown.
//
//   node tests/compare-shots.mjs [<old folder> <new folder>] [--out <folder>] [--threshold 0.1] [--max <percent>]
//
// Defaults: test-results/legacy, test-results/react, test-results/compare. With --max the script exits 1 when any
// picture differs by more than that many percent (or exists in one folder only).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const GAP = 8;

/** A copy of `png` on a `width`×`height` sheet; what the picture does not cover gets `fill`, a colour no page has. */
function onSheet(png, width, height, fill) {
  if (png.width === width && png.height === height) return png;
  const sheet = new PNG({ width, height });
  for (let i = 0; i < sheet.data.length; i += 4) sheet.data.set(fill, i);
  PNG.bitblt(png, sheet, 0, 0, png.width, png.height, 0, 0);
  return sheet;
}

/** Compares two folders of PNGs. Returns the summary (also written to `<out>/summary.json` and `summary.md`). */
export function compareShots(oldDir, newDir, out, { threshold = 0.1 } = {}) {
  const names = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort() : []);
  const olds = names(oldDir), news = new Set(names(newDir));
  mkdirSync(out, { recursive: true });
  const pictures = [];
  for (const name of olds.filter((n) => news.has(n))) {
    const a = PNG.sync.read(readFileSync(path.join(oldDir, name))), b = PNG.sync.read(readFileSync(path.join(newDir, name)));
    // Pictures of different sizes are compared on a sheet that holds both; the uncovered part counts as different.
    const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
    const left = onSheet(a, width, height, [255, 0, 255, 255]), right = onSheet(b, width, height, [0, 255, 0, 255]), diff = new PNG({ width, height });
    const differing = pixelmatch(left.data, right.data, diff.data, width, height, { threshold });
    const sheet = new PNG({ width: width * 3 + GAP * 2, height });
    sheet.data.fill(0x30); // a dark gutter between the three
    for (let i = 3; i < sheet.data.length; i += 4) sheet.data[i] = 255;
    [left, right, diff].forEach((p, i) => PNG.bitblt(p, sheet, 0, 0, width, height, i * (width + GAP), 0));
    writeFileSync(path.join(out, name), PNG.sync.write(sheet));
    pictures.push({ name, width, height, sameSize: a.width === b.width && a.height === b.height,
      oldSize: [a.width, a.height], newSize: [b.width, b.height], differing, percent: Math.round((differing / (width * height)) * 1e5) / 1e3 });
  }
  const summary = {
    old: oldDir, new: newDir, threshold,
    compared: pictures.length,
    identical: pictures.filter((p) => p.differing === 0).length,
    worst: pictures.reduce((m, p) => Math.max(m, p.percent), 0),
    onlyInOld: olds.filter((n) => !news.has(n)),
    onlyInNew: [...news].filter((n) => !olds.includes(n)).sort(),
    pictures,
  };
  writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const rows = [...pictures].sort((x, y) => y.percent - x.percent)
    .map((p) => `| [${p.name}](${encodeURI(p.name)}) | ${p.width}×${p.height}${p.sameSize ? '' : ` (old ${p.oldSize.join('×')}, new ${p.newSize.join('×')})`} | ${p.differing} | ${p.percent.toFixed(3)} % |`);
  writeFileSync(path.join(out, 'summary.md'), [
    '# Old page and React page, picture by picture', '',
    `Old: \`${oldDir}\`  `, `New: \`${newDir}\`  `,
    `${summary.compared} pictures compared, ${summary.identical} identical, worst ${summary.worst.toFixed(3)} % (threshold ${threshold}).`, '',
    'Each linked picture shows old | new | difference.', '',
    '| Picture | Size | Differing pixels | Share |', '|---|---|---:|---:|', ...rows, '',
    ...(summary.onlyInOld.length ? [`Only in the old run: ${summary.onlyInOld.join(', ')}`, ''] : []),
    ...(summary.onlyInNew.length ? [`Only in the new run: ${summary.onlyInNew.join(', ')}`, ''] : []),
  ].join('\n'));
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const argv = process.argv.slice(2), plain = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--out', '--threshold', '--max'].includes(argv[i])) opt[argv[i].slice(2)] = argv[++i]; else plain.push(argv[i]);
  }
  const results = path.join(desktop, 'test-results');
  const oldDir = path.resolve(plain[0] ?? path.join(results, 'legacy')), newDir = path.resolve(plain[1] ?? path.join(results, 'react'));
  const out = path.resolve(opt.out ?? path.join(results, 'compare'));
  for (const dir of [oldDir, newDir]) if (!existsSync(dir)) { console.error(`No such folder: ${dir}`); process.exit(2); }
  const s = compareShots(oldDir, newDir, out, { threshold: opt.threshold === undefined ? 0.1 : Number(opt.threshold) });
  for (const p of [...s.pictures].sort((x, y) => y.percent - x.percent)) console.log(`${p.percent.toFixed(3).padStart(8)} %  ${p.name}${p.sameSize ? '' : '  (sizes differ)'}`);
  console.log(`${s.compared} compared, ${s.identical} identical, worst ${s.worst.toFixed(3)} %` +
    `${s.onlyInOld.length ? `, ${s.onlyInOld.length} only in old` : ''}${s.onlyInNew.length ? `, ${s.onlyInNew.length} only in new` : ''}`);
  console.log(`Composites and summary.md / summary.json in ${out}`);
  const max = opt.max === undefined ? null : Number(opt.max);
  if (max !== null && (s.worst > max || s.onlyInOld.length || s.onlyInNew.length || !s.compared)) process.exit(1);
}
