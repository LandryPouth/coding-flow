'use strict';

// `ai-flow archive` (story 17-01): a finished, merged epic leaves the checkout
// as a staged `git rm`, and `epics/INDEX.md` keeps one append-only entry naming
// its stories, the proof state they had, and the line that brings it back.
// Every test runs the CLI on a throwaway repository and asserts what is
// observable: exit codes, the git index, the files on disk.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const EPIC = 'epics/epic-08-evidence-levels';

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(dir, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { code: res.status, output: `${res.stdout}${res.stderr}` };
}

function write(dir, rel, content) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function story(dir, name, title, status) {
  write(dir, `${EPIC}/${name}/spec.md`, `# Story ${name.slice(6, 11)} — ${title}\n\nBody.\n`);
  write(dir, `${EPIC}/${name}/tasks.md`, status ? `# Tasks\n\n## Status: ${status}\n` : '# Tasks\n\n- [ ] do it\n');
}

// A repository on `main` holding one finished epic, committed and clean.
function repo(t, { secondStatus = 'done' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-archive-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  write(dir, '.gitignore', '.coding-flow/runs/\n');
  write(dir, `${EPIC}/index.md`, '# Epic 08 — Evidence levels\n\n## Goal\n\nLevels.\n');
  story(dir, 'story-08-01-coverage-floor', 'Coverage floor', 'done');
  story(dir, 'story-08-02-policy-fingerprint', 'Policy fingerprint', secondStatus);
  write(dir, 'README.md', '# Project\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

// Everything a refusal must leave as it was: the files, the index, the status.
function snapshot(dir, { skip = null } = {}) {
  const files = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === '.git' || path.join(d, name) === skip) continue;
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(`${path.relative(dir, full)}:${fs.readFileSync(full, 'utf8')}`);
    }
  };
  walk(dir);
  return { files: files.join('\n'), status: git(dir, ['status', '--porcelain']), cached: git(dir, ['diff', '--cached', '--name-status']) };
}

function head(dir) {
  return git(dir, ['rev-parse', 'HEAD']).trim();
}

function verifyRun(dir, storyPath, { ok, name, treeToken = null }) {
  const data = { ok, story: storyPath, generatedAt: '2026-11-01T00:00:00.000Z', commandSource: 'config', results: [] };
  if (treeToken) data.provenance = { git: { treeToken, shortCommit: 'abc1234' } };
  write(dir, `.coding-flow/runs/${name}-verify.json`, `${JSON.stringify(data, null, 2)}\n`);
}

test('a finished, merged epic is staged for deletion and gets one index entry', (t) => {
  const dir = repo(t);
  const sha = head(dir);

  const res = run(dir, ['archive', EPIC]);

  assert.equal(res.code, 0, res.output);
  assert.equal(fs.existsSync(path.join(dir, EPIC)), false, 'the directory left the checkout');
  const cached = git(dir, ['diff', '--cached', '--name-status']);
  for (const file of ['index.md', 'story-08-01-coverage-floor/spec.md', 'story-08-02-policy-fingerprint/tasks.md']) {
    assert.match(cached, new RegExp(`^D\\t${EPIC}/${file}$`, 'm'), `${file} is staged for deletion`);
  }
  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
  assert.match(index, /<!-- coding-flow:archived 08 evidence-levels -->/);
  assert.match(index, /Evidence levels/);
  assert.match(index, /08-01/);
  assert.match(index, /Coverage floor/);
  assert.match(index, /08-02/);
  assert.match(index, /Policy fingerprint/);
  assert.match(index, new RegExp(sha.slice(0, 7)));
  assert.ok(index.includes(`git checkout ${sha} -- ${EPIC}`), 'the recovery line names the HEAD commit');
  assert.equal(head(dir), sha, 'nothing is committed');
});

