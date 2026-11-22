// On a Mac, the menu bar's app menu, the Dock and the About panel take the app's name and icon from the bundle's
// Info.plist, which `app.setName` cannot change. `npm run dev` runs Electron's own Electron.app, so they all said
// "Electron" and showed Electron's icon. This makes a copy of that bundle named OpenPixel with OpenPixel's icon
// (node_modules/.openpixel-dev/OpenPixel.app, made again whenever Electron or the icon changes) for dev.mjs to run.
//
// The copy is an APFS clone where the disk allows it, so it takes no room; only Info.plist and the icon differ, and
// the outer bundle is signed again (ad hoc, as Electron ships) so its signature matches them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SIZES = [16, 32, 128, 256, 512];

/** The Electron program to run for dev: inside the OpenPixel copy on a Mac, Electron's own elsewhere. */
export function devElectron(electron, desktop, version) {
  if (process.platform !== 'darwin') return electron;
  try {
    return makeBundle(electron, desktop, version);
  } catch (e) {
    console.warn(`Running Electron as it is (the menu bar will say Electron): ${e.message}`);
    return electron;
  }
}

function makeBundle(electron, desktop, version) {
  const source = path.resolve(electron, '../../..'); // …/Electron.app/Contents/MacOS/Electron
  const iconFolder = path.join(desktop, 'assets', 'icon');
  const folder = path.join(desktop, 'node_modules', '.openpixel-dev');
  const bundle = path.join(folder, 'OpenPixel.app');
  const program = path.join(bundle, 'Contents', 'MacOS', path.basename(electron));

  const hash = createHash('sha256');
  hash.update(readFileSync(path.join(source, 'Contents', 'Info.plist')));
  hash.update(version);
  for (const size of [...SIZES, ...SIZES.map((s) => s * 2)]) hash.update(readFileSync(path.join(iconFolder, `icon_${size}.png`)));
  const stamp = hash.digest('hex');
  const stampFile = path.join(folder, 'stamp');
  if (existsSync(program) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) return program;

  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  try { execFileSync('cp', ['-cR', source, bundle], { stdio: 'ignore' }); }
  catch { rmSync(bundle, { recursive: true, force: true }); execFileSync('cp', ['-R', source, bundle]); }

  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const set = (key, value) => execFileSync('plutil', ['-replace', key, '-string', value, plist]);
  set('CFBundleName', 'OpenPixel');
  set('CFBundleDisplayName', 'OpenPixel');
  set('CFBundleShortVersionString', version);
  set('CFBundleVersion', 'dev');
  const iconFile = execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', plist], { encoding: 'utf8' }).trim();
  writeIcns(iconFolder, path.join(bundle, 'Contents', 'Resources', iconFile));
  execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'ignore' });

  writeFileSync(stampFile, stamp);
  return program;
}

/** The app's PNGs as an .icns (iconutil wants a folder of icon_<size>[@2x].png). */
function writeIcns(iconFolder, target) {
  const work = mkdtempSync(path.join(os.tmpdir(), 'openpixel-icon-'));
  try {
    const set = path.join(work, 'icon.iconset');
    mkdirSync(set);
    for (const size of SIZES) {
      copyFileSync(path.join(iconFolder, `icon_${size}.png`), path.join(set, `icon_${size}x${size}.png`));
      copyFileSync(path.join(iconFolder, `icon_${size * 2}.png`), path.join(set, `icon_${size}x${size}@2x.png`));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', target]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
