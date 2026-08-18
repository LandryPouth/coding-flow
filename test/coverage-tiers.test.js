'use strict';

// The gate has three rungs and always had. Until now only the JSON carried them,
// so "1 test file(s) changed" and "92% of the added lines are executed" reached
// the reader in the same voice — one is a measurement, the other is a proxy for
// one. These tests pin that the difference is stated: in the terminal, in the
// evidence, in the PR body, and in the batch report.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { coverageTier } = require('../bin/lib/coverage');
const { buildEvidenceBlock } = require('../bin/lib/ship');

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

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Stand-in for `vitest --coverage`: writes the artifact a real tool writes, so
// the tiers are exercised without paying for a suite on every run.
function coverageWriter({ covered, uncovered }) {
  const spec = JSON.stringify({ covered, uncovered });
  return `
const fs = require("fs");
const path = require("path");
const spec = ${spec};
fs.mkdirSync("coverage", { recursive: true });
const lines = ["TN:", "SF:" + path.resolve("src/auth.js")];
for (const line of spec.covered) lines.push("DA:" + line + ",1");
for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
lines.push("end_of_record", "");
fs.writeFileSync("coverage/lcov.info", lines.join("\\n"));
`;
}

function repo(t, prefix, { covered = [], uncovered = [], writeReport = true } = {}) {
  const dir = project(t, prefix);
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  fs.writeFileSync(path.join(dir, 'gen-coverage.js'), coverageWriter({ covered, uncovered }));

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = {
    commands: writeReport ? ['node gen-coverage.js'] : ['node -e "process.exit(0)"'],
    quality: [],
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/auth']);

  return dir;
}

function writeAuth(dir, { withTest = false } = {}) {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'auth.js'),
    Array.from({ length: 10 }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n',
  );

  if (withTest) {
    fs.writeFileSync(path.join(dir, 'src', 'auth.test.js'), "require('node:test');\n");
  }

  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'auth']);
}

// --- the naming itself ------------------------------------------------------

test('every verdict lands on exactly one named rung', () => {
  const cases = [
    [{ required: false, ok: true }, 'not-required'],
    [{ required: true, ok: true, mode: 'none' }, 'not-required'],
    [{ required: true, ok: true, mode: 'diff-lines' }, 'verified'],
    [{ required: true, ok: true, mode: 'test-file' }, 'evidence'],
    [{ required: true, ok: true, mode: 'diff-lines', exemption: 'why' }, 'exempted'],
    [{ required: true, ok: true, mode: 'test-file', exemption: 'why' }, 'exempted'],
    [{ required: true, ok: false, mode: 'diff-lines' }, 'missing'],
    [{ required: true, ok: false, mode: 'test-file' }, 'missing'],
  ];

  for (const [coverage, expected] of cases) {
    assert.equal(coverageTier(coverage), expected, JSON.stringify(coverage));
  }
});

test('an absent coverage block is not silently promoted', () => {
  // Evidence written before the gate existed has no coverage at all. Reading
  // that back as anything but "nothing was required" would invent a claim.
  assert.equal(coverageTier(null), 'not-required');
  assert.equal(coverageTier(undefined), 'not-required');
});

test('a declared reason outranks the measurement that failed', () => {
  // The exemption is what carried the change; saying "verified" because lines
  // happened to be measured on the way there would name the wrong thing.
  const coverage = { required: true, ok: true, mode: 'diff-lines', exemption: 'vendor bump', patch: { ok: false } };
  assert.equal(coverageTier(coverage), 'exempted');
});

// --- what the reader is told ------------------------------------------------

test('a measured pass is called verified, and the evidence says so', (t) => {
  const dir = repo(t, 'tier-verified', { covered: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir);

  const res = run(dir, ['verify']);
  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Coverage: verified — 100% of the 10 added line\(s\)/);

  const json = run(dir, ['verify', '--json', '--no-cache']);
  assert.equal(JSON.parse(json.output).coverage.tier, 'verified');
});

test('a pass carried by a moved test file is called evidence, not verified', (t) => {
  const dir = repo(t, 'tier-evidence', { writeReport: false });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Coverage: evidence —/);
  assert.doesNotMatch(
    res.output,
    /Coverage: verified/,
    'the weaker rung never borrows the stronger word',
  );
});

test('the evidence rung tells you how to earn the stronger one', (t) => {
  // A gate that grades you without saying how to improve is a gate you resent.
  const dir = repo(t, 'tier-evidence-hint', { writeReport: false });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify']);

  assert.match(res.output, /no fresh coverage report was found/);
  assert.match(res.output, /lcov\.info or coverage-final\.json/);
});

test('the hint is absent once the change is actually measured', (t) => {
  const dir = repo(t, 'tier-nohint', { covered: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir);

  const res = run(dir, ['verify']);
  assert.doesNotMatch(res.output, /no fresh coverage report/);
});

test('a blocked run is called missing in the evidence', (t) => {
  const dir = repo(t, 'tier-missing', { covered: [1], uncovered: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.equal(coverage.tier, 'missing');
});

// --- the claim travels ------------------------------------------------------

test('the batch report says which pass was measured and which was not', (t) => {
  // Ten stories that all read "pass" hide the difference. Over a batch, that
  // difference is most of what the report is for.
  const dir = repo(t, 'tier-run', { writeReport: false });
  const storyDir = path.join(dir, 'epics', 'epic-01', 'story-01-01-auth');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Auth\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '# Plan\n');
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['run', '--story', 'epics/epic-01/story-01-01-auth']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /\[pass\].*— coverage: evidence/, res.output);
});

test('the PR body names the rung instead of ticking every pass', () => {
  // The regression this pins: "✅ 1 test file(s) changed with this story" told a
  // reviewer the change was covered, when all anyone knew was that a file moved.
  const block = buildEvidenceBlock({
    generatedAt: '2026-08-18T10:00:00.000Z',
    ok: true,
    commandsFound: 1,
    results: [{ command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationMs: 10 }],
    coverage: {
      required: true,
      ok: true,
      mode: 'test-file',
      tier: 'evidence',
      reason: '1 test file(s) changed alongside 1 behavior file(s)',
      testFiles: ['src/auth.test.js'],
    },
  });

  assert.match(block, /\*\*Coverage:\*\* 🟡 evidence/, block);
  assert.doesNotMatch(block, /✅ 1 test file/);
});

test('a measured change reaches the PR body as verified', () => {
  const block = buildEvidenceBlock({
    generatedAt: '2026-08-18T10:00:00.000Z',
    ok: true,
    commandsFound: 1,
    results: [{ command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationMs: 10 }],
    coverage: {
      required: true,
      ok: true,
      mode: 'diff-lines',
      tier: 'verified',
      reason: '100% of the 10 added line(s) are executed by the suite (min 80%)',
      testFiles: [],
    },
  });

  assert.match(block, /\*\*Coverage:\*\* ✅ verified/, block);
});

test('evidence written before the tier existed is still named correctly', () => {
  // A *-verify.json from an older release carries mode but no tier. `ship` reads
  // those files back months later; deriving the rung keeps them readable.
  const block = buildEvidenceBlock({
    generatedAt: '2026-06-01T10:00:00.000Z',
    ok: true,
    commandsFound: 1,
    results: [{ command: 'npm test', ok: true, exitCode: 0, timedOut: false, durationMs: 10 }],
    coverage: {
      required: true,
      ok: true,
      mode: 'test-file',
      reason: '2 test file(s) changed alongside 1 behavior file(s)',
      testFiles: ['a.test.js', 'b.test.js'],
    },
  });

  assert.match(block, /\*\*Coverage:\*\* 🟡 evidence/, block);
});
