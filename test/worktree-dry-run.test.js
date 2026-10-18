'use strict';

// `--dry-run` on a worktree subcommand never acts. `land --dry-run` used to
// start the real rebase and leave the story worktree mid-rebase (DOGFOODING,
// 2026-10-18): `worktreeCommand` passed `dryRun` to add/remove but not to land.
// Now land previews and touches nothing; subcommands with no preview refuse the
// flag instead of ignoring it.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { currentTreeToken } = require('../bin/lib/identity');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, 'worktree', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function commitAll(cwd, message) {
  sh(cwd, 'git', ['add', '-A']);
  sh(cwd, 'git', ['commit', '-m', message]);
}

function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-wt-dry-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(repo, 'epics', 'epic-01', 'story-01'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'epics', 'epic-01', 'story-01', 'story.md'), '# Story\n');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  fs.mkdirSync(path.join(repo, '.coding-flow'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.coding-flow', 'config.json'),
    JSON.stringify({ validation: { commands: ['node -e "process.exit(0)"'] } }, null, 2),
  );
  commitAll(repo, 'init');
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const added = run(repo, ['add', 'story-01']);
  assert.equal(added.code, 0, added.output);
  return { base, repo, storyWt: path.join(base, 'repo-worktrees', 'story-01') };
}

function writeVerify(storyWt) {
  const runsDir = path.join(storyWt, '.coding-flow', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(
    path.join(runsDir, `${Date.now()}-fixture-verify.json`),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      ok: true,
      story: 'epics/epic-01/story-01',
      commandsFound: 1,
      commandSource: 'test-fixture',
      provenance: { git: { treeToken: currentTreeToken(storyWt) } },
    }),
  );
  commitAll(storyWt, 'chore: capture verify evidence');
}

// Everything a land could move: both HEADs, the branch, the worktree list, an
// in-progress rebase, both trees' status, the runs directory, the land lock.
function snapshot(repo, storyWt) {
  const gitDir = sh(repo, 'git', ['rev-parse', '--git-common-dir']).trim();
  const common = path.resolve(repo, gitDir);
  const wtGitDir = path.resolve(storyWt, sh(storyWt, 'git', ['rev-parse', '--git-dir']).trim());
  const runs = path.join(repo, '.coding-flow', 'runs');
  return {
    targetHead: sh(repo, 'git', ['rev-parse', 'HEAD']).trim(),
    storyHead: sh(storyWt, 'git', ['rev-parse', 'HEAD']).trim(),
    branch: sh(repo, 'git', ['branch', '--list', 'story-01']).trim(),
    worktrees: sh(repo, 'git', ['worktree', 'list', '--porcelain']),
    rebasing: fs.existsSync(path.join(wtGitDir, 'rebase-merge')) || fs.existsSync(path.join(wtGitDir, 'rebase-apply')),
    targetStatus: sh(repo, 'git', ['status', '--porcelain']),
    storyStatus: sh(storyWt, 'git', ['status', '--porcelain']),
    runs: fs.existsSync(runs) ? fs.readdirSync(runs).sort() : [],
    landLock: fs.existsSync(path.join(common, 'coding-flow', 'land.lock')),
  };
}

test('land --dry-run on a fast-forwardable story previews and changes nothing', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  fs.writeFileSync(path.join(storyWt, 'feature.txt'), 'story work\n');
  commitAll(storyWt, 'story: add feature');
  writeVerify(storyWt);

  const before = snapshot(repo, storyWt);
  const { code, output } = run(repo, ['land', 'story-01', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /Dry run/);
  assert.match(output, /fast-forward/);
  assert.match(output, /re-run the validation commands/);
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
});

test('land --dry-run on a diverged story with a conflict predicts it and leaves no rebase behind', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  fs.writeFileSync(path.join(storyWt, 'shared.txt'), 'story change\n');
  commitAll(storyWt, 'story: change shared');
  writeVerify(storyWt);
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'target change\n');
  commitAll(repo, 'target: change shared');

  const before = snapshot(repo, storyWt);
  const { code, output } = run(repo, ['land', 'story-01', '--dry-run']);
  assert.notEqual(code, 0, 'a land that would stop must say so with a failing exit');
  assert.match(output, /shared\.txt/, 'the predicted conflict names the file');
  assert.match(output, /nothing was changed/i);
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
  assert.equal(before.rebasing, false);
});

test('land --dry-run on a diverged story without a conflict previews the rebase', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  fs.writeFileSync(path.join(storyWt, 'feature.txt'), 'story work\n');
  commitAll(storyWt, 'story: add feature');
  writeVerify(storyWt);
  fs.writeFileSync(path.join(repo, 'target-only.txt'), 'target work\n');
  commitAll(repo, 'target: unrelated change');

  const before = snapshot(repo, storyWt);
  const { code, output } = run(repo, ['land', 'story-01', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /rebase/);
  assert.match(output, /no conflict predicted/);
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
});

test('land --dry-run on an already-landed story keeps the worktree and the branch', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  const before = snapshot(repo, storyWt);
  const { code, output } = run(repo, ['land', 'story-01', '--dry-run']);
  assert.equal(code, 0, output);
  assert.match(output, /Already landed/);
  assert.match(output, /would remove the worktree/);
  assert.ok(fs.existsSync(storyWt));
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
});

test('land --dry-run with no recorded verify fails like land, and changes nothing', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  fs.writeFileSync(path.join(storyWt, 'feature.txt'), 'story work\n');
  commitAll(storyWt, 'story: add feature');

  const before = snapshot(repo, storyWt);
  const { code, output } = run(repo, ['land', 'story-01', '--dry-run']);
  assert.notEqual(code, 0);
  assert.match(output, /no green verify recorded/);
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
});

test('subcommands with no preview refuse --dry-run instead of acting', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  const lock = path.join(repo, '.coding-flow', 'active-story.json');
  const cases = [
    ['lock', '--story', 'epics/epic-01/story-01', '--dry-run'],
    ['unlock', '--dry-run'],
    ['place', '--epic', 'epics/epic-01', '--story', 'epics/epic-01/story-01', '--dry-run'],
    ['autoland', '--epic', 'epics/epic-01', '--story', 'epics/epic-01/story-01', '--dry-run'],
  ];
  const before = snapshot(repo, storyWt);
  for (const args of cases) {
    const { code, output } = run(repo, args);
    assert.notEqual(code, 0, `${args[0]} --dry-run must not run`);
    assert.match(output, new RegExp(`${args[0]} does not support --dry-run`), output);
  }
  assert.ok(!fs.existsSync(lock), 'lock --dry-run must not write the lock file');
  assert.deepStrictEqual(snapshot(repo, storyWt), before);
});

test('a real land still works right after a dry run', (t) => {
  const { repo, storyWt } = repoWithStory(t);
  fs.writeFileSync(path.join(storyWt, 'feature.txt'), 'story work\n');
  commitAll(storyWt, 'story: add feature');
  writeVerify(storyWt);
  fs.writeFileSync(path.join(repo, 'target-only.txt'), 'target work\n');
  commitAll(repo, 'target: unrelated change');

  assert.equal(run(repo, ['land', 'story-01', '--dry-run']).code, 0);
  const { code, output } = run(repo, ['land', 'story-01']);
  assert.equal(code, 0, output);
  assert.match(sh(repo, 'git', ['log', '--oneline']), /story: add feature/);
  assert.ok(!fs.existsSync(storyWt), 'the real land removes the worktree');
});
