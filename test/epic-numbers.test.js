'use strict';

// Story 17-03: an epic number is never handed out twice. The next number is
// taken from everything the checkout can see — the epic directories on disk,
// the archived entries of `epics/INDEX.md`, and the `epics/` tree of every
// local and remote-tracking ref (no fetch) — and `doctor` warns as soon as a
// number on disk is already held by an archived epic or by another branch.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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

function epic(dir, name) {
  write(dir, `epics/${name}/index.md`, `# ${name}\n`);
}

function archivedIndex(dir, entries) {
  const lines = ['# Epics', '', '## Archived epics', '', '<!-- coding-flow:archived-section -->', ''];
  for (const [number, slug] of entries) {
    lines.push(`### Epic ${number} — ${slug} <!-- coding-flow:archived ${number} ${slug} -->`, '', 'Archived.', '');
  }
  write(dir, 'epics/INDEX.md', lines.join('\n'));
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-epic-numbers-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A repository on `main` with an install and one commit.
function repo(t) {
  const dir = tempDir(t);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  assert.equal(run(dir, ['init']).code, 0);
  write(dir, 'README.md', '# Project\n');
  commit(dir, 'init');
  return dir;
}

// `other` carries `epics/<name>`; the checkout is back on `main` after.
function otherBranch(dir, name, branch = 'other') {
  git(dir, ['checkout', '-q', '-b', branch]);
  epic(dir, name);
  commit(dir, `plan ${name}`);
  git(dir, ['checkout', '-q', 'main']);
}

function statusJson(dir) {
  const res = run(dir, ['status', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output);
}

function warnings(dir) {
  const res = run(dir, ['doctor', '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output).warnings;
}

test('the next epic number counts the disk, the archived entries and the other branches', (t) => {
  const dir = repo(t);
  epic(dir, 'epic-01-payments');
  archivedIndex(dir, [['02', 'old-thing']]);
  commit(dir, 'epics');
  otherBranch(dir, 'epic-03-x');

  const payload = statusJson(dir);
  assert.equal(payload.nextEpicNumber, '04');
  assert.ok(payload.nextEpicNumberSources.refs.includes('other'), JSON.stringify(payload.nextEpicNumberSources));
  assert.ok(!payload.nextEpicNumberSources.refs.includes('main'), 'the current branch is the disk, not a ref');
  assert.equal(payload.nextEpicNumberSources.refsCapped, false);
});

test('a repository with no remote and no other branch counts the disk and the index alone', (t) => {
  const dir = repo(t);
  epic(dir, 'epic-01-payments');
  archivedIndex(dir, [['05', 'gone']]);

  const payload = statusJson(dir);
  assert.equal(payload.nextEpicNumber, '06');
  assert.deepEqual(payload.nextEpicNumberSources.refs, []);
  assert.equal(payload.nextEpicNumberSources.refsScanned, 0);
  assert.equal(payload.nextEpicNumberSources.lastFetch, null);
});

test('outside a git repository the number comes from the disk, and nothing fails', (t) => {
  const dir = tempDir(t);
  assert.equal(run(dir, ['init']).code, 0);
  const payload = statusJson(dir);
  assert.equal(payload.nextEpicNumber, '01');
  assert.equal(payload.nextEpicNumberSources.git, false);
  epic(dir, 'epic-07-x');
  assert.equal(statusJson(dir).nextEpicNumber, '08');
});

test('the number keeps the width already in use', (t) => {
  const dir = repo(t);
  epic(dir, 'epic-009-x');
  assert.equal(statusJson(dir).nextEpicNumber, '010');
});

test('a remote-tracking ref counts, as of the last fetch', (t) => {
  const upstream = repo(t);
  otherBranch(upstream, 'epic-11-remote-only', 'feature');
  const dir = tempDir(t);
  git(dir, ['clone', '-q', upstream, '.']);
  assert.equal(run(dir, ['init']).code, 0);

  const sources = statusJson(dir).nextEpicNumberSources;
  assert.equal(statusJson(dir).nextEpicNumber, '12');
  assert.ok(sources.refs.includes('origin/feature'), JSON.stringify(sources));
  assert.equal(sources.remoteRefsAsOfLastFetch, true);
});

test('the ref scan is capped, and the cap is said', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-03-a', 'b1');
  otherBranch(dir, 'epic-04-b', 'b2');
  const { epicNumbers } = require('../bin/lib/epic-numbers');
  const result = epicNumbers(dir, { refLimit: 1 });
  assert.equal(result.sources.refsCapped, true);
  assert.equal(result.sources.refsScanned, 1);
  assert.equal(result.sources.refLimit, 1);
});

test('a ref name is an argument, never shell text', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-02-x', 'evil$(touch${IFS}pwned)');
  const payload = statusJson(dir);
  assert.equal(payload.nextEpicNumber, '03');
  assert.ok(!fs.existsSync(path.join(dir, 'pwned')));
});

test('doctor warns when a number on disk is held by an archived epic under another slug', (t) => {
  const dir = repo(t);
  archivedIndex(dir, [['02', 'old-thing']]);
  epic(dir, 'epic-02-y');

  const found = warnings(dir).find((w) => w.code === 'archived_epic_number_reused');
  assert.ok(found, 'expected archived_epic_number_reused');
  assert.match(found.message, /epic-02-y/);
  assert.match(found.message, /old-thing/);
});

test('doctor warns when another branch uses the number under another slug', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-03-x');
  epic(dir, 'epic-03-z');

  const found = warnings(dir).find((w) => w.code === 'epic_number_on_other_branch');
  assert.ok(found, 'expected epic_number_on_other_branch');
  assert.match(found.message, /\bother\b/);
  assert.match(found.message, /epic-03-x/);
  assert.match(found.message, /renumber/);
});

test('doctor stays quiet for the same epic on both branches', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-03-x');
  otherBranch(dir, 'epic-02-old-thing', 'stale-copy');
  epic(dir, 'epic-03-x');
  archivedIndex(dir, [['02', 'old-thing']]);

  const codes = warnings(dir).map((w) => w.code);
  assert.ok(!codes.includes('epic_number_on_other_branch'), codes.join(', '));
  assert.ok(!codes.includes('archived_epic_number_reused'), codes.join(', '));
});

