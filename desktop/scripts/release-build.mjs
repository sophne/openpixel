#!/usr/bin/env node
// Builds one system's installers for a release and puts exactly the files the release carries into
// release/upload/. The release workflow runs it on macOS, Windows and Linux; it also runs by hand (RELEASING.md).
//
//   node scripts/release-build.mjs --platform mac|win|linux [--build-number <commit count>]
//
// It expects the app to be built already (`npm run build:core`, the native `openpixel` program for every
// processor being packed, `npm run build`) and the version stamped (scripts/set-version.mjs).
//
// What it adds to electron-builder.yml, per build:
//   - macOS signing. With a Developer ID certificate the app is signed with the hardened runtime and, when the
//     notarization key is there too, notarized and stapled. Without one it is signed ad hoc, so it still runs on
//     Apple silicon and Intel (macOS asks people to confirm the first launch). The certificate and keys arrive under
//     the names the release environment's secrets have had since the Mac-only pipeline:
//       MACOS_CERT_P12 (base64 of the .p12), MACOS_CERT_PASSWORD      → electron-builder's CSC_LINK, CSC_KEY_PASSWORD
//       NOTARY_KEY_P8 (base64 of the .p8), NOTARY_KEY_ID, NOTARY_ISSUER_ID → APPLE_API_KEY (a file), APPLE_API_KEY_ID, APPLE_API_ISSUER
//     (KEYCHAIN_PASSWORD is not needed any more: electron-builder makes its own temporary keychain.)
//     On a Mac with the certificate in the keychain, CSC_NAME="Developer ID Application: …" does the same.
//   - macOS build number (CFBundleVersion) = --build-number, the commit count, as the old Mac app's releases had:
//     its updater (Sparkle) only moves to a higher one.
//   - `openpixel.selfUpdate` in the packaged package.json: whether this build may install updates by itself
//     (electron/updater.ts). True for Windows and Linux; for macOS only when signed with a Developer ID.
//   - Windows is never code-signed here (there is no certificate), whatever the environment holds.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The files each system adds to a release (the contract's fixed names). The feed is the last of each list. */
export const RELEASE_FILES = {
  mac: ['OpenPixel.dmg', 'OpenPixel-mac.zip', 'latest-mac.yml'],
  win: ['OpenPixel-Setup.exe', 'latest.yml'],
  linux: ['OpenPixel.AppImage', 'openpixel.deb', 'latest-linux.yml'],
};
/** The installer the app's updater downloads on each system: what the feed's `path` must name. */
export const UPDATER_FILE = { mac: 'OpenPixel-mac.zip', win: 'OpenPixel-Setup.exe', linux: 'OpenPixel.AppImage' };
export const ALL_RELEASE_FILES = Object.values(RELEASE_FILES).flat();

const has = (v) => typeof v === 'string' && v.trim() !== '';

/** How this build is signed, from the environment. Returns the variables electron-builder reads (`env`), the
    notarization key still to be written to a file (`notaryKeyP8`, base64), and what to tell the person (`notes`).
    Throws Error(text) when the environment is half set. */
