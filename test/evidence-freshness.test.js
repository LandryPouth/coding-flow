'use strict';

// Contract tests for evidence freshness (proposal #1): a green verify only counts
// as proof of the CURRENT code. verify captures a working-tree content token; when
// the code changes after the run, status shows "stale" and `audit --check` fails
// until a re-verify. The token is content-addressed, so it stays valid across the
// commit that materializes exactly what was verified (no false "stale" on commit).
// Freshness is only enforced when the token exists on both sides (git repo);
// otherwise the old lenient behavior holds. We prove it end-to-end.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { currentTreeToken } = require('../bin/lib/identity');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function initGitRepo(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

function setValidationCommands(dir, commands) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function statusOf(dir, storyRel) {
  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  const data = JSON.parse(output);
  for (const epic of data.epics) {
    for (const story of epic.stories) {
      if (story.path === storyRel) return story.status;
    }
  }
  throw new Error(`story ${storyRel} not found in status output`);
}

// A git project with one story and a green validation command, all committed.
function gitProjectWithStory(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  initGitRepo(dir);
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(dir, storyRel), { recursive: true });
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return { dir, storyRel };
}

// --- unit: the token primitive ----------------------------------------------

test('currentTreeToken is null outside a git repo', (t) => {
  const dir = tmp('token-nogit');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(currentTreeToken(dir), null);
});

test('currentTreeToken is stable, moves on edit, and survives the commit of that edit', (t) => {
  const dir = tmp('token-git');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  initGitRepo(dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);

  const t0 = currentTreeToken(dir);
  assert.ok(t0, 'a committed repo has a token');
  assert.equal(currentTreeToken(dir), t0, 'the token is stable when nothing changes');

  // Edit a tracked file (uncommitted) -> the token moves.
  fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  const t1 = currentTreeToken(dir);
  assert.notEqual(t1, t0, 'editing tracked content moves the token');

  // Commit exactly that dirty state -> content-addressed token is unchanged.
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'edit']);
  assert.equal(currentTreeToken(dir), t1, 'the token survives the commit that materializes the same content');
});

// --- status: verified -> stale -> verified ----------------------------------

test('status flips a story to "stale" when the code changes after a green verify', (t) => {
  const { dir, storyRel } = gitProjectWithStory(t, 'fresh-status');

  assert.equal(run(dir, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(statusOf(dir, storyRel), 'verified', 'a fresh green verify is verified');

  // Change tracked code after the proof.
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n\nchanged after verify\n');
  assert.equal(statusOf(dir, storyRel), 'stale', 'the proof no longer matches the code');

  // Re-verify on the new state.
  assert.equal(run(dir, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(statusOf(dir, storyRel), 'verified', 're-verifying the current code restores verified');
});

test('committing exactly the verified state keeps a story "verified" (no false stale)', (t) => {
  const { dir, storyRel } = gitProjectWithStory(t, 'fresh-commit');

  // Make an uncommitted change, verify it, then commit that exact state.
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n\nimplemented\n');
  assert.equal(run(dir, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(statusOf(dir, storyRel), 'verified');

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'implement story']);
  assert.equal(statusOf(dir, storyRel), 'verified', 'committing the verified content must not turn it stale');
});

// --- audit --check: the CI gate rejects stale proofs ------------------------

test('audit --check fails on a stale proof and passes again after re-verify', (t) => {
  const { dir, storyRel } = gitProjectWithStory(t, 'fresh-audit');

  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(run(dir, ['audit', '--check']).code, 0, 'a fresh green proof passes the gate');

  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n\nedited after proof\n');
  const stale = run(dir, ['audit', '--check']);
  assert.equal(stale.code, 1, 'a stale proof fails the gate');
  assert.match(stale.output, /stale/i);

  run(dir, ['harness', 'verify', '--story', storyRel]);
  assert.equal(run(dir, ['audit', '--check']).code, 0, 're-verify clears the gate');
});

// --- backward compatibility --------------------------------------------------

test('a verify without a tree token (old or non-git evidence) is never stale', (t) => {
  const { dir, storyRel } = gitProjectWithStory(t, 'fresh-legacy');
  run(dir, ['harness', 'verify', '--story', storyRel]);

  // Simulate legacy evidence: strip the token from the captured run file.
  const runsDir = path.join(dir, '.coding-flow', 'runs');
  for (const name of fs.readdirSync(runsDir).filter((f) => f.endsWith('-verify.json'))) {
    const p = path.join(runsDir, name);
    const ev = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (ev.provenance && ev.provenance.git) delete ev.provenance.git.treeToken;
    fs.writeFileSync(p, `${JSON.stringify(ev, null, 2)}\n`);
  }

  // Change the code: without a stored token, freshness is undecidable -> lenient.
  fs.writeFileSync(path.join(dir, storyRel, 'story.md'), '# Story 01.01\n\nchanged\n');
  assert.equal(statusOf(dir, storyRel), 'verified', 'no token -> keep the old lenient behavior');
  assert.equal(run(dir, ['audit', '--check']).code, 0, 'the gate stays lenient without a token');
});
