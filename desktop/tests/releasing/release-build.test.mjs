// scripts/release-build.mjs, scripts/check-release.mjs and scripts/stage-core.cjs: what a build is told, and
// whether what came out is what a release needs.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ALL_RELEASE_FILES, RELEASE_FILES, UPDATER_FILE, buildConfig, checkFiles, readFeed, selfUpdates, signingPlan } from '../../scripts/release-build.mjs';
import { checkRelease } from '../../scripts/check-release.mjs';
import { appcastXml, signUpdate, sparkleKey } from '../../scripts/appcast.mjs';

const { programKind, wrongProgram } = createRequire(import.meta.url)('../../scripts/stage-core.cjs');

test('the files of a release are the contract\'s', () => {
  assert.deepEqual(RELEASE_FILES, {
    mac: ['OpenPixel.dmg', 'OpenPixel-mac.zip', 'latest-mac.yml'],
    win: ['OpenPixel-Setup.exe', 'latest.yml'],
    linux: ['OpenPixel.AppImage', 'openpixel.deb', 'latest-linux.yml'],
  });
  assert.equal(ALL_RELEASE_FILES.length, 8);
  assert.deepEqual(UPDATER_FILE, { mac: 'OpenPixel-mac.zip', win: 'OpenPixel-Setup.exe', linux: 'OpenPixel.AppImage' });
});

test('macOS without a certificate: ad-hoc, no hardened runtime, no notarization, no self-update', () => {
  const plan = signingPlan('mac', {});
  assert.deepEqual([plan.developerId, plan.notarize, plan.env, plan.notaryKeyP8], [false, false, {}, undefined]);
  assert.match(plan.notes.join(' '), /ad-hoc signed and not notarized/);
  assert.deepEqual(buildConfig('mac', plan, '412'), {
    extraMetadata: { openpixel: { selfUpdate: false } },
    mac: { identity: '-', hardenedRuntime: false, notarize: false, timestamp: 'none', bundleVersion: '412' },
  });
  // Empty secrets (a workflow passes "" for a secret that does not exist) count as absent.
  assert.equal(signingPlan('mac', { MACOS_CERT_P12: '', MACOS_CERT_PASSWORD: '', NOTARY_KEY_P8: '  ', NOTARY_KEY_ID: '', NOTARY_ISSUER_ID: '' }).developerId, false);
  // A notarization key alone does nothing, and says so.
  const alone = signingPlan('mac', { NOTARY_KEY_P8: 'a2V5', NOTARY_KEY_ID: 'ABC', NOTARY_ISSUER_ID: 'uuid' });
  assert.deepEqual([alone.developerId, alone.notarize, alone.env], [false, false, {}]);
  assert.match(alone.notes.join(' '), /ignored without a Developer ID/);
});

test('macOS with the release environment\'s secrets: their old names become electron-builder\'s', () => {
  const env = { MACOS_CERT_P12: ' cDEy\n', MACOS_CERT_PASSWORD: 'pass word', KEYCHAIN_PASSWORD: 'unused', NOTARY_KEY_P8: 'cDg=\n', NOTARY_KEY_ID: ' ABC123 ', NOTARY_ISSUER_ID: 'issuer-uuid' };
  const plan = signingPlan('mac', env);
  assert.deepEqual(plan.env, { CSC_LINK: 'cDEy', CSC_KEY_PASSWORD: 'pass word', APPLE_API_KEY_ID: 'ABC123', APPLE_API_ISSUER: 'issuer-uuid' });
  assert.deepEqual([plan.developerId, plan.notarize, plan.notaryKeyP8], [true, true, 'cDg=']);
  assert.deepEqual(buildConfig('mac', plan, 412), {
    extraMetadata: { openpixel: { selfUpdate: true } },
    mac: { hardenedRuntime: true, notarize: true, bundleVersion: '412' },
    forceCodeSigning: true,
  });
  // Signed but no notarization key: signed, hardened, not notarized.
  const signedOnly = signingPlan('mac', { MACOS_CERT_P12: 'cDEy', MACOS_CERT_PASSWORD: 'x' });
  assert.deepEqual([signedOnly.developerId, signedOnly.notarize], [true, false]);
  assert.deepEqual(buildConfig('mac', signedOnly).mac, { hardenedRuntime: true, notarize: false });
  // A Mac with the certificate in its keychain, or electron-builder's own names.
  assert.deepEqual(signingPlan('mac', { CSC_NAME: 'Developer ID Application: Example (TEAM123456)' }).env, { CSC_NAME: 'Developer ID Application: Example (TEAM123456)' });
  assert.deepEqual(signingPlan('mac', { CSC_LINK: '/keys/id.p12', CSC_KEY_PASSWORD: 'x', APPLE_API_KEY: '/keys/k.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' }).env,
    { CSC_LINK: '/keys/id.p12', CSC_KEY_PASSWORD: 'x', APPLE_API_KEY: '/keys/k.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' });
});

