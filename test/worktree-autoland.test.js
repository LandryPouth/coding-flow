'use strict';

// Contract tests for `ai-flow worktree autoland` (bin/lib/worktree-plan.js's
// `autoLandIfChainFinished`, story-03-02): once a chain's last story reaches
// the derived "verified" state, its worktree lands onto the primary checkout
// automatically — reusing epic-02's existing `worktree land` contract exactly
// as-is, only deciding *when* to call it. Real throwaway git repos, the same
// pattern as worktree-plan.test.js and worktree.test.js's own land tests.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readPlacementState } = require('../bin/lib/worktree-plan');
const { currentTreeToken } = require('../bin/lib/identity');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function commitAll(cwd, message) {
  sh(cwd, 'git', ['add', '-A']);
  sh(cwd, 'git', ['commit', '-m', message]);
}

// Two sibling chains: A is a lone story (runs in the primary checkout), B is
// a two-story chain (root + a dependent) that ends up parallel to A in its
// own worktree — the exact shape spec.md's own acceptance criteria describe.
const TWO_CHAIN_INDEX = `# Epic X

## Backbone

\`\`\`text
s1

s2 ── s3
\`\`\`

## Stories

1. **story-x-01-a** — root of chain A, runs in the primary checkout.
2. **story-x-02-b** — root of chain B, parallel to chain A.
3. **story-x-03-c** — continues chain B (its last story).
`;

// A third, independent single-story chain (C), for the "sibling worktree
// untouched" case.
const THREE_CHAIN_INDEX = `# Epic X

## Backbone

\`\`\`text
s1

s2 ── s3

s4
\`\`\`

## Stories

1. **story-x-01-a** — root of chain A, runs in the primary checkout.
2. **story-x-02-b** — root of chain B, parallel to chain A.
3. **story-x-03-c** — continues chain B (its last story).
4. **story-x-04-d** — root of chain C, also parallel to chain A.
`;

function freshRepo(t, { indexMd, storyDirs, command = 'node -e "process.exit(0)"', gitignore = null }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-autoland-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);

  const epicPath = 'epics/epic-x';
  fs.mkdirSync(path.join(repo, epicPath), { recursive: true });
  fs.writeFileSync(path.join(repo, epicPath, 'index.md'), indexMd);
  for (const dir of storyDirs) {
    fs.mkdirSync(path.join(repo, epicPath, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, epicPath, dir, 'story.md'), `# ${dir}\n`);
  }

  fs.mkdirSync(path.join(repo, '.coding-flow'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.coding-flow', 'config.json'),
    JSON.stringify({ validation: { commands: [command] } }, null, 2),
  );

  // Opt-in: this project's own root `.gitignore` excludes `.coding-flow/runs/`
  // (it always has, since this repo's very first commit) — a `/flow-review`
  // found that auto-land's root re-verify step used to crash under exactly
  // this convention (`git add` on an explicitly-named, fully-ignored path
  // exits non-zero without `-f`). Most tests below don't need this — only
  // the dedicated regression test does — since introducing it everywhere
  // would silently change what `writeVerify`'s own `git add -A`-based commit
  // helper actually stages.
  if (gitignore) {
    fs.writeFileSync(path.join(repo, '.gitignore'), gitignore);
  }

  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo, epicPath };
}

// Runs the real `ai-flow verify` CLI, the same way flow-run does — as opposed
// to `writeVerify` below, which hand-writes+commits an evidence file for
// tests that don't care about this. `harness.js`'s `writeVerifyEvidence`
// never runs `git add`/`git commit` (grep confirms zero call sites in this
// codebase): the evidence lands as a plain, untracked file, gitignored in
// this project's own `.gitignore`. Needed to reproduce the P0 above faithfully
// — `writeVerify`'s own commit-based convention only works because no test
// fixture ships a `.gitignore`.
function realVerify(cwd, storyRel) {
  sh(cwd, process.execPath, [CLI, 'verify', '--story', storyRel]);
}

// Appends the explicit `## Status: done` line `flow-run` always writes on
// finishing a story (skills/flow-run/SKILL.md's "Status From Proof" step) —
// the authoritative signal `chainIsFinished` reads (storage/local.js's own
// `inferStoryStatus`, step 1, wins over its verify-based fallback). Real
// usage never reaches that fallback; test fixtures should not rely on it
// either once a real code commit is involved (its own freshness derivation
// shares the same whole-repo `currentTreeToken` this fix is about, so it can
// go stale for reasons unrelated to what a given test means to exercise).
function markStoryDone(worktreePath, epicPath, dirName) {
  const storyMd = path.join(worktreePath, epicPath, dirName, 'story.md');
  fs.appendFileSync(storyMd, '\n## Status: done\n');
  commitAll(worktreePath, `chore: mark ${dirName} done`);
}

