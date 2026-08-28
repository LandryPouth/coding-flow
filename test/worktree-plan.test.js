'use strict';

// Contract tests for `decidePlacement` (bin/lib/worktree-plan.js): given a
// real epic with two parallel chains (mirrors bethl epic-18's real shape,
// docs/DOGFOODING.md 2026-08-27) and a real throwaway git repo, does a
// requested story land in the right place, and does that decision survive a
// later, independent call the way a second `/flow-run` invocation would see
// it?

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { decidePlacement, readPlacementState, claimChainIfPossible } = require('../bin/lib/worktree-plan');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Runs the actual CLI entry point (bin/ai-flow.js), not decidePlacement()
// directly — covers the flag parsing, --json shape, and error-mapping glue in
// ai-flow.js's `worktree place` branch that the unit-level tests above never
// exercise.
function runCli(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, 'worktree', 'place', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const TWO_CHAIN_INDEX = `# Epic 18

## Backbone

\`Backbone: harden http then socket\`

\`\`\`text
s1 ── s2
s3 ── s4 ── s5
\`\`\`

## Stories

1. **story-18-01-a** — root of chain A.
2. **story-18-02-b** — continues chain A.
3. **story-18-03-c** — root of chain B, parallel to chain A.
4. **story-18-04-d** — continues chain B.
5. **story-18-05-e** — continues chain B.
`;

const LINEAR_INDEX = `# Epic 19

## Backbone

\`Backbone: a straight chain\`

\`\`\`text
s1 ── s2 ── s3 ── s4
\`\`\`

## Stories

1. **story-19-01-a** — root.
2. **story-19-02-b** — continues.
3. **story-19-03-c** — continues.
4. **story-19-04-d** — continues.
`;

function freshRepo(t, { epicDirName, indexMd, storyDirs }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-wtplan-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);

  const epicPath = path.join('epics', epicDirName);
  fs.mkdirSync(path.join(repo, epicPath), { recursive: true });
  fs.writeFileSync(path.join(repo, epicPath, 'index.md'), indexMd);
  for (const dir of storyDirs) {
    fs.mkdirSync(path.join(repo, epicPath, dir), { recursive: true });
    fs.writeFileSync(path.join(repo, epicPath, dir, 'story.md'), `# ${dir}\n`);
  }

  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);

  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo, epicPath: epicPath.split(path.sep).join('/') };
}

test('root of chain A runs in place: no worktree created', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const result = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });

  assert.equal(result.created, false);
  assert.equal(path.resolve(result.location), path.resolve(repo));
  assert.ok(!fs.existsSync(path.join(path.dirname(repo), 'repo-worktrees')), 'no worktree dir should exist yet');
});

test('root of the sibling chain gets a new worktree; the primary checkout is untouched', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });
  const second = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-03-c` });

  assert.equal(second.created, true);
  assert.notEqual(path.resolve(second.location), path.resolve(repo));
  assert.ok(fs.existsSync(second.location), 'the new worktree directory must exist');

  const list = sh(repo, 'git', ['worktree', 'list', '--porcelain']);
  assert.ok(list.includes('refs/heads/story-18-03-c'), 'a branch named after the sibling story must exist');
});

test('a dependent story reuses its chain\'s already-recorded location', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const first = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });
  const dependent = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-02-b` });

  assert.equal(dependent.created, false);
  assert.equal(path.resolve(dependent.location), path.resolve(first.location));
});

test('an epic with no Backbone section at all resolves to "run in place", no error', (t) => {
  const noBackboneIndex = `# Epic Solo\n\n## Stories\n\n1. **story-solo-01-a** — the only story.\n`;
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-solo',
    indexMd: noBackboneIndex,
    storyDirs: ['story-solo-01-a'],
  });

  const result = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-solo-01-a` });

  assert.equal(result.created, false);
  assert.equal(path.resolve(result.location), path.resolve(repo));
});

test('a linear epic (no parallel branch) never gets a worktree for any of its stories', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-19-linear',
    indexMd: LINEAR_INDEX,
    storyDirs: ['story-19-01-a', 'story-19-02-b', 'story-19-03-c', 'story-19-04-d'],
  });

  const first = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-19-01-a` });
  const last = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-19-04-d` });

  assert.equal(first.created, false);
  assert.equal(last.created, false);
  assert.equal(path.resolve(first.location), path.resolve(repo));
  assert.equal(path.resolve(last.location), path.resolve(repo));
});

test('placement is remembered across independent calls, the way a later /flow-run invocation would read it', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });
  const created = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-03-c` });

  // A brand new call, as if from a fresh process — no shared in-memory state,
  // only what was persisted to disk.
  const state = readPlacementState(repo, 'epic-18-two-chains');
  assert.equal(path.resolve(state.chains.s3.location), path.resolve(created.location));

  const again = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-04-d` });
  assert.equal(again.created, false);
  assert.equal(path.resolve(again.location), path.resolve(created.location));
});

test('a new worktree reports which chain it runs parallel to, not just its own location', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });
  const second = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-03-c` });

  assert.deepEqual(second.parallelTo, { chainId: 's1', location: path.resolve(repo) });
});