export function signingPlan(platform, env) {
  const plan = { developerId: false, notarize: false, env: {}, notaryKeyP8: undefined, notes: [] };
  if (platform !== 'mac') {
    if (platform === 'win') plan.notes.push('Windows: the installer is not code-signed (no certificate). SmartScreen asks people to confirm the first run.');
    return plan;
  }
  if (has(env.MACOS_CERT_P12)) {
    if (!has(env.MACOS_CERT_PASSWORD)) throw new Error('MACOS_CERT_P12 is set but MACOS_CERT_PASSWORD is not');
    plan.developerId = true;
    plan.env.CSC_LINK = env.MACOS_CERT_P12.trim();
    plan.env.CSC_KEY_PASSWORD = env.MACOS_CERT_PASSWORD;
  } else if (has(env.CSC_LINK)) {
    plan.developerId = true;
    plan.env.CSC_LINK = env.CSC_LINK;
    if (has(env.CSC_KEY_PASSWORD)) plan.env.CSC_KEY_PASSWORD = env.CSC_KEY_PASSWORD;
  } else if (has(env.CSC_NAME)) {
    plan.developerId = true;
    plan.env.CSC_NAME = env.CSC_NAME;
  }
  const notary = [env.NOTARY_KEY_P8 ?? env.APPLE_API_KEY, env.NOTARY_KEY_ID ?? env.APPLE_API_KEY_ID, env.NOTARY_ISSUER_ID ?? env.APPLE_API_ISSUER];
  const given = notary.filter(has).length;
  if (given !== 0 && given !== 3) throw new Error('NOTARY_KEY_P8, NOTARY_KEY_ID and NOTARY_ISSUER_ID go together: set all three or none');
  if (!plan.developerId) {
    plan.notes.push('macOS: no Developer ID certificate: this build is ad-hoc signed and not notarized. It runs, but macOS asks people to confirm the first launch, and the app cannot install its own updates (its Update button opens the download page).');
    if (given === 3) plan.notes.push('macOS: the notarization key is ignored without a Developer ID certificate.');
    return plan;
  }
  if (given === 3) {
    plan.notarize = true;
    if (has(env.NOTARY_KEY_P8)) plan.notaryKeyP8 = env.NOTARY_KEY_P8.trim();
    else plan.env.APPLE_API_KEY = env.APPLE_API_KEY;
    plan.env.APPLE_API_KEY_ID = (env.NOTARY_KEY_ID ?? env.APPLE_API_KEY_ID).trim();
    plan.env.APPLE_API_ISSUER = (env.NOTARY_ISSUER_ID ?? env.APPLE_API_ISSUER).trim();
    plan.notes.push('macOS: signed with the Developer ID, hardened runtime; notarized and stapled.');
  } else {
    plan.notes.push('macOS: signed with the Developer ID, but not notarized (no notarization key): Gatekeeper still asks people to confirm the first launch.');
  }
  return plan;
}

/** Whether a build for `platform` signed as `plan` says may install updates by itself. */
export const selfUpdates = (platform, plan) => (platform === 'mac' ? plan.developerId : true);

/** What is laid over electron-builder.yml for this build. Every value has its real type here (on the command line,
    `-c.mac.hardenedRuntime=false` would arrive as the text "false", which counts as true). */
export function buildConfig(platform, plan, buildNumber) {
  const config = { extraMetadata: { openpixel: { selfUpdate: selfUpdates(platform, plan) } } };
  if (platform === 'mac') {
    config.mac = plan.developerId
      // The identity is found in the keychain electron-builder makes from CSC_LINK (or by CSC_NAME).
      ? { hardenedRuntime: true, notarize: plan.notarize }
      // "-" is codesign's ad-hoc identity. No hardened runtime: without a team, library validation would refuse
      // Electron's own frameworks. No timestamp server either: an ad-hoc signature has nothing to vouch for.
      : { identity: '-', hardenedRuntime: false, notarize: false, timestamp: 'none' };
    if (buildNumber !== undefined) {
      if (!/^[1-9][0-9]*$/.test(String(buildNumber))) throw new Error(`--build-number must be a whole number (got ${buildNumber})`);
      config.mac.bundleVersion = String(buildNumber);
    }
    // A certificate that is given but cannot be used must stop the release, not quietly ship an unsigned app.
    if (plan.developerId) config.forceCodeSigning = true;
  }
  return config;
}

/** The top-level `version` and `path`, and the files with their checksums, of a feed electron-builder wrote. */
export function readFeed(text) {
  const top = (key) => new RegExp(`^${key}: (?:'([^'\\n]*)'|"([^"\\n]*)"|([^\\n#]*?))\\s*$`, 'm').exec(text);
  const value = (key) => { const m = top(key); return m ? (m[1] ?? m[2] ?? m[3]).trim() : undefined; };
  const files = [];
  const entry = /^  - url: (.+)\n((?:    .+\n?)*)/gm;
  for (let m; (m = entry.exec(text));) {
    const field = (name) => new RegExp(`^    ${name}: (.+)$`, 'm').exec(m[2])?.[1].trim();
    files.push({ url: m[1].trim(), sha512: field('sha512'), size: field('size') === undefined ? undefined : Number(field('size')) });
  }
  return { version: value('version'), path: value('path'), sha512: value('sha512'), files };
}

const sha512 = (file) => createHash('sha512').update(readFileSync(file)).digest('base64');

/** Checks one system's files in `folder`: all there, the feed carries `version`, names the updater's installer,
    and every file it lists is there with that size and checksum. Returns the problems found ([] when fine). */