test('half an environment stops the build', () => {
  assert.throws(() => signingPlan('mac', { MACOS_CERT_P12: 'cDEy' }), /MACOS_CERT_PASSWORD/);
  assert.throws(() => signingPlan('mac', { MACOS_CERT_P12: 'cDEy', MACOS_CERT_PASSWORD: 'x', NOTARY_KEY_P8: 'cDg=' }), /go together/);
  assert.throws(() => signingPlan('mac', { NOTARY_KEY_ID: 'K', NOTARY_ISSUER_ID: 'I' }), /go together/);
  assert.throws(() => buildConfig('mac', signingPlan('mac', {}), '1.2.3'), /whole number/);
  assert.throws(() => buildConfig('mac', signingPlan('mac', {}), '0'), /whole number/);
});

test('Windows and Linux: nothing is signed, both install their own updates', () => {
  for (const platform of ['win', 'linux']) {
    // Whatever signing variables the environment holds, they are not this build's.
    const plan = signingPlan(platform, { MACOS_CERT_P12: 'cDEy', MACOS_CERT_PASSWORD: 'x', CSC_LINK: 'x', WIN_CSC_LINK: 'x' });
    assert.deepEqual([plan.developerId, plan.notarize, plan.env], [false, false, {}]);
    assert.equal(selfUpdates(platform, plan), true);
    assert.deepEqual(buildConfig(platform, plan, '412'), { extraMetadata: { openpixel: { selfUpdate: true } } });
  }
  assert.match(signingPlan('win', {}).notes.join(' '), /not code-signed/);
});

const sha512 = (data) => createHash('sha512').update(data).digest('base64');

/** A folder with one system's files as electron-builder leaves them. */
function fakeBuild(t, platform, version = '1.2.0') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-release-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  addFiles(dir, platform, version);
  return dir;
}
function addFiles(dir, platform, version) {
  const names = RELEASE_FILES[platform];
  const files = names.slice(0, -1).map((name) => { const data = randomBytes(2000 + name.length); writeFileSync(path.join(dir, name), data); return { name, data }; });
  const main = files.find((f) => f.name === UPDATER_FILE[platform]);
  const list = [main, ...files.filter((f) => f !== main)].map((f) => `  - url: ${f.name}\n    sha512: ${sha512(f.data)}\n    size: ${f.data.length}\n`).join('');
  writeFileSync(path.join(dir, names.at(-1)), `version: ${version}\nfiles:\n${list}path: ${main.name}\nsha512: ${sha512(main.data)}\nreleaseDate: '2026-11-22T11:24:00.000Z'\n`);
}

test('a feed as electron-builder writes it is read back', () => {
  const feed = readFeed("version: 1.3.0-beta.1\nfiles:\n  - url: OpenPixel.AppImage\n    sha512: YWJj\n    size: 129513157\n    blockMapSize: 136921\n  - url: openpixel.deb\n    sha512: ZGVm\n    size: 103826448\npath: OpenPixel.AppImage\nsha512: YWJj\nreleaseDate: '2026-11-22T11:46:42.190Z'\n");
  assert.deepEqual(feed, { version: '1.3.0-beta.1', path: 'OpenPixel.AppImage', sha512: 'YWJj',
    files: [{ url: 'OpenPixel.AppImage', sha512: 'YWJj', size: 129513157 }, { url: 'openpixel.deb', sha512: 'ZGVm', size: 103826448 }] });
  assert.deepEqual(readFeed('nothing'), { version: undefined, path: undefined, sha512: undefined, files: [] });
});