test('the recovery line brings the epic back byte for byte', (t) => {
  const dir = repo(t);
  const before = snapshot(dir).files;

  assert.equal(run(dir, ['archive', EPIC]).code, 0);
  commit(dir, 'archive epic 08');
  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
  const line = index.match(/git checkout ([0-9a-f]{40}) -- ([^\s`]+)/);
  assert.ok(line, index);
  git(dir, ['checkout', line[1], '--', line[2]]);

  assert.equal(snapshot(dir, { skip: path.join(dir, 'epics', 'INDEX.md') }).files, before);
});

test('a planned story and a dirty file are both named, and nothing changes', (t) => {
  const dir = repo(t, { secondStatus: null });
  write(dir, `${EPIC}/index.md`, '# Epic 08 — Evidence levels\n\nedited\n');
  const before = snapshot(dir);

  const res = run(dir, ['archive', EPIC]);

  assert.notEqual(res.code, 0);
  assert.match(res.output, /story-08-02-policy-fingerprint.*planned/);
  assert.match(res.output, /uncommitted/);
  assert.deepEqual(snapshot(dir), before);
});

test('an in-progress or blocked story refuses', (t) => {
  for (const status of ['in-progress', 'blocked']) {
    const dir = repo(t, { secondStatus: status });
    const before = snapshot(dir);
    const res = run(dir, ['archive', EPIC]);
    assert.notEqual(res.code, 0, status);
    assert.match(res.output, new RegExp(`story-08-02-policy-fingerprint.*${status}`));
    assert.deepEqual(snapshot(dir), before);
  }
});

test('a worktree linked to one of its stories refuses', (t) => {
  const dir = repo(t);
  const wt = `${dir}-wt`;
  t.after(() => fs.rmSync(wt, { recursive: true, force: true }));
  git(dir, ['worktree', 'add', '-q', '-b', 'story-08-01-coverage-floor', wt]);
  const before = snapshot(dir);

  const res = run(dir, ['archive', EPIC]);

  assert.notEqual(res.code, 0);
  assert.match(res.output, /worktree/i);
  assert.match(res.output, /story-08-01-coverage-floor/);
  assert.deepEqual(snapshot(dir), before);
});

test('an untracked file in the epic refuses', (t) => {
  const dir = repo(t);
  write(dir, `${EPIC}/notes.md`, 'scratch\n');
  const before = snapshot(dir);

  const res = run(dir, ['archive', EPIC]);

  assert.notEqual(res.code, 0);
  assert.match(res.output, /uncommitted|untracked/);
  assert.deepEqual(snapshot(dir), before);
});

test('a tree that differs from main, or is absent there, refuses and says to merge', (t) => {
  const dir = repo(t);
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, `${EPIC}/index.md`, '# Epic 08 — Evidence levels\n\nchanged on a branch\n');
  commit(dir, 'change on feature');
  let before = snapshot(dir);
  let res = run(dir, ['archive', EPIC]);
  assert.notEqual(res.code, 0);
  assert.match(res.output, /differs from main/);
  assert.match(res.output, /merge/i);
  assert.deepEqual(snapshot(dir), before);

  const other = 'epics/epic-09-monorepo';
  write(dir, `${other}/index.md`, '# Epic 09 — Monorepo\n');
  write(dir, `${other}/story-09-01-x/spec.md`, '# Story 09-01 — X\n');
  write(dir, `${other}/story-09-01-x/tasks.md`, '## Status: done\n');
  commit(dir, 'epic 09 only on feature');
  before = snapshot(dir);
  res = run(dir, ['archive', other]);
  assert.notEqual(res.code, 0);
  assert.match(res.output, /absent from main/);
  assert.deepEqual(snapshot(dir), before);
});

test('--dry-run prints the entry and the deletion, and writes nothing', (t) => {
  const dir = repo(t);
  const before = snapshot(dir);

  const res = run(dir, ['archive', EPIC, '--dry-run']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /coding-flow:archived 08 evidence-levels/);
  assert.match(res.output, /git rm/);
  assert.match(res.output, /08-01/);
  assert.deepEqual(snapshot(dir), before);
});

test('an epic already archived says so, exits 0 and writes no second entry', (t) => {
  const dir = repo(t);
  assert.equal(run(dir, ['archive', EPIC]).code, 0);
  commit(dir, 'archive');
  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');

  for (const arg of [EPIC, '08']) {
    const res = run(dir, ['archive', arg]);
    assert.equal(res.code, 0, res.output);
    assert.match(res.output, /already archived/);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8'), index);
});

test('a story with no verify captured is recorded as it stands, never as verified', (t) => {
  const dir = repo(t);

  const res = run(dir, ['archive', '08', '--json']);

  assert.equal(res.code, 0, res.output);
  const payload = JSON.parse(res.output);
  const first = payload.stories.find((s) => s.name === 'story-08-01-coverage-floor');
  assert.equal(first.status, 'done');
  assert.equal(first.contradicted, 'written; no verify captured');
  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
  assert.match(index, /no verify captured/);
  assert.doesNotMatch(index, /verified/);
});

test('a stale proof is recorded as stale', (t) => {
  const dir = repo(t, { secondStatus: null });
  verifyRun(dir, `${EPIC}/story-08-02-policy-fingerprint`, { ok: true, name: '2026-11-01T00-00-00-000Z', treeToken: 'old-tree' });

  const res = run(dir, ['archive', EPIC]);

  assert.equal(res.code, 0, res.output);
  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
  assert.match(index, /08-02[^\n]*stale/);
});

test('evidence left for an archived story is not reported by status, next, audit or trace', (t) => {
  const dir = repo(t);
  const live = 'epics/epic-09-monorepo/story-09-01-packages';
  write(dir, 'epics/epic-09-monorepo/index.md', '# Epic 09 — Monorepo\n');
  write(dir, `${live}/spec.md`, '# Story 09-01 — Packages\n');
  write(dir, `${live}/tasks.md`, '## Status: in-progress\n');
  commit(dir, 'epic 09');
  // A red proof and a green one for the story about to be archived; a green
  // one (no tree token, so never stale) for a story that stays.
  verifyRun(dir, `${EPIC}/story-08-01-coverage-floor`, { ok: false, name: '2026-11-01T00-00-00-000Z' });
  verifyRun(dir, `${EPIC}/story-08-02-policy-fingerprint`, { ok: true, name: '2026-11-01T00-00-01-000Z', treeToken: 'old-tree' });
  verifyRun(dir, live, { ok: true, name: '2026-11-01T00-00-02-000Z' });

  assert.equal(run(dir, ['archive', EPIC]).code, 0);
  commit(dir, 'archive epic 08');

  for (const args of [['status'], ['status', '--json'], ['next'], ['next', '--all'], ['audit'], ['audit', '--check'], ['trace'], ['trace', '--json']]) {
    const res = run(dir, args);
    assert.doesNotMatch(res.output, /epic-08-evidence-levels/, `${args.join(' ')}: ${res.output}`);
    assert.doesNotMatch(res.output, /Error|TypeError|ENOENT/, `${args.join(' ')}: ${res.output}`);
  }
  assert.equal(run(dir, ['audit', '--check']).code, 0, 'the gate judges the stories that still exist');
});

test('tracked files outside the epic that link into it are listed, not edited', (t) => {
  const dir = repo(t);
  write(dir, 'docs/plan.md', `See [the epic](../${EPIC}/index.md).\n`);
  commit(dir, 'link');

  const res = run(dir, ['archive', EPIC]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /still links here/i);
  assert.match(res.output, /docs\/plan\.md/);
  assert.doesNotMatch(res.output.split('links here')[1], /README\.md/);
  assert.equal(fs.readFileSync(path.join(dir, 'docs/plan.md'), 'utf8'), `See [the epic](../${EPIC}/index.md).\n`);
});

test('a user-written INDEX.md is kept and the archived section is appended after it', (t) => {
  const dir = repo(t);
  write(dir, 'epics/INDEX.md', '# My epics\n\nHand-written notes.\n');
  commit(dir, 'index');

  assert.equal(run(dir, ['archive', EPIC]).code, 0);

  const index = fs.readFileSync(path.join(dir, 'epics/INDEX.md'), 'utf8');
  assert.ok(index.startsWith('# My epics\n\nHand-written notes.\n'), index);
  assert.match(index, /coding-flow:archived 08 evidence-levels/);
});

test('an ambiguous number, a path outside epics/ and a missing repository refuse', (t) => {
  const dir = repo(t);
  write(dir, 'epics/epic-08-other/index.md', '# Epic 08 — Other\n');
  write(dir, 'epics/epic-08-other/story-08-01-y/tasks.md', '## Status: done\n');
  commit(dir, 'second 08');
  const before = snapshot(dir);

  let res = run(dir, ['archive', '08']);
  assert.notEqual(res.code, 0);
  assert.match(res.output, /epic-08-evidence-levels/);
  assert.match(res.output, /epic-08-other/);

  res = run(dir, ['archive', 'epics/../README.md']);
  assert.notEqual(res.code, 0);
  res = run(dir, ['archive', '../outside']);
  assert.notEqual(res.code, 0);
  assert.deepEqual(snapshot(dir), before);

  const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-archive-nogit-')));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  fs.mkdirSync(path.join(bare, '.coding-flow'));
  write(bare, `${EPIC}/index.md`, '# Epic 08\n');
  write(bare, `${EPIC}/story-08-01-a/tasks.md`, '## Status: done\n');
  res = run(bare, ['archive', EPIC]);
  assert.notEqual(res.code, 0);
  assert.match(res.output, /git/);
  assert.ok(fs.existsSync(path.join(bare, EPIC)));
});
