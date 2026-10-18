'use strict';

// `verify` with no story keeps its teeth (story 12-01). A repository that
// installed only the core — no epics/, no stories — gets the coverage gate and
// the diff risk on its branch's own diff, not just exit codes. These tests run
// on throwaway repos with nothing but `.coding-flow/config.json`.

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

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

// The core and nothing else: a config with one command, committed on `main`.
function coreOnlyRepo(t, prefix, commands = ['node -e "process.exit(0)"']) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands } }));
  write(dir, 'README.md', '# app\n');
  commit(dir, 'init');
  return dir;
}

function latestVerify(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
}

function verifyFiles(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runs) ? fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')) : [];
}

test('an auth file added without a test fails the gate on the branch diff, naming the file', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-auth');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  commit(dir, 'login');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /src\/auth\/login\.js/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.story, null);
  assert.equal(evidence.diffBase.scope, 'branch');
  assert.equal(evidence.coverage.ok, false);
  assert.equal(evidence.coverage.riskSource, 'diff');
  assert.deepEqual(evidence.coverage.riskPaths, ['src/auth/login.js']);
  assert.equal(evidence.coverage.tier, 'missing');
});

test('the same branch with a test added passes at evidence', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-test');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  write(dir, 'test/login.test.js', "require('node:assert').ok(require('../src/auth/login')());\n");
  commit(dir, 'login + test');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Coverage: evidence/);
  assert.equal(latestVerify(dir).coverage.tier, 'evidence');
});

test('a fresh lcov covering the added lines lifts it to verified', (t) => {
  // The writer is on `main`, so it is never part of the change it measures.
  const dir = coreOnlyRepo(t, 'storyless-lcov', ['node gen-coverage.js']);
  write(
    dir,
    'gen-coverage.js',
    [
      'const fs = require("fs"); const path = require("path");',
      'fs.mkdirSync("coverage", { recursive: true });',
      'fs.writeFileSync("coverage/lcov.info", ["TN:", "SF:" + path.resolve("src/auth/login.js"), "DA:1,1", "end_of_record", ""].join("\\n"));',
    ].join('\n'),
  );
  write(dir, '.gitignore', 'coverage/\n');
  commit(dir, 'coverage writer');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  write(dir, 'test/login.test.js', "require('../src/auth/login');\n");
  commit(dir, 'login + test');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Coverage: verified/);
  assert.equal(latestVerify(dir).coverage.tier, 'verified');
});

test('on the default branch with a clean tree: not-required, no change to evaluate', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-clean');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  const evidence = latestVerify(dir);
  assert.equal(evidence.diffBase.scope, 'working-tree');
  assert.equal(evidence.coverage.tier, 'not-required');
  assert.match(evidence.coverage.reason, /^no change to evaluate/);
  assert.doesNotMatch(evidence.coverage.reason, /not evaluated/);
});

test('a green story-less proof is reused until the branch or the base moves', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-reuse');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  write(dir, 'test/login.test.js', "require('../src/auth/login');\n");
  commit(dir, 'login + test');

  assert.equal(run(dir, ['verify']).code, 0);
  const again = run(dir, ['verify']);
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, /already proved/);
  assert.equal(verifyFiles(dir).length, 1, 'a replay writes no new evidence');

  // Moving the base is a different proof, even with HEAD's tree unchanged.
  git(dir, ['checkout', '-q', 'main']);
  write(dir, 'docs/notes.md', 'note\n');
  commit(dir, 'base moves');
  git(dir, ['checkout', '-q', 'feature']);
  git(dir, ['rebase', '-q', 'main']);

  const moved = run(dir, ['verify']);
  assert.equal(moved.code, 0, moved.output);
  assert.doesNotMatch(moved.output, /already proved/);
  assert.equal(verifyFiles(dir).length, 2);
});

test('a story proof is never reused for a story-less run, nor the reverse', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-keyed');
  const story = 'epics/epic-01-x/story-01-01-x';
  write(dir, `${story}/story.md`, '# Story\n\n## Acceptance Criteria\n\n- [x] done\n');
  commit(dir, 'story');

  // Story-less first: the story run that follows must execute, not replay it.
  assert.equal(run(dir, ['verify']).code, 0);
  const storyRun = run(dir, ['verify', '--story', story]);
  assert.doesNotMatch(storyRun.output, /already proved/);
  assert.equal(latestVerify(dir).story, story);
  assert.equal(verifyFiles(dir).length, 2);

  // And each one still replays its own proof.
  assert.match(run(dir, ['verify']).output, /already proved/);
  assert.match(run(dir, ['verify', '--story', story]).output, /already proved/);
  assert.equal(verifyFiles(dir).length, 2);
});