test('a build is checked: every file, the feed\'s version, its installer and its checksums', (t) => {
  for (const platform of ['mac', 'win', 'linux']) {
    const dir = fakeBuild(t, platform);
    assert.deepEqual(checkFiles(platform, dir, '1.2.0'), [], platform);
    assert.deepEqual(checkFiles(platform, dir, '1.2.1'), [`${RELEASE_FILES[platform].at(-1)} says version 1.2.0, expected 1.2.1`]);
  }
  const dir = fakeBuild(t, 'linux');
  writeFileSync(path.join(dir, 'openpixel.deb'), randomBytes(2013));
  assert.deepEqual(checkFiles('linux', dir, '1.2.0'), ['openpixel.deb does not match its checksum in latest-linux.yml']);
  writeFileSync(path.join(dir, 'OpenPixel.AppImage'), 'short');
  assert.deepEqual(checkFiles('linux', dir, '1.2.0').slice(0, 2), ['OpenPixel.AppImage is 5 bytes, latest-linux.yml says 2018', 'OpenPixel.AppImage does not match its checksum in latest-linux.yml']);
  unlinkSync(path.join(dir, 'OpenPixel.AppImage'));
  assert.ok(checkFiles('linux', dir, '1.2.0').includes('OpenPixel.AppImage is missing'));
  unlinkSync(path.join(dir, 'latest-linux.yml'));
  assert.deepEqual(checkFiles('linux', dir, '1.2.0'), ['OpenPixel.AppImage is missing', 'latest-linux.yml is missing']);
  // A feed that sends the updater to the wrong installer, or lists a stranger.
  const mac = fakeBuild(t, 'mac');
  const feed = path.join(mac, 'latest-mac.yml');
  writeFileSync(feed, `version: 1.2.0\nfiles:\n  - url: Other.zip\n    sha512: x\n    size: 1\npath: OpenPixel.dmg\nsha512: x\n`);
  assert.deepEqual(checkFiles('mac', mac, '1.2.0'), ['latest-mac.yml points the updater at OpenPixel.dmg, expected OpenPixel-mac.zip', 'latest-mac.yml lists Other.zip, which is not a release file']);
});

test('a release is complete or it is not published', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  addFiles(dir, 'mac', '1.2.0');
  addFiles(dir, 'linux', '1.2.0');
  assert.deepEqual(checkRelease(dir, '1.2.0'), ['OpenPixel-Setup.exe is missing', 'latest.yml is missing']);
  addFiles(dir, 'win', '1.2.0');
  assert.deepEqual(checkRelease(dir, 'v1.2.0'), []);
  // Anything else in the folder would be attached to the release too.
  writeFileSync(path.join(dir, 'builder-debug.yml'), 'x');
  assert.deepEqual(checkRelease(dir, '1.2.0'), ['builder-debug.yml is not a release file']);
  unlinkSync(path.join(dir, 'builder-debug.yml'));
  // One system built from another version.
  addFiles(dir, 'win', '1.1.9');
  assert.deepEqual(checkRelease(dir, '1.2.0'), ['latest.yml says version 1.1.9, expected 1.2.0']);
  addFiles(dir, 'win', '1.2.0');
  assert.throws(() => checkRelease(dir, 'nonsense'), /version must look like/);

  // The bridge appcast may be there; it must be OpenPixel's key's signature of this very dmg. A test cannot
  // hold that key, so here only refusals are seen (tests/releasing/appcast.test.mjs covers the signature).
  const key = sparkleKey(randomBytes(32).toString('base64'));
  const dmg = randomBytes(999);
  writeFileSync(path.join(dir, 'OpenPixel.dmg'), dmg);
  addFeedFor(dir, dmg);
  const signed = signUpdate(dmg, key);
  writeFileSync(path.join(dir, 'appcast.xml'), appcastXml({ version: '1.2.0', build: 5, signature: signed.edSignature, length: signed.length }));
  assert.deepEqual(checkRelease(dir, '1.2.0'), ["appcast.xml: the signature is not the Sparkle key's signature of OpenPixel.dmg"]);
  writeFileSync(path.join(dir, 'appcast.xml'), appcastXml({ version: '1.1.0', build: 5, signature: 'bm9wZQ==', length: 5 }));
  assert.deepEqual(checkRelease(dir, '1.2.0'), ['appcast.xml offers version 1.1.0, expected 1.2.0',
    'appcast.xml links to https://github.com/sophne/openpixel/releases/download/v1.1.0/OpenPixel.dmg',
    'appcast.xml says OpenPixel.dmg is 5 bytes, it is 999', "appcast.xml: the signature is not the Sparkle key's signature of OpenPixel.dmg"]);
  writeFileSync(path.join(dir, 'appcast.xml'), '<rss/>');
  assert.deepEqual(checkRelease(dir, '1.2.0'), ['appcast.xml offers version undefined, expected 1.2.0', 'appcast.xml has no build number', 'appcast.xml has no signed download']);
});