test('a story placed in place (no collision) reports no parallelTo', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const first = decidePlacement({ cwd: repo, epicPath, storyPath: `${epicPath}/story-18-01-a` });

  assert.equal(first.parallelTo, null);
});

test('a coding-flow project root that is not the git repository root fails loudly rather than mis-recording a placement', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const subdir = path.join(repo, 'epics');

  assert.throws(
    () => decidePlacement({ cwd: subdir, epicPath, storyPath: `${epicPath}/story-18-01-a` }),
    /project root to be the git repository root/,
  );
});

test('CLI: worktree place runs a chain root in place and reports the current checkout', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const { code, output } = runCli(repo, ['--epic', epicPath, '--story', `${epicPath}/story-18-01-a`]);

  assert.equal(code, 0);
  assert.match(output, /Chain: s1/);
  assert.match(output, /current checkout/);
});

test('CLI: worktree place explains which chain a new worktree runs parallel to', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  runCli(repo, ['--epic', epicPath, '--story', `${epicPath}/story-18-01-a`]);
  const { code, output } = runCli(repo, ['--epic', epicPath, '--story', `${epicPath}/story-18-03-c`]);

  assert.equal(code, 0);
  assert.match(output, /new worktree/);
  assert.match(output, /Reason: chain s1 already occupies this checkout/);
  assert.match(output, /chain s3 runs parallel to it/);
});

test('CLI: worktree place --json reports created + parallelTo for a sibling chain', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  runCli(repo, ['--epic', epicPath, '--story', `${epicPath}/story-18-01-a`]);
  const { code, output } = runCli(repo, [
    '--epic',
    epicPath,
    '--story',
    `${epicPath}/story-18-03-c`,
    '--json',
  ]);

  assert.equal(code, 0);
  const result = JSON.parse(output);
  assert.equal(result.created, true);
  assert.equal(result.chainId, 's3');
  assert.deepEqual(result.parallelTo, { chainId: 's1', location: path.resolve(repo) });
});

test('CLI: worktree place without --story fails with a clear message', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const { code, output } = runCli(repo, ['--epic', epicPath]);

  assert.equal(code, 1);
  assert.match(output, /requires --epic <dir> and --story <dir>/);
});

// These pin down the fix for the race the /flow-review pass on 2026-08-28
// found: the old `claimChain` re-read state right before writing but never
// re-checked occupancy against that fresh read, so two calls could each
// decide "unoccupied" against a stale read taken before either committed and
// both end up recorded — two different chains sharing one location, which is
// exactly the isolation failure this story exists to prevent. These tests
// call the primitive directly, sequentially, which is what a synchronous
// unit test can control: they prove the read-check-write is now a single
// atomic unit from one call's perspective, not that concurrent OS-level
// processes can never race (still a residual, far narrower window — see the
// function's own comment in worktree-plan.js).
test('claimChainIfPossible: a second, different chain cannot also claim a location the first chain just claimed', (t) => {
  const { repo } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const here = path.resolve(repo);
  const first = claimChainIfPossible(repo, 'epic-18-two-chains', 's1', here);
  const second = claimChainIfPossible(repo, 'epic-18-two-chains', 's3', here);

  assert.equal(first.status, 'claimed');
  assert.equal(second.status, 'occupied');
  assert.equal(second.occupyingChain[0], 's1');

  const state = readPlacementState(repo, 'epic-18-two-chains');
  assert.ok(!state.chains.s3, 's3 must not end up recorded at a location s1 already occupies');
});

test('claimChainIfPossible: claiming the same chain twice reuses the first location instead of overwriting it', (t) => {
  const { repo } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const here = path.resolve(repo);
  const elsewhere = path.join(path.dirname(repo), 'somewhere-else');

  const first = claimChainIfPossible(repo, 'epic-18-two-chains', 's1', here);
  const second = claimChainIfPossible(repo, 'epic-18-two-chains', 's1', elsewhere);

  assert.equal(first.status, 'claimed');
  assert.equal(second.status, 'already-recorded');
  assert.equal(path.resolve(second.location), here);

  const state = readPlacementState(repo, 'epic-18-two-chains');
  assert.equal(path.resolve(state.chains.s1.location), here, "the second call must not overwrite the first chain's claim");
});

