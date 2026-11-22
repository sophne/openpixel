// scripts/tag-release.sh: the checks before a release tag is pushed, against throwaway repositories.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'tag-release.sh');
// A POSIX shell and git: everywhere but a bare Windows.
const skip = process.platform === 'win32' ? 'needs sh' : false;

/** "origin" (bare) and a clone of it on main with one commit pushed. */
function repos(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'openpixel-tag-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test',
    GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' };
  writeFileSync(env.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n');
  const work = path.join(root, 'work');
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: args[0] === 'init' || args[0] === 'clone' ? root : work, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git('init', '--quiet', '--bare', 'origin.git');
  git('clone', '--quiet', 'origin.git', 'work');
  const commit = (name) => { writeFileSync(path.join(work, name), name); git('add', '-A'); git('commit', '--quiet', '-m', `Add ${name}`); };
  commit('one');
  git('push', '--quiet', 'origin', 'HEAD:main');
  const release = (args, answer = 'n\n') => spawnSync('sh', [script, ...args], { cwd: work, env, input: answer, encoding: 'utf8' });
  const remoteTags = () => spawnSync('git', ['--git-dir', path.join(root, 'origin.git'), 'tag', '-l', '--format=%(refname:short) %(contents:subject)'], { env, encoding: 'utf8' }).stdout.trim();
  return { work, git, commit, release, remoteTags };
}

test('a version that is not one is refused before anything else', { skip }, (t) => {
  const { release } = repos(t);
  for (const bad of ['1.2', 'one', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3 4', '1.2.3;echo']) {
    const r = release([bad]);
    assert.equal(r.status, 1, bad);
    assert.match(r.stderr, /version must look like 1\.2\.3 or 1\.2\.3-beta\.1/, bad);
  }
  assert.equal(release([]).status !== 0, true);
});

test('only a clean main that equals origin/main can be tagged', { skip }, (t) => {
  const { git, commit, release, work } = repos(t);
  git('checkout', '--quiet', '-b', 'feature');
  assert.match(release(['1.0.0']).stderr, /switch to main first/);
  git('checkout', '--quiet', 'main');
  writeFileSync(path.join(work, 'dirty'), 'x');
  assert.match(release(['1.0.0']).stderr, /commit or stash your changes first/);
  commit('dirty');
  assert.match(release(['1.0.0']).stderr, /main differs from origin\/main/);
});

test('asked before pushing; yes makes an annotated tag whose message is the title', { skip }, (t) => {
  const { release, remoteTags } = repos(t);
  const no = release(['1.0.0']);
  assert.equal(no.status, 1);
  assert.match(no.stdout, /Releasing v1\.0\.0\. Changes since the beginning:[\s\S]*Add one[\s\S]*Push v1\.0\.0\? \[y\/N\] Cancelled\./);
  assert.equal(remoteTags(), '');
  const yes = release(['v1.0.0'], 'y\n');
  assert.equal(yes.status, 0, yes.stderr);
  assert.equal(remoteTags(), 'v1.0.0 OpenPixel 1.0.0');
  assert.match(release(['1.0.0']).stderr, /v1\.0\.0 already exists/);
});

test('releases only move forward: a newer version, and new commits', { skip }, (t) => {
  const { git, commit, release, remoteTags } = repos(t);
  assert.equal(release(['1.5.1'], 'y\n').status, 0);
  // The same commit again: nothing new to release (and the old Mac app would get the same build number).
  assert.match(release(['1.6.0']).stderr, /no new commits since v1\.5\.1/);
  commit('two');
  git('push', '--quiet', 'origin', 'main');
  // Not newer than the newest release: the updater would never offer it.
  for (const old of ['1.5.0', '1.4.9', '0.9.0', '1.5.1-beta.1', '1.0.0-rc.1']) {
    const r = release([old]);
    assert.equal(r.status, 1, old);
    assert.match(r.stderr, /is not newer than v1\.5\.1, the newest release/, old);
  }
  // Numbers, not text: 1.10.0 is newer than 1.5.1. A beta of the next version may come first, with a title.
  assert.match(release(['1.10.0']).stdout, /Releasing v1\.10\.0\. Changes since v1\.5\.1:[\s\S]*Add two/);
  assert.equal(release(['2.0.0-beta.1', 'Three systems'], 'y\n').status, 0);
  // A beta and its final release may share a commit: betas reach nobody.
  assert.equal(release(['2.0.0'], 'Y\n').status, 0);
  assert.equal(remoteTags(), 'v1.5.1 OpenPixel 1.5.1\nv2.0.0 OpenPixel 2.0.0\nv2.0.0-beta.1 Three systems');
});