/** Rewrites latest-mac.yml in `dir` for a replaced OpenPixel.dmg. */
function addFeedFor(dir, dmg) {
  const zip = randomBytes(500);
  writeFileSync(path.join(dir, 'OpenPixel-mac.zip'), zip);
  writeFileSync(path.join(dir, 'latest-mac.yml'), `version: 1.2.0\nfiles:\n  - url: OpenPixel-mac.zip\n    sha512: ${sha512(zip)}\n    size: 500\n  - url: OpenPixel.dmg\n    sha512: ${sha512(dmg)}\n    size: ${dmg.length}\npath: OpenPixel-mac.zip\nsha512: ${sha512(zip)}\n`);
}

test('the program packed for agents must be for that system and processor', (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'openpixel-stage-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name, bytes) => { const p = path.join(dir, name); writeFileSync(p, Buffer.concat([bytes, Buffer.alloc(64)])); return p; };
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const macho = (cpu) => file(`macho-${cpu}`, Buffer.concat([Buffer.from('cffaedfe', 'hex'), le32(cpu), Buffer.alloc(24)]));
  const elf = (machine) => { const b = Buffer.alloc(64); Buffer.from('7f454c46020101', 'hex').copy(b); b.writeUInt16LE(machine, 18); return file(`elf-${machine}`, b); };
  const pe = (machine) => { const b = Buffer.alloc(0x100); b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80, 'latin1'); b.writeUInt16LE(machine, 0x84); return file(`pe-${machine}`, b); };

  assert.deepEqual(programKind(macho(0x01000007)), { system: 'darwin', arch: 'x64' });
  assert.deepEqual(programKind(macho(0x0100000c)), { system: 'darwin', arch: 'arm64' });
  assert.deepEqual(programKind(file('fat', Buffer.concat([Buffer.from('cafebabe', 'hex'), Buffer.alloc(28)]))), { system: 'darwin', arch: 'universal' });
  assert.deepEqual(programKind(elf(0x3e)), { system: 'linux', arch: 'x64' });
  assert.deepEqual(programKind(elf(0xb7)), { system: 'linux', arch: 'arm64' });
  assert.deepEqual(programKind(pe(0x8664)), { system: 'win32', arch: 'x64' });
  assert.deepEqual(programKind(pe(0xaa64)), { system: 'win32', arch: 'arm64' });
  assert.equal(programKind(file('text', Buffer.from('#!/bin/sh\necho hi\n'))), null);
  assert.equal(programKind(file('tiny', Buffer.from('MZ'))), null);

  assert.equal(wrongProgram(macho(0x0100000c), 'darwin', 'arm64'), undefined);
  // The mix-up a universal build invites: the same program staged for both halves.
  assert.equal(wrongProgram(macho(0x0100000c), 'darwin', 'x64'), 'it is built for arm64');
  assert.equal(wrongProgram(path.join(dir, 'fat'), 'darwin', 'x64'), undefined, 'a universal program serves both halves');
  assert.equal(wrongProgram(elf(0x3e), 'darwin', 'x64'), 'it is a linux program');
  assert.equal(wrongProgram(pe(0x8664), 'win32', 'x64'), undefined);
  assert.equal(wrongProgram(elf(0xb7), 'linux', 'x64'), 'it is built for arm64');
  assert.equal(wrongProgram(path.join(dir, 'text'), 'linux', 'x64'), 'it is not a program');
});