function place(cwd, epicPath, storyPath) {
  const output = sh(cwd, process.execPath, [CLI, 'worktree', 'place', '--epic', epicPath, '--story', storyPath, '--json']);
  return JSON.parse(output);
}

function autoland(cwd, epicPath, storyPath, { json = true } = {}) {
  const args = ['worktree', 'autoland', '--epic', epicPath, '--story', storyPath];
  if (json) args.push('--json');
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output, result: json ? JSON.parse(output) : null };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}`, result: null };
  }
}

// Writes a captured verify run file the same shape `harness verify` produces
// (see audit.js's `entryFromRunFile`), then commits it so the worktree stays
// clean — `.coding-flow/runs/*.json` is tracked content, not gitignored.
function writeVerify(worktreePath, storyRel, { ok = true } = {}) {
  const runsDir = path.join(worktreePath, '.coding-flow', 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const treeToken = currentTreeToken(worktreePath);
  const file = path.join(runsDir, `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-verify.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ok,
        story: storyRel,
        commandsFound: 1,
        commandSource: 'test-fixture',
        provenance: { git: { treeToken } },
      },
      null,
      2,
    ),
  );
  commitAll(worktreePath, `chore: capture verify evidence for ${storyRel}`);
}

test('auto-land: not-yet-done sibling in the same chain blocks the land', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  assert.equal(placedB.created, true, 'chain B must get its own worktree, primary is occupied by chain A');
  const worktreeB = placedB.location;

  // Only the chain's last story (c) is verified; its root (b) is not — the
  // land must not run while an earlier member of the same chain is still open.
  writeVerify(worktreeB, `${epicPath}/story-x-03-c`);

  const { code, result } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`);
  assert.equal(code, 0, 'a not-yet-finished chain is a no-op, not an error');
  assert.equal(result.landed, false);
  assert.equal(result.reason, 'chain-not-finished');
  assert.ok(fs.existsSync(worktreeB), 'the worktree must be untouched while the chain is unfinished');
});

test('auto-land: last story of a worktree\'d chain lands and removes the worktree directory', (t) => {
  const { base, repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const worktreeB = placedB.location;

  // Mirrors flow-run's own mandated order (skills/flow-run/SKILL.md's
  // "Status From Proof" step): verify captured first, `## Status: done`
  // written as its own commit right after — for BOTH stories, same as real
  // usage. Reproduces two gaps a `/flow-review` found, both now fixed:
  // (1) `chainIsFinished` used to compare every chain member's own verify
  // against one shared "current" token, so the chain's root story read as
  // stale the moment its dependent added a single commit afterward — a real
  // (non-toy) multi-story chain could never finish; (2) even past that,
  // `worktree land`'s own precondition (epic-02, unchanged) only checks
  // freshness for the story matching the worktree's name (always the
  // chain's root), which by design predates every dependent's later work —
  // `autoLandIfChainFinished` now honestly re-verifies the root against the
  // current tree, right before calling `land`, rather than working around
  // `land`'s own contract.
  writeVerify(worktreeB, `${epicPath}/story-x-02-b`);
  markStoryDone(worktreeB, epicPath, 'story-x-02-b');

  fs.writeFileSync(path.join(worktreeB, 'src.txt'), 'story c work\n');
  commitAll(worktreeB, 'feat: story c work');

  writeVerify(worktreeB, `${epicPath}/story-x-03-c`);
  markStoryDone(worktreeB, epicPath, 'story-x-03-c');

  const { code, result } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`);
  assert.equal(code, 0, 'a successful land must exit 0');
  assert.equal(result.landed, true);
  assert.equal(result.chainId, 's2');

  assert.ok(!fs.existsSync(worktreeB), 'the worktree directory must be gone after landing');
  const branches = sh(repo, 'git', ['branch', '--list', 'story-x-02-b']);
  assert.equal(branches.trim(), '', 'the chain\'s branch must be deleted');

  // Story-03-01's placement state must not point at a now-deleted worktree.
  const state = readPlacementState(repo, epicPath.split('/').pop());
  assert.ok(!('s2' in state.chains), 'the landed chain\'s placement entry must be cleared');

  // The parent `<repo>-worktrees/` directory must also be gone: this was the
  // only worktree under it.
  assert.ok(!fs.existsSync(path.join(base, 'repo-worktrees')), 'the now-empty parent directory must be removed too');
});

test('auto-land: lands even when .coding-flow/runs is gitignored (this project\'s own convention), reproducing a P0 a `/flow-review` found', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
    // The exact rule this repository's own root `.gitignore` has carried
    // since its first commit. The root-refresh step used to `git add --
    // .coding-flow/runs` before landing — explicitly naming an entirely
    // ignored path makes `git add` exit non-zero without `-f`, which crashed
    // this call, uncaught, on every real multi-story chain (the mandated
    // `## Status: done` commit always makes the root's own verify stale by
    // the time the chain finishes, so the refresh always ran). The fix reads
    // the refreshed evidence straight off disk instead of committing it —
    // `land`'s own freshness check does the same, so nothing needs to be
    // tracked either way.
    gitignore: '.coding-flow/runs/\n',
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const worktreeB = placedB.location;

  // Real `ai-flow verify` runs (not `writeVerify`'s hand-written+committed
  // fixture), so the evidence lands exactly as it does in real usage: an
  // untracked, gitignored file that is never committed.
  realVerify(worktreeB, `${epicPath}/story-x-02-b`);
  markStoryDone(worktreeB, epicPath, 'story-x-02-b');

  fs.writeFileSync(path.join(worktreeB, 'src.txt'), 'story c work\n');
  commitAll(worktreeB, 'feat: story c work');

  realVerify(worktreeB, `${epicPath}/story-x-03-c`);
  markStoryDone(worktreeB, epicPath, 'story-x-03-c');

  const { code, output, result } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`);
  assert.equal(code, 0, `auto-land must succeed when .coding-flow/runs is gitignored, got: ${output}`);
  assert.equal(result.landed, true);
  assert.ok(!fs.existsSync(worktreeB), 'the worktree directory must be gone after landing');
});

test('auto-land: a sibling worktree is untouched when only one of two chains lands', (t) => {
  const { base, repo, epicPath } = freshRepo(t, {
    indexMd: THREE_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c', 'story-x-04-d'],
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const placedD = place(repo, epicPath, `${epicPath}/story-x-04-d`);
  const worktreeB = placedB.location;
  const worktreeD = placedD.location;
  assert.notEqual(worktreeB, worktreeD, 'the two sibling chains must land in two different worktrees');

  writeVerify(worktreeB, `${epicPath}/story-x-02-b`);
  writeVerify(worktreeB, `${epicPath}/story-x-03-c`);

  const { result } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`);
  assert.equal(result.landed, true);

  assert.ok(!fs.existsSync(worktreeB), 'chain B\'s own worktree must be gone');
  assert.ok(fs.existsSync(worktreeD), 'chain C\'s sibling worktree must be untouched');
  assert.ok(fs.existsSync(path.join(base, 'repo-worktrees')), 'the parent directory must remain — a sibling worktree still lives there');

  const state = readPlacementState(repo, epicPath.split('/').pop());
  assert.ok(!('s2' in state.chains), 'the landed chain\'s entry must be cleared');
  assert.ok('s4' in state.chains, 'the still-running sibling chain\'s entry must be untouched');
});

test('auto-land: a chain that never left the primary checkout is a no-op on completion', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  writeVerify(repo, `${epicPath}/story-x-01-a`);

  const { code, result } = autoland(repo, epicPath, `${epicPath}/story-x-01-a`);
  assert.equal(code, 0);
  assert.equal(result.landed, false);
  assert.equal(result.reason, 'not-isolated');

  // Nothing about the primary checkout changes: it never had a worktree to
  // land in the first place.
  const branches = sh(repo, 'git', ['branch', '--list']);
  assert.doesNotMatch(branches, /story-x-01-a/, 'chain A never got its own branch/worktree to begin with');
});

test('auto-land: a --story/--epic naming a different, finished chain than the one at cwd must not silently land whatever is at cwd', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  writeVerify(repo, `${epicPath}/story-x-01-a`); // chain A: finished, never isolated (primary checkout)

  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const worktreeB = placedB.location;
  writeVerify(worktreeB, `${epicPath}/story-x-02-b`);
  writeVerify(worktreeB, `${epicPath}/story-x-03-c`); // chain B: also finished, in its own worktree

  // Invoked FROM chain B's worktree, but naming chain A's story — a mismatch
  // between `cwd` and the chain the caller actually asked about. Must fail
  // loudly, not land chain B's worktree while reporting on chain A.
  const { code, output } = autoland(worktreeB, epicPath, `${epicPath}/story-x-01-a`, { json: false });
  assert.notEqual(code, 0, 'a cwd/--story mismatch must not silently succeed');
  assert.match(output, /recorded location/, 'the error must explain the mismatch, not fail some other way');

  assert.ok(fs.existsSync(worktreeB), "chain B's worktree must be untouched — it was never the one asked about");
  const state = readPlacementState(repo, epicPath.split('/').pop());
  assert.ok('s1' in state.chains, "chain A's placement entry must be untouched");
  assert.ok('s2' in state.chains, "chain B's placement entry must be untouched — it must not have been landed by mistake");
});

test('auto-land: a failed post-land re-verify rolls back and is reported, exactly like a manual land', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
    command: 'node -e "process.exit(1)"',
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const worktreeB = placedB.location;

  writeVerify(worktreeB, `${epicPath}/story-x-02-b`);
  writeVerify(worktreeB, `${epicPath}/story-x-03-c`);

  const before = sh(repo, 'git', ['rev-parse', 'HEAD']).trim();
  const { code, output } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`, { json: false });
  assert.notEqual(code, 0, 'a failed re-verify must fail the autoland call, not silently succeed');
  assert.match(output, /process\.exit\(1\)/, 'the failing command must be reported, same as a manual land');

  const after = sh(repo, 'git', ['rev-parse', 'HEAD']).trim();
  assert.equal(after, before, 'the primary checkout must be reset to its exact pre-merge commit');
  assert.ok(fs.existsSync(worktreeB), 'the story worktree must be untouched after rollback');

  const state = readPlacementState(repo, epicPath.split('/').pop());
  assert.ok('s2' in state.chains, 'a rolled-back land must not clear the chain\'s placement entry');
});

test('auto-land: a failed re-verify of a stale chain root fails before land ever runs, leaving the chain untouched', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-x-01-a', 'story-x-02-b', 'story-x-03-c'],
    command: 'node -e "process.exit(1)"',
  });

  place(repo, epicPath, `${epicPath}/story-x-01-a`);
  const placedB = place(repo, epicPath, `${epicPath}/story-x-02-b`);
  const worktreeB = placedB.location;

  // Same shape as the "lands" test above (a real commit between the root's
  // own verify and the last story's, so the root's recorded verify is stale
  // by the time the chain finishes) — except the project's configured
  // command always fails, so the new pre-land refresh (`ai-flow verify
  // --story <root>`) itself fails, before `land` (and its own post-merge
  // re-verify) is ever reached. Distinct failure point from the test above,
  // which only exercises `land`'s own post-merge re-verify because the root
  // there is never stale.
  writeVerify(worktreeB, `${epicPath}/story-x-02-b`);
  markStoryDone(worktreeB, epicPath, 'story-x-02-b');

  fs.writeFileSync(path.join(worktreeB, 'src.txt'), 'story c work\n');
  commitAll(worktreeB, 'feat: story c work');

  writeVerify(worktreeB, `${epicPath}/story-x-03-c`);
  markStoryDone(worktreeB, epicPath, 'story-x-03-c');

  const branchTipBefore = sh(worktreeB, 'git', ['rev-parse', 'HEAD']).trim();
  const { code, output } = autoland(worktreeB, epicPath, `${epicPath}/story-x-03-c`, { json: false });
  assert.notEqual(code, 0, 'a failed root re-verify must fail the autoland call, not silently succeed');
  assert.match(output, /re-verifying chain root/, 'the failure must name the root re-verify step, not a generic land failure');
  assert.match(output, /process\.exit\(1\)/, 'the failing command output must be reported');

  assert.ok(fs.existsSync(worktreeB), 'the story worktree must be untouched — land never ran');
  assert.equal(
    sh(worktreeB, 'git', ['rev-parse', 'HEAD']).trim(),
    branchTipBefore,
    'nothing must be committed in the story worktree when the refresh itself fails',
  );

  const state = readPlacementState(repo, epicPath.split('/').pop());
  assert.ok('s2' in state.chains, 'the chain\'s placement entry must be untouched — nothing was landed');
});
