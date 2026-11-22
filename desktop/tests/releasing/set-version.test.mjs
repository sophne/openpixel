// scripts/set-version.mjs: the release tag's version goes into the app's and the core's files, and only there.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FILES, currentVersion, releaseVersion, setVersion, stampCargoLock, stampCargoToml, stampPackageJson, stampPackageLock } from '../../scripts/set-version.mjs';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const script = path.join(repo, 'desktop', 'scripts', 'set-version.mjs');

/** A copy of the four real files, to stamp without touching the repository. */
function copyOfRepo(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openpixel-set-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [file] of FILES) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    cpSync(path.join(repo, file), path.join(root, file));
  }
  return root;
}

test('a release is called 1.2.3 or 1.2.3-beta.1, with or without the tag\'s v', () => {
  assert.equal(releaseVersion('1.2.3'), '1.2.3');
  assert.equal(releaseVersion('v1.2.3'), '1.2.3');
  assert.equal(releaseVersion(' v10.20.30-beta.1 \n'), '10.20.30-beta.1');
  assert.equal(releaseVersion('0.0.0-dry-run.7'), '0.0.0-dry-run.7');
  for (const bad of ['', 'v', '1.2', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-beta..1', '1.2.3-01', '1.2.3+build', 'latest', '1.2.x', '1.2.3 ; rm -rf /', '1.2.3"', undefined, null]) {
    assert.throws(() => releaseVersion(bad), /version must look like/, String(bad));
  }
});

test('every file gets the version, and nothing else in it changes', (t) => {
  const root = copyOfRepo(t);
  const before = Object.fromEntries(FILES.map(([file]) => [file, readFileSync(path.join(root, file), 'utf8')]));
  const was = currentVersion(root);
  const done = setVersion('v7.8.9-beta.2', { root });
  assert.deepEqual(done.map((d) => [d.file, d.was, d.changed]), FILES.map(([file]) => [file, was, true]));
  assert.equal(currentVersion(root), '7.8.9-beta.2');

  const after = Object.fromEntries(FILES.map(([file]) => [file, readFileSync(path.join(root, file), 'utf8')]));
  assert.equal(JSON.parse(after['desktop/package.json']).version, '7.8.9-beta.2');
  const lock = JSON.parse(after['desktop/package-lock.json']);
  assert.deepEqual([lock.version, lock.packages[''].version], ['7.8.9-beta.2', '7.8.9-beta.2']);
  assert.match(after['core/Cargo.toml'], /\[workspace\.package\]\nversion = "7\.8\.9-beta\.2"\n/);
  for (const crate of ['openpixel', 'openpixel-core', 'openpixel-wasm']) {
    assert.ok(after['core/Cargo.lock'].includes(`[[package]]\nname = "${crate}"\nversion = "7.8.9-beta.2"\n`), crate);
  }
  // Putting the old version back gives the old files, byte for byte: only the version moved.
  setVersion(was, { root });
  for (const [file] of FILES) assert.equal(readFileSync(path.join(root, file), 'utf8'), before[file], file);
  // The dependencies' versions were never touched (some share the number).
  const depsBefore = JSON.stringify({ ...JSON.parse(before['desktop/package-lock.json']).packages, '': null });
  const depsAfter = JSON.stringify({ ...lock.packages, '': null });
  assert.equal(depsAfter, depsBefore);
  assert.equal(after['core/Cargo.lock'].split('7.8.9-beta.2').length - 1, 3);
});

test('stamping the same version again changes nothing; --check only looks', (t) => {
  const root = copyOfRepo(t);
  setVersion('2.0.0', { root });
  assert.deepEqual(setVersion('2.0.0', { root }).map((d) => d.changed), [false, false, false, false]);
  const looked = setVersion('3.0.0', { root, check: true });
  assert.deepEqual(looked.map((d) => d.changed), [true, true, true, true]);
  assert.equal(currentVersion(root), '2.0.0', '--check writes nothing');
});

test('a file that cannot be stamped leaves the others as they were', (t) => {
  const root = copyOfRepo(t);
  const was = currentVersion(root);
  writeFileSync(path.join(root, 'core/Cargo.lock'), '# no packages here\n');
  assert.throws(() => setVersion('4.0.0', { root }), /Cargo\.lock \(openpixel\): no version found/);
  assert.equal(JSON.parse(readFileSync(path.join(root, 'desktop/package.json'), 'utf8')).version, was);
  assert.throws(() => setVersion('not a version', { root }), /version must look like/);
});

test('the pieces: only the right "version" is replaced', () => {
  assert.equal(stampPackageJson('{\n  "name": "x",\n  "version": "1.0.0",\n  "dependencies": {\n    "version": "1.0.0"\n  }\n}\n', '2.0.0').text,
    '{\n  "name": "x",\n  "version": "2.0.0",\n  "dependencies": {\n    "version": "1.0.0"\n  }\n}\n');
  assert.throws(() => stampPackageJson('{"name":"x"}', '2.0.0'), /no version found/);
  const lock = '{\n  "name": "x",\n  "version": "1.0.0",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {\n      "name": "x",\n      "version": "1.0.0",\n      "dependencies": {}\n    },\n    "node_modules/y": {\n      "version": "1.0.0"\n    }\n  }\n}\n';
  assert.equal(stampPackageLock(lock, '2.0.0').text, lock.replace('"version": "1.0.0",\n  "lockfileVersion"', '"version": "2.0.0",\n  "lockfileVersion"').replace('"name": "x",\n      "version": "1.0.0"', '"name": "x",\n      "version": "2.0.0"'));
  assert.equal(stampCargoToml('[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "1.0.0"\nedition = "2021"\n\n[profile.release]\nversion = "1.0.0"\n', '2.0.0').text,
    '[workspace]\nmembers = ["a"]\n\n[workspace.package]\nversion = "2.0.0"\nedition = "2021"\n\n[profile.release]\nversion = "1.0.0"\n');
  assert.throws(() => stampCargoToml('[package]\nversion = "1.0.0"\n', '2.0.0'), /no version found/);
  assert.equal(stampCargoLock('[[package]]\nname = "openpixel-core"\nversion = "1.0.0"\n\n[[package]]\nname = "other"\nversion = "1.0.0"\n', '2.0.0', ['openpixel-core']).text,
    '[[package]]\nname = "openpixel-core"\nversion = "2.0.0"\n\n[[package]]\nname = "other"\nversion = "1.0.0"\n');
});

test('from the command line: --print, --check, and errors exit with 1', () => {
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const now = run('--print');
  assert.equal(now.status, 0);
  assert.equal(now.stdout.trim(), currentVersion());
  assert.equal(run('--check', currentVersion()).status, 0);
  const other = run('--check', '999.0.0');
  assert.equal(other.status, 1);
  assert.match(other.stderr, /not every file carries 999\.0\.0/);
  assert.equal(run('--check', 'v1').status, 1);
  assert.equal(run().status, 1);
  assert.equal(currentVersion(), now.stdout.trim(), 'the repository was not touched');
});