test('the same slug archived under its own number is not a reuse', (t) => {
  const dir = repo(t);
  archivedIndex(dir, [['02', 'old-thing']]);
  epic(dir, 'epic-03-new');
  assert.ok(!warnings(dir).some((w) => w.code === 'archived_epic_number_reused'));
});

test('archive --refresh prints the next epic number', (t) => {
  const dir = repo(t);
  epic(dir, 'epic-01-payments');
  commit(dir, 'epic 01');
  otherBranch(dir, 'epic-04-x');
  const res = run(dir, ['archive', '--refresh']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Next epic number: 05/);
  const json = JSON.parse(run(dir, ['archive', '--refresh', '--json', '--dry-run']).output);
  assert.equal(json.nextEpicNumber, '05');
});

test('/flow-plan takes the epic number from nextEpicNumber, not a directory listing', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'templates', '.claude', 'skills', 'flow-plan', 'SKILL.md'), 'utf8');
  const conventions = skill.slice(skill.indexOf('## Conventions'), skill.indexOf('## Pipeline'));
  assert.match(conventions, /ai-flow status --json/);
  assert.match(conventions, /nextEpicNumber/);
});

test('the sources list only the refs that hold epics, and count the rest', (t) => {
  const dir = repo(t);
  for (let i = 0; i < 5; i += 1) git(dir, ['branch', `empty-${i}`]);
  otherBranch(dir, 'epic-03-x');
  const sources = statusJson(dir).nextEpicNumberSources;
  assert.deepEqual(sources.refs, ['other']);
  assert.equal(sources.refsScanned, 6);
});

test('a non-ASCII or quoted slug on both branches is the same epic', (t) => {
  const dir = repo(t);
  git(dir, ['config', 'core.quotePath', 'true']);
  otherBranch(dir, 'epic-05-café');
  otherBranch(dir, 'epic-06-say "hi"', 'quoted');
  epic(dir, 'epic-05-café');
  epic(dir, 'epic-06-say "hi"');
  const codes = warnings(dir).map((w) => w.code);
  assert.ok(!codes.includes('epic_number_on_other_branch'), codes.join(', '));
  assert.equal(statusJson(dir).nextEpicNumber, '07');
});

test('one collision held by several refs is one warning that lists them, with a stale-ref hint', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-03-x');
  git(dir, ['branch', 'copy-of-other', 'other']);
  epic(dir, 'epic-03-z');
  const found = warnings(dir).filter((w) => w.code === 'epic_number_on_other_branch');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].message, /copy-of-other/);
  assert.match(found[0].message, /\bother\b/);
  assert.match(found[0].message, /git fetch --prune/);
});

test('a detached HEAD scans every local branch', (t) => {
  const dir = repo(t);
  otherBranch(dir, 'epic-03-x');
  git(dir, ['checkout', '-q', '--detach', 'main']);
  epic(dir, 'epic-03-z');
  const payload = statusJson(dir);
  assert.equal(payload.nextEpicNumber, '04');
  assert.ok(warnings(dir).some((w) => w.code === 'epic_number_on_other_branch'));
});

test('a linked worktree sees the primary branch as another ref', (t) => {
  const dir = repo(t);
  epic(dir, 'epic-04-main-only');
  commit(dir, 'epic 04');
  const linked = path.join(tempDir(t), 'wt');
  git(dir, ['worktree', 'add', '-q', '-b', 'side', linked, 'main~1']);
  const payload = statusJson(linked);
  assert.equal(payload.nextEpicNumber, '05');
  assert.ok(payload.nextEpicNumberSources.refs.includes('main'), JSON.stringify(payload.nextEpicNumberSources));
});

test('a shallow clone counts its fetched refs', (t) => {
  const upstream = repo(t);
  otherBranch(upstream, 'epic-09-far', 'feature');
  const dir = tempDir(t);
  git(dir, ['clone', '-q', '--depth', '1', '--no-single-branch', `file://${upstream}`, '.']);
  assert.equal(statusJson(dir).nextEpicNumber, '10');
});