test('with stories on the branch and no --story, the run stays branch scope and guesses nothing', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-several');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'epics/epic-01-x/story-01-01-a/story.md', '# A\n');
  write(dir, 'epics/epic-01-x/story-01-02-b/story.md', '# B\n');
  write(dir, 'src/auth/login.js', 'module.exports = 1;\n');
  commit(dir, 'two stories and a change');
  // A lock names a story, and must still not be read as attribution.
  write(dir, '.coding-flow/active-story.json', JSON.stringify({ story: 'epics/epic-01-x/story-01-01-a' }));

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  const evidence = latestVerify(dir);
  assert.equal(evidence.story, null);
  assert.equal(evidence.diffBase.scope, 'branch');
});

test('with --story, the run is still attributed to that story', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-attributed');
  const story = 'epics/epic-01-x/story-01-01-x';
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, `${story}/story.md`, '# Story\n');
  write(dir, 'src/util.js', 'module.exports = 1;\n');
  commit(dir, 'story + change');

  run(dir, ['verify', '--story', story]);

  assert.equal(latestVerify(dir).story, story);
});

test('report counts story runs and story-less runs separately', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-report');
  const story = 'epics/epic-01-x/story-01-01-x';
  write(dir, `${story}/story.md`, '# Story\n');
  commit(dir, 'story');

  run(dir, ['verify', '--story', story]);
  run(dir, ['verify', '--no-cache']);
  run(dir, ['verify', '--no-cache']);

  const json = run(dir, ['report', '--json']);
  assert.equal(json.code, 0, json.output);
  const report = JSON.parse(json.output);
  assert.equal(report.activity.verifyRuns, 3);
  assert.equal(report.activity.verifyStoryRuns, 1);
  assert.equal(report.activity.verifyStorylessRuns, 2);

  const md = run(dir, ['report']);
  assert.match(md.output, /1 for a story, 2 without one/);
});

test('audit check keeps the latest story-less run apart from the story runs', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-audit');
  const story = 'epics/epic-01-x/story-01-01-x';
  write(dir, `${story}/story.md`, '# Story\n');
  commit(dir, 'story');

  run(dir, ['verify', '--story', story]);
  run(dir, ['verify']);

  const res = run(dir, ['audit', '--check', '--json']);
  const result = JSON.parse(res.output);
  const keys = result.latest.map((entry) => entry.story || null).sort();
  assert.deepEqual(keys, [null, story].sort());
});

test('a story-less verify never replays a proof whose coverage was skipped (land re-verify)', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-land-replay');
  git(dir, ['checkout', '-q', '-b', 'epic']);
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  commit(dir, 'landed story, no test');

  // What `worktree land`'s post-merge re-verify writes: commands green, coverage skipped.
  const lib = path.join(__dirname, '..', 'bin', 'lib');
  execFileSync(
    process.execPath,
    [
      '-e',
      `const { verifyStoryOnce, writeVerifyEvidence } = require(${JSON.stringify(path.join(lib, 'evidence.js'))});
       const e = verifyStoryOnce({ story: null, skipCoverage: true, unattended: true });
       if (!e.ok) process.exit(2);
       writeVerifyEvidence(e);`,
    ],
    { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  assert.equal(verifyFiles(dir).length, 1, 'the skipped-coverage proof is on disk');
  assert.equal(latestVerify(dir).coverage.skipped, true);

  const res = run(dir, ['verify']);

  assert.doesNotMatch(res.output, /already proved/);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN/);
});

test('a proof marked skipped is not replayed, whatever its reason says', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-skipped-flag');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/util.js', 'module.exports = 1;\n');
  write(dir, 'test/util.test.js', "require('../src/util');\n");
  commit(dir, 'util + test');
  assert.equal(run(dir, ['verify']).code, 0);

  // Reword the reason and flag it skipped: only the flag can exclude it now.
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = verifyFiles(dir)[0];
  const evidence = JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
  evidence.coverage = { ...evidence.coverage, skipped: true, reason: 'reworded' };
  fs.writeFileSync(path.join(runs, name), JSON.stringify(evidence));

  assert.doesNotMatch(run(dir, ['verify']).output, /already proved/);
});

test('a deleted test is reported on a story-less run', (t) => {
  const dir = coreOnlyRepo(t, 'storyless-deleted-test');
  write(dir, 'test/old.test.js', "require('node:assert').ok(true);\n");
  commit(dir, 'a test on main');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  fs.rmSync(path.join(dir, 'test', 'old.test.js'));
  write(dir, 'src/auth/login.js', 'module.exports = 1;\n');
  commit(dir, 'drop the test');

  run(dir, ['verify']);

  assert.deepEqual(latestVerify(dir).contrary.warnings.deletedTests, ['test/old.test.js']);
});
