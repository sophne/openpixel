#!/usr/bin/env node
// The last look before a release is published: the folder must hold every file a release carries, for all three
// systems, and nothing else. A release is either complete or not published.
//
//   node scripts/check-release.mjs <folder> --version 1.2.0
//
// Checked: every file of the contract is there (scripts/release-build.mjs: RELEASE_FILES); each system's update
// feed carries this version, points the updater at the right installer, and its sizes and SHA-512 checksums are
// those of the files in the folder (so what the updater will download is what was built); nothing unexpected is
// in the folder. `appcast.xml` (the bridge for the old Mac app) may be there: then it must name this version and
// its signature must be OpenPixel's Sparkle key's signature of this very OpenPixel.dmg.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyUpdate } from './appcast.mjs';
import { ALL_RELEASE_FILES, RELEASE_FILES, checkFiles } from './release-build.mjs';
import { releaseVersion } from './set-version.mjs';

export const APPCAST = 'appcast.xml';

/** Problems with the bridge appcast in `folder` ([] when fine). */
export function checkAppcast(folder, version) {
  const text = readFileSync(path.join(folder, APPCAST), 'utf8');
  const problems = [];
  const short = /<sparkle:shortVersionString>([^<]*)<\/sparkle:shortVersionString>/.exec(text)?.[1];
  if (short !== version) problems.push(`${APPCAST} offers version ${short}, expected ${version}`);
  if (!/<sparkle:version>[1-9][0-9]*<\/sparkle:version>/.test(text)) problems.push(`${APPCAST} has no build number`);
  const enclosure = /<enclosure url="([^"]*)" sparkle:edSignature="([^"]*)" length="([0-9]+)"/.exec(text);
  if (!enclosure) return [...problems, `${APPCAST} has no signed download`];
  if (!enclosure[1].endsWith(`/releases/download/v${version}/OpenPixel.dmg`)) problems.push(`${APPCAST} links to ${enclosure[1]}`);
  const dmg = path.join(folder, 'OpenPixel.dmg');
  if (!existsSync(dmg)) return problems; // reported by the caller
  if (statSync(dmg).size !== Number(enclosure[3])) problems.push(`${APPCAST} says OpenPixel.dmg is ${enclosure[3]} bytes, it is ${statSync(dmg).size}`);
  let ok = false;
  try { ok = verifyUpdate(readFileSync(dmg), enclosure[2]); } catch { /* not a signature at all */ }
  if (!ok) problems.push(`${APPCAST}: the signature is not the Sparkle key's signature of OpenPixel.dmg`);
  return problems;
}

/** Everything that is wrong with the release in `folder` ([] when it can be published). */
export function checkRelease(folder, version) {
  const v = releaseVersion(version);
  const problems = [];
  for (const platform of Object.keys(RELEASE_FILES)) problems.push(...checkFiles(platform, folder, v));
  const allowed = new Set([...ALL_RELEASE_FILES, APPCAST]);
  for (const name of readdirSync(folder)) if (!allowed.has(name)) problems.push(`${name} is not a release file`);
  if (existsSync(path.join(folder, APPCAST))) problems.push(...checkAppcast(folder, v));
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const folder = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--version');
  const version = args[args.indexOf('--version') + 1];
  if (!folder || !args.includes('--version') || !version) {
    console.error('usage: node scripts/check-release.mjs <folder> --version <1.2.0>');
    process.exit(2);
  }
  let problems;
  try { problems = checkRelease(folder, version); } catch (e) { problems = [e.message]; }
  if (problems.length) {
    console.error(`This release is not complete:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  const names = readdirSync(folder).sort();
  console.log(`OpenPixel ${releaseVersion(version)}: ${names.length} files, complete.`);
  for (const name of names) console.log(`  ${name}  ${statSync(path.join(folder, name)).size} bytes`);
}