export function checkFiles(platform, folder, version) {
  const problems = [];
  const names = RELEASE_FILES[platform];
  for (const name of names) if (!existsSync(path.join(folder, name))) problems.push(`${name} is missing`);
  const feedName = names[names.length - 1];
  if (!existsSync(path.join(folder, feedName))) return problems;
  const feed = readFeed(readFileSync(path.join(folder, feedName), 'utf8'));
  if (feed.version !== version) problems.push(`${feedName} says version ${feed.version}, expected ${version}`);
  if (feed.path !== UPDATER_FILE[platform]) problems.push(`${feedName} points the updater at ${feed.path}, expected ${UPDATER_FILE[platform]}`);
  if (feed.files.length === 0) problems.push(`${feedName} lists no files`);
  for (const f of feed.files) {
    const file = path.join(folder, f.url);
    if (!names.includes(f.url)) { problems.push(`${feedName} lists ${f.url}, which is not a release file`); continue; }
    if (!existsSync(file)) continue; // reported above
    if (f.size !== undefined && statSync(file).size !== f.size) problems.push(`${f.url} is ${statSync(file).size} bytes, ${feedName} says ${f.size}`);
    if (sha512(file) !== f.sha512) problems.push(`${f.url} does not match its checksum in ${feedName}`);
  }
  return problems;
}

/** electron-builder's own variables for signing and publishing, which must not leak in from the caller. */
const BUILDER_ENV = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME', 'CSC_IDENTITY_AUTO_DISCOVERY', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD',
  'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE',
  'GH_TOKEN', 'GITHUB_TOKEN', 'BUILD_NUMBER'];

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const platform = value('--platform') ?? { darwin: 'mac', win32: 'win', linux: 'linux' }[process.platform];
  if (!RELEASE_FILES[platform]) throw new Error('usage: node scripts/release-build.mjs --platform mac|win|linux [--build-number <commit count>]');
  const buildNumber = value('--build-number');
  const version = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8')).version;

  const plan = signingPlan(platform, process.env);
  const config = buildConfig(platform, plan, buildNumber);
  console.log(`OpenPixel ${version} for ${platform}${buildNumber ? ` (build ${buildNumber})` : ''}; installs its own updates: ${config.extraMetadata.openpixel.selfUpdate ? 'yes' : 'no'}`);
  for (const note of plan.notes) console.log(process.env.GITHUB_ACTIONS ? `::notice::${note}` : `note: ${note}`);

  // electron-builder reads its settings from the environment: it gets this plan's, and nothing left over.
  for (const name of BUILDER_ENV) delete process.env[name];
  Object.assign(process.env, plan.env);
  let keyFolder;
  if (plan.notaryKeyP8 !== undefined) {
    keyFolder = mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'openpixel-notary-'));
    const keyFile = path.join(keyFolder, 'AuthKey.p8');
    writeFileSync(keyFile, Buffer.from(plan.notaryKeyP8, 'base64'), { mode: 0o600 });
    process.env.APPLE_API_KEY = keyFile;
  }

  const out = path.join(desktop, 'release');
  const upload = path.join(out, 'upload');
  // Installers of an earlier build must not pass for this one's.
  for (const name of RELEASE_FILES[platform]) rmSync(path.join(out, name), { force: true });
  rmSync(upload, { recursive: true, force: true });
  try {
    const { build, Platform } = await import('electron-builder');
    const target = { mac: Platform.MAC, win: Platform.WINDOWS, linux: Platform.LINUX }[platform];
    // No targets and no processors named: exactly the ones electron-builder.yml lists for this system.
    await build({ targets: new Map([[target, new Map()]]), projectDir: desktop, publish: 'never', config });
  } finally {
    if (keyFolder) rmSync(keyFolder, { recursive: true, force: true });
  }

  mkdirSync(upload, { recursive: true });
  for (const name of RELEASE_FILES[platform]) if (existsSync(path.join(out, name))) copyFileSync(path.join(out, name), path.join(upload, name));
  const problems = checkFiles(platform, upload, version);
  if (problems.length) throw new Error(`the build is not what a release needs:\n  ${problems.join('\n  ')}`);
  for (const name of RELEASE_FILES[platform]) console.log(`  ${name}  ${statSync(path.join(upload, name)).size} bytes`);
  console.log(`Ready in ${upload}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    process.exit(1);
  });
}
