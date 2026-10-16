'use strict';

// scripts/release.mjs tags and releases a version the maintainer already
// published. Real git in a throwaway repo (with a bare "origin"); `npm` and
// `gh` are stand-ins on PATH, since the network is not the thing under test.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'release.mjs');
const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const skipOnWindows = process.platform !== 'win32' ? false : 'fake npm/gh are shell scripts';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture(t, { published = true, changelog = true, npmError = false, extraEnv = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-release-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const origin = path.join(base, 'origin.git');
  const repo = path.join(base, 'repo');
  const bin = path.join(base, 'bin');
  const gh = path.join(base, 'gh-state');
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.mkdirSync(bin);
  git(base, 'init', '--bare', origin);
  git(repo, 'init');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  git(repo, 'remote', 'add', 'origin', origin);
  fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'release.mjs'));
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: '@x/pkg', version: '1.2.3' }));
  fs.writeFileSync(
    path.join(repo, 'CHANGELOG.md'),
    changelog ? '## [Unreleased]\n\n## [1.2.3] - 2026-01-01\n\n- the notes\n\n## [1.2.2]\n\n- old\n' : '## [Unreleased]\n',
  );
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'init');
  git(repo, 'push', 'origin', 'HEAD');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\nif [ "$3" = gitHead ]; then echo "$FAKE_GITHEAD"; exit 0; fi\n${published ? 'echo 1.2.3' : npmError ? 'echo connect ETIMEDOUT >&2; exit 1' : 'echo npm error code E404 >&2; exit 1'}\n`, { mode: 0o755 });
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh\nif [ "$2" = view ]; then [ -f "${gh}" ]; exit $?; fi\necho "$@" > "${gh}"\n`,
    { mode: 0o755 },
  );
  const env = { ...process.env, ...extraEnv, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  const run = (...args) =>
    spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.mjs'), ...args], { cwd: repo, env, encoding: 'utf8' });
  return { repo, origin, gh, run };
}

test('dry run prints the plan and changes nothing', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  const r = f.run('--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /would/);
  assert.match(r.stdout, /v1\.2\.3/);
  assert.equal(git(f.repo, 'tag', '-l'), '');
  assert.equal(fs.existsSync(f.gh), false);
});

test('tags, pushes and releases with the CHANGELOG section; a second run does nothing', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(git(f.repo, 'tag', '-l'), 'v1.2.3');
  assert.equal(git(f.repo, 'cat-file', '-t', 'v1.2.3'), 'tag', 'annotated');
  assert.equal(git(f.origin, 'tag', '-l'), 'v1.2.3');
  const release = fs.readFileSync(f.gh, 'utf8');
  assert.match(release, /the notes/);
  assert.doesNotMatch(release, /old/);

  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /nothing to do/);
});

test('refuses a version that is not on npm yet', { skip: skipOnWindows }, (t) => {
  const f = fixture(t, { published: false });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not published on npm/);
  assert.equal(git(f.repo, 'tag', '-l'), '');
});

test('an npm failure that is not a 404 is not reported as unpublished', { skip: skipOnWindows }, (t) => {
  const f = fixture(t, { published: false, npmError: true });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /could not ask npm/);
  assert.doesNotMatch(r.stderr, /not published on npm/);
});

test('a rerun pushes a tag that exists locally but never reached origin', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  git(f.repo, 'tag', '-a', 'v1.2.3', '-m', 'local only');
  assert.equal(git(f.origin, 'tag', '-l'), '');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(f.origin, 'tag', '-l'), 'v1.2.3');
  assert.ok(fs.existsSync(f.gh));
});

test('refuses to tag a dirty tree or a HEAD that is not on origin', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.repo, 'CHANGELOG.md'), '\nedit\n');
  const dirty = f.run();
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /uncommitted/);
  git(f.repo, 'commit', '-am', 'local only');
  const unpushed = f.run();
  assert.notEqual(unpushed.status, 0);
  assert.match(unpushed.stderr, /not on any remote branch/);
  assert.equal(git(f.repo, 'tag', '-l'), '');
});

test('adopts the tag origin already has instead of tagging HEAD again', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  const first = git(f.repo, 'rev-parse', 'HEAD');
  git(f.repo, 'tag', '-a', 'v1.2.3', '-m', 'x');
  git(f.repo, 'push', 'origin', 'v1.2.3');
  fs.writeFileSync(path.join(f.repo, 'later.txt'), 'x');
  git(f.repo, 'add', '.');
  git(f.repo, 'commit', '-m', 'later');
  git(f.repo, 'push', 'origin', 'HEAD');
  git(f.repo, 'tag', '-d', 'v1.2.3');
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(f.repo, 'rev-parse', 'v1.2.3^{commit}'), first);
  assert.ok(fs.existsSync(f.gh));
});

test('refuses to tag a HEAD other than the commit npm published from', { skip: skipOnWindows }, (t) => {
  const f = fixture(t, { extraEnv: { FAKE_GITHEAD: 'a'.repeat(40) } });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /published 1\.2\.3 from aaaaaaa/);
  assert.equal(git(f.repo, 'tag', '-l'), '');
});

test('refuses an empty CHANGELOG section', { skip: skipOnWindows }, (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.repo, 'CHANGELOG.md'), '## [1.2.3]\n\n## [1.2.2]\n\n- old\n');
  git(f.repo, 'commit', '-am', 'empty');
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /is empty/);
});

test('refuses a version with no CHANGELOG section', { skip: skipOnWindows }, (t) => {
  const f = fixture(t, { changelog: false });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no "## \[1\.2\.3\]" section/);
});

test('doctor warns in this repository when the version has no tag', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-release-doctor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify({ install: 'minimal' }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@landry_pouth/coding-flow', version: '9.9.9' }));
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
  const doctor = () => spawnSync(process.execPath, [CLI, 'doctor'], { cwd: dir, encoding: 'utf8' });
  assert.match(doctor().stdout + doctor().stderr, /v9\.9\.9 tag/);
  git(dir, 'tag', 'v9.9.9');
  assert.doesNotMatch(doctor().stdout + doctor().stderr, /v9\.9\.9 tag/);
});