// Everything above calls claimChainIfPossible sequentially, in one process —
// useful for pinning the decision logic, but it cannot exercise the failure
// mode a /flow-review pass on this story actually found: two REAL, separate
// OS processes racing claimChainIfPossible for two different, non-conflicting
// chains of the same epic (spec's own concurrency edge case). Before the fix,
// this reproduced two ways depending on timing — one call's successful-looking
// write silently vanished from disk with no error, or a raw ENOENT propagated
// out of claimChainIfPossible — because util.js's writeJson staged every
// writer through the same fixed `<path>.tmp` name and nothing serialized the
// read-decide-write across processes. The worker below is written to a real
// temp file (not under test/, so node's test-file discovery never picks it
// up) and spawned as N independent child processes, each claiming its own
// chain/location against the SAME shared epic state file at once, with a
// small artificial delay between its own write and rename to reliably widen
// the race window instead of relying on incidental process-scheduling luck.
function writeRaceWorker(dir) {
  const workerPath = path.join(dir, 'race-worker.js');
  fs.writeFileSync(
    workerPath,
    [
      "const fs = require('fs');",
      "const repo = process.argv[2];",
      "const epicName = process.argv[3];",
      "const chainId = process.argv[4];",
      "const location = process.argv[5];",
      "const delayMs = Number(process.argv[6] || 0);",
      // Widens the write-to-rename window without touching the shipped
      // implementation: patches the real fs.writeFileSync this process's own
      // require of worktree-plan.js/util.js calls through.
      "const originalWriteFileSync = fs.writeFileSync;",
      "fs.writeFileSync = function patched(file, ...rest) {",
      "  const result = originalWriteFileSync.call(fs, file, ...rest);",
      "  if (String(file).includes('.tmp') && delayMs > 0) {",
      "    const end = Date.now() + delayMs;",
      "    while (Date.now() < end) {}",
      "  }",
      "  return result;",
      "};",
      `const { claimChainIfPossible } = require(${JSON.stringify(path.join(__dirname, '..', 'bin', 'lib', 'worktree-plan'))});`,
      'try {',
      '  const result = claimChainIfPossible(repo, epicName, chainId, location);',
      '  console.log(JSON.stringify({ chainId, ...result }));',
      '} catch (err) {',
      '  console.log(JSON.stringify({ chainId, error: err.message }));',
      '  process.exitCode = 1;',
      '}',
    ].join('\n'),
  );
  return workerPath;
}

function spawnRaceWorker(workerPath, repo, epicName, chainId, location, delayMs) {
  return new Promise((resolve) => {
    const child = require('node:child_process').spawn(
      process.execPath,
      [workerPath, repo, epicName, chainId, location, String(delayMs)],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('exit', (code) => resolve({ code, stdout }));
  });
}

test('claimChainIfPossible survives real concurrent OS processes racing two different chains for the same epic', async (t) => {
  const { repo, base } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });
  const epicName = 'epic-18-two-chains';
  const workerPath = writeRaceWorker(base);

  const locA = path.join(base, 'race-loc-a');
  const locB = path.join(base, 'race-loc-b');
  fs.mkdirSync(locA, { recursive: true });
  fs.mkdirSync(locB, { recursive: true });

  const [resultA, resultB] = await Promise.all([
    spawnRaceWorker(workerPath, repo, epicName, 's1', locA, 60),
    spawnRaceWorker(workerPath, repo, epicName, 's3', locB, 0),
  ]);

  assert.equal(resultA.code, 0, `chain s1's claim must not crash: ${resultA.stdout}`);
  assert.equal(resultB.code, 0, `chain s3's claim must not crash: ${resultB.stdout}`);

  const state = readPlacementState(repo, epicName);
  assert.ok(state.chains.s1, "chain s1's claim must not be silently lost to a concurrent writer");
  assert.ok(state.chains.s3, "chain s3's claim must not be silently lost to a concurrent writer");
  assert.equal(path.resolve(state.chains.s1.location), path.resolve(locA));
  assert.equal(path.resolve(state.chains.s3.location), path.resolve(locB));
});

test('CLI: worktree place surfaces a decidePlacement error instead of a stack trace', (t) => {
  const { repo, epicPath } = freshRepo(t, {
    epicDirName: 'epic-18-two-chains',
    indexMd: TWO_CHAIN_INDEX,
    storyDirs: ['story-18-01-a', 'story-18-02-b', 'story-18-03-c', 'story-18-04-d', 'story-18-05-e'],
  });

  const { code, output } = runCli(repo, ['--epic', epicPath, '--story', `${epicPath}/does-not-exist`]);

  assert.equal(code, 1);
  assert.match(output, /is not listed in/);
});
