#!/usr/bin/env node
// Stamps a release's version into the files that carry it. The release tag (v1.2.3) is the source of truth; the
// release workflow runs this before it builds anything, so the app, the core and the MCP program all say the same.
//
//   node scripts/set-version.mjs 1.2.3            (or v1.2.3, or 1.3.0-beta.1)
//   node scripts/set-version.mjs --check 1.2.3    exits 1 unless every file already carries it
//   node scripts/set-version.mjs --print          prints the version the files carry now
//
// Files: desktop/package.json and package-lock.json (the app: `app.getVersion()`, the installers, the update feed),
// core/Cargo.toml's [workspace.package] and the three workspace crates in core/Cargo.lock (the core's and the MCP
// program's VERSION). Only the version changes: every other byte of those files stays as it is.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What a release can be called: 1.2.3, or 1.2.3-beta.1 for a pre-release (semantic versioning without build
    metadata, which neither tags nor the updater use). Throws Error(text) for anything else. */
export function releaseVersion(text) {
  const v = String(text ?? '').trim().replace(/^v/, '');
  const part = '(?:0|[1-9][0-9]*)';
  const pre = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  if (!new RegExp(`^${part}\\.${part}\\.${part}(?:-${pre}(?:\\.${pre})*)?$`).test(v)) {
    throw new Error(`version must look like 1.2.3 or 1.2.3-beta.1 (got ${JSON.stringify(String(text ?? ''))})`);
  }
  return v;
}

/** Replaces the one place `find` matches (its first group is kept, the second is the old version). */
function replaceOnce(text, find, version, what) {
  const m = find.exec(text);
  if (!m) throw new Error(`${what}: no version found`);
  return { text: text.slice(0, m.index) + m[1] + version + text.slice(m.index + m[1].length + m[2].length), was: m[2] };
}

/** package.json: the top-level "version" (two spaces in, as npm writes it). */
export function stampPackageJson(text, version) {
  const out = replaceOnce(text, /^(  "version":\s*")([^"\n]*)/m, version, 'package.json');
  if (JSON.parse(out.text).version !== version) throw new Error('package.json: the version did not take');
  return out;
}

/** package-lock.json: the top-level "version" and the root package's (`packages[""]`). */
export function stampPackageLock(text, version) {
  const top = replaceOnce(text, /^(  "version":\s*")([^"\n]*)/m, version, 'package-lock.json');
  const root = replaceOnce(top.text, /(\n    "": \{\n(?:      [^\n]*\n)*?      "version":\s*")([^"\n]*)/, version, 'package-lock.json (root package)');
  const lock = JSON.parse(root.text);
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('package-lock.json: the version did not take');
  return { text: root.text, was: top.was };
}

/** Cargo.toml: `version` under [workspace.package]. */
export function stampCargoToml(text, version) {
  return replaceOnce(text, /(\[workspace\.package\]\n(?:(?!\[)[^\n]*\n)*?version\s*=\s*")([^"\n]*)/, version, 'Cargo.toml [workspace.package]');
}

/** Cargo.lock: the workspace's own crates (the lock file must agree with Cargo.toml for `--locked` builds). */
export function stampCargoLock(text, version, crates = ['openpixel', 'openpixel-core', 'openpixel-wasm']) {
  let out = text, was = '';
  for (const name of crates) {
    const r = replaceOnce(out, new RegExp(`(\\[\\[package\\]\\]\\nname = "${name}"\\nversion = ")([^"\\n]*)`), version, `Cargo.lock (${name})`);
    out = r.text;
    was = r.was;
  }
  return { text: out, was };
}

export const FILES = [
  ['desktop/package.json', stampPackageJson],
  ['desktop/package-lock.json', stampPackageLock],
  ['core/Cargo.toml', stampCargoToml],
  ['core/Cargo.lock', stampCargoLock],
];

/** Stamps every file under `root`; with `check` nothing is written. Returns [{ file, was, changed }]. */
export function setVersion(version, { root = repo, check = false } = {}) {
  const v = releaseVersion(version);
  // Everything is worked out first: a file that cannot be stamped leaves the others untouched.
  const work = FILES.map(([file, stamp]) => {
    const full = path.join(root, file);
    const before = readFileSync(full, 'utf8');
    const { text, was } = stamp(before, v);
    return { file, full, text, was, changed: text !== before };
  });
  if (!check) for (const w of work) if (w.changed) writeFileSync(w.full, w.text);
  return work.map(({ file, was, changed }) => ({ file, was, changed }));
}

/** The version the files carry now; throws when they disagree. */
export function currentVersion(root = repo) {
  const found = FILES.map(([file, stamp]) => [file, stamp(readFileSync(path.join(root, file), 'utf8'), '0.0.0').was]);
  const versions = new Set(found.map(([, v]) => v));
  if (versions.size !== 1) throw new Error(`the files disagree about the version: ${found.map(([f, v]) => `${f} ${v}`).join(', ')}`);
  return found[0][1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args.includes('--print')) {
      console.log(currentVersion());
    } else {
      const check = args.includes('--check');
      const wanted = args.find((a) => !a.startsWith('--'));
      if (!wanted) throw new Error('usage: node scripts/set-version.mjs [--check] <version, e.g. 1.2.0>   |   --print');
      const done = setVersion(wanted, { check });
      const v = releaseVersion(wanted);
      for (const d of done) console.log(`${d.file}: ${d.changed ? `${d.was} → ${v}` : `${v} (as it was)`}`);
      if (check && done.some((d) => d.changed)) {
        console.error(`error: not every file carries ${v}`);
        process.exit(1);
      }
    }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
