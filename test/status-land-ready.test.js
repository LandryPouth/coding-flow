'use strict';

// Contract tests for story-02-04: `ai-flow status` surfaces, per story with a
// linked worktree, whether that worktree is still active (locked), landable
// (clean + a green non-stale verify recorded *in that worktree*), or
// unverified (neither yet) — reusing the same dirty-check and verify-evidence
// collectors `worktree land` (story-02-02) will itself run as preconditions,
// rather than re-deriving that state a second way.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

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

// A git project ("repo/" inside a tmp base, so "../repo-worktrees" is
// writable) with one story and a green validation command, all committed.
function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-landready-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const storyRel = 'epics/epic-01-x/story-01-01-y';
  fs.mkdirSync(path.join(repo, storyRel), { recursive: true });
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 01.01\n');

  run(repo, ['init']);
  initGitRepo(repo);
  setValidationCommands(repo, ['node -e "process.exit(0)"']);
  // `verify` writes its evidence under `.coding-flow/runs/`; without this
  // ignored (as any real project using coding-flow is expected to do — see
  // harness.js's own `missing_gitignore` check), that evidence file would
  // itself show up as untracked "dirty" state right after running verify,
  // which is not the scenario under test here.
  fs.writeFileSync(path.join(repo, '.gitignore'), '.coding-flow/runs/\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo, storyRel, storyName: 'story-01-01-y' };
}

function storyOf(dir, storyRel) {
  const { code, output } = run(dir, ['status', '--json']);
  assert.equal(code, 0, `status --json must exit 0 (${output})`);
  const data = JSON.parse(output);
  for (const epic of data.epics) {
    for (const story of epic.stories) {
      if (story.path === storyRel) return story;
    }
  }
  throw new Error(`story ${storyRel} not found in status output`);
}

function worktreePath(base, storyName) {
  return path.join(base, 'repo-worktrees', storyName);
}

test('a story with no linked worktree has no landReady field', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  const story = storyOf(repo, storyRel);
  assert.equal(story.worktree, null);
  assert.ok(!('landReady' in story), 'landReady must be absent without a worktree');
});

test('a fresh worktree with no verify yet is "unverified"', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const story = storyOf(repo, storyRel);
  assert.equal(story.landReady, 'unverified');
  assert.ok(fs.existsSync(worktreePath(base, storyName)));
});

test('a clean worktree with a green, non-stale verify is "landable"', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const wt = worktreePath(base, storyName);
  assert.equal(run(wt, ['harness', 'verify', '--story', storyRel]).code, 0);

  assert.equal(storyOf(repo, storyRel).landReady, 'landable');
});

test('a dirty worktree stays "unverified" even with a recorded verify', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const wt = worktreePath(base, storyName);
  assert.equal(run(wt, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(storyOf(repo, storyRel).landReady, 'landable');

  // Uncommitted edit after the proof: dirty beats a stale-but-green verify.
  fs.writeFileSync(path.join(wt, storyRel, 'story.md'), '# Story 01.01\n\nediting again\n');
  assert.equal(storyOf(repo, storyRel).landReady, 'unverified');
});

test('a clean worktree with a recorded but failing verify is "unverified"', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const wt = worktreePath(base, storyName);
  setValidationCommands(wt, ['node -e "process.exit(1)"']);
  // Commit the config edit so the tree stays clean — this test is about a
  // *recorded but failing* verify specifically, not about the dirty-tree
  // branch that already has its own test above.
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', 'fail the validation command']);
  // The failing command makes `verify` itself exit non-zero, but the run
  // evidence (ok: false) is still recorded — landReady must read that
  // recorded outcome, not just "a verify ran at all".
  assert.notEqual(run(wt, ['harness', 'verify', '--story', storyRel]).code, 0);

  assert.equal(storyOf(repo, storyRel).landReady, 'unverified');
});

test('a stale verify (code changed since) is "unverified", not "landable"', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const wt = worktreePath(base, storyName);
  assert.equal(run(wt, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(storyOf(repo, storyRel).landReady, 'landable');

  // Commit a further change in the worktree: clean tree, but the proof no
  // longer describes this content.
  fs.writeFileSync(path.join(wt, storyRel, 'story.md'), '# Story 01.01\n\nchanged after verify\n');
  git(wt, ['add', '-A']);
  git(wt, ['commit', '-q', '-m', 'edit after verify']);

  assert.equal(storyOf(repo, storyRel).landReady, 'unverified');
});

test('a lock file in the worktree reports "active", regardless of verify state', (t) => {
  const { repo, base, storyRel, storyName } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const wt = worktreePath(base, storyName);
  assert.equal(run(wt, ['harness', 'verify', '--story', storyRel]).code, 0);
  assert.equal(storyOf(repo, storyRel).landReady, 'landable');

  fs.mkdirSync(path.join(wt, '.coding-flow'), { recursive: true });
  fs.writeFileSync(
    path.join(wt, '.coding-flow', 'active-story.json'),
    JSON.stringify({ story: storyRel }),
  );

  assert.equal(storyOf(repo, storyRel).landReady, 'active');
});

test('the text output shows landReady next to the worktree suffix', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  assert.equal(run(repo, ['worktree', 'add', '--story', storyRel]).code, 0);

  const { code, output } = run(repo, ['status']);
  assert.equal(code, 0);
  assert.match(output, /→ wt: .*\[unverified\]/);
});
