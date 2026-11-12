'use strict';

// `verify --claim refactor` (story 14-04): a refactor is proven by tests that
// did not move and a fresh report showing the moved lines executed. These tests
// drive the CLI on throwaway repos so they assert what a developer would see —
// the verdict, the evidence file, and the file names in a failure.

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

function latestVerify(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
}

function verifyFiles(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runs) ? fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')) : [];
}

// A report writer that lives on main and marks every line of src/lib.js as
// executed. The refactor moves code around; the report is what says the suite
// still reaches it.
function coverageWriter(file, { upto = 40, hit = 1 } = {}) {
  return `
const fs = require("fs");
const path = require("path");
fs.mkdirSync("coverage", { recursive: true });
const lines = ["TN:", "SF:" + path.resolve(${JSON.stringify(file)})];
for (let line = 1; line <= ${upto}; line += 1) lines.push("DA:" + line + "," + ${hit});
lines.push("end_of_record", "");
fs.writeFileSync("coverage/lcov.info", lines.join("\\n"));
`;
}

const BEFORE = [
  'function add(a, b) { return a + b; }',
  'function mul(a, b) { return a * b; }',
  'module.exports = { add, mul };',
  '',
].join('\n');

// An extraction: the moved behavior is unchanged, the tests are not touched.
const AFTER = [
  'function add(a, b) { return a + b; }',
  'function mul(a, b) { return a * b; }',
  'function sum(a, b) { return add(a, b); }',
  'module.exports = { add, mul, sum };',
  '',
].join('\n');

function repo(t, prefix, {
  commands = ['node gen-coverage.js'],
  story = null,
  claim = '## Claim: refactor',
  source = 'src/lib.js',
  before = BEFORE,
  coverage = {},
  config = {},
  harness = null,
  extraTests = {},
} = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  write(dir, source, before);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n");
  for (const [file, content] of Object.entries(extraTests)) {
    write(dir, file, content);
  }
  write(dir, 'gen-coverage.js', coverageWriter(source, coverage));
  write(dir, '.gitignore', 'coverage/\n');
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands }, ...config }));
  if (harness) {
    write(dir, '.coding-flow/harness.json', JSON.stringify(harness));
  }

  if (story) {
    write(dir, `${story}/story.md`, `# Story\n\n${claim}\n`);
  }

  commit(dir, 'init');
  git(dir, ['checkout', '-q', '-b', 'feature']);

  return dir;
}

function refactor(dir, changes = {}, { source = 'src/lib.js', after = AFTER } = {}) {
  write(dir, source, after);
  for (const [file, content] of Object.entries(changes)) {
    write(dir, file, content);
  }
  commit(dir, 'refactor');
}

test('a held claim: tests untouched and the moved lines covered', (t) => {
  const dir = repo(t, 'claim-held');
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Claim held — refactor: 1 test file from the base untouched, none skipped or weakened\./);

  const evidence = latestVerify(dir);
  assert.equal(evidence.claim.ok, true);
  assert.equal(evidence.claim.kind, 'refactor');
  assert.equal(evidence.claim.unchangedTestFiles, 1);
  assert.deepEqual(evidence.claim.failures, []);
  assert.equal(evidence.claim.patch.percent, 100);
});

test('editing an assertion in an existing test fails the claim, naming the file', (t) => {
  const dir = repo(t, 'claim-test-edited');
  refactor(dir, { 'test/lib.test.js': "require('node:assert').equal(1, 2);\n" });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /Claim: refactor does NOT hold/);
  assert.match(res.output, /test\/lib\.test\.js/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.claim.ok, false);
  assert.deepEqual(evidence.claim.failures[0].files, ['test/lib.test.js']);
});

test('with no fresh coverage report the claim cannot be shown to be exercised', (t) => {
  const dir = repo(t, 'claim-no-report', { commands: ['node -e "process.exit(0)"'] });
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /cannot be shown to be exercised without a coverage report/);
  assert.equal(latestVerify(dir).claim.ok, false);
});

test('a new test file alongside the refactor does not break the claim', (t) => {
  const dir = repo(t, 'claim-new-test');
  refactor(dir, { 'test/characterization.test.js': "require('../src/lib');\n" });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Claim held — refactor/);
  assert.equal(latestVerify(dir).claim.unchangedTestFiles, 1);
});

test('a story declaring ## Claim: refactor runs the same evaluation without the flag', (t) => {
  const story = 'epics/epic-01-x/story-01-01-x';
  const dir = repo(t, 'claim-story', { story });
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Claim held — refactor/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.claim.ok, true);
  assert.equal(evidence.claim.source, 'story');
});

test('a green proof made without the claim is not replayed for it', (t) => {
  const dir = repo(t, 'claim-replay');
  refactor(dir);

  assert.equal(run(dir, ['verify']).code, 0);
  const claimed = run(dir, ['verify', '--claim', 'refactor']);

  assert.doesNotMatch(claimed.output, /already proved/);
  assert.equal(claimed.code, 0, claimed.output);
  assert.equal(latestVerify(dir).claim.kind, 'refactor');
  assert.equal(verifyFiles(dir).length, 2);

  // And each proof still replays its own.
  assert.equal(run(dir, ['verify', '--claim', 'refactor']).code, 0);
  assert.match(run(dir, ['verify']).output, /already proved/);
  assert.equal(verifyFiles(dir).length, 2);
});

test('an unknown claim fails instead of silently passing', (t) => {
  const dir = repo(t, 'claim-unknown');
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'cleanup']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /unknown claim "cleanup"/);
});

test('a bare --claim is refused', (t) => {
  const dir = repo(t, 'claim-bare');

  const res = run(dir, ['verify', '--claim']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /--claim requires a kind/);
});

test('a pure deletion has no added line to measure, so the claim is not proven', (t) => {
  const before = [
    'function add(a, b) { return a + b; }',
    'function orphan(a) { return a; }',
    'function mul(a, b) { return a * b; }',
    'module.exports = { add, mul };',
    '',
  ].join('\n');
  const after = [
    'function add(a, b) { return a + b; }',
    'function mul(a, b) { return a * b; }',
    'module.exports = { add, mul };',
    '',
  ].join('\n');
  const dir = repo(t, 'claim-deletion', { before });
  refactor(dir, {}, { after });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /no added line in src\/lib\.js is measurable/);
  assert.equal(latestVerify(dir).claim.ok, false);
});

test('a behavior file whose path contains a space is still measured', (t) => {
  const dir = repo(t, 'claim-space-path', { source: 'src/my lib.js' });
  refactor(dir, {}, { source: 'src/my lib.js' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Claim held — refactor/);
  assert.equal(latestVerify(dir).claim.patch.percent, 100);
});

test('without a merge base a refactor claim fails closed', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-claim-no-base-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'trunk']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  write(dir, 'src/lib.js', BEFORE);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n");
  write(dir, 'gen-coverage.js', coverageWriter('src/lib.js'));
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands: ['node gen-coverage.js'] } }));
  commit(dir, 'init');
  write(dir, 'src/lib.js', AFTER);
  commit(dir, 'refactor');

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /needs a diff base/);
  assert.ok(latestVerify(dir).claim.failures.some((failure) => failure.signal === 'no-base'));
});

test('renaming an existing test hides it from the claim unless the rename is checked', (t) => {
  const dir = repo(t, 'claim-rename');
  git(dir, ['mv', 'test/lib.test.js', 'test/lib-renamed.test.js']);
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /renamed: test\/lib\.test\.js → test\/lib-renamed\.test\.js/);

  const failure = latestVerify(dir).claim.failures.find((entry) => entry.signal === 'test-renamed');
  assert.deepEqual(failure.files, ['test/lib-renamed.test.js']);
});

test('renaming an existing test into a scoped-out path still fails the claim', (t) => {
  const dir = repo(t, 'claim-rename-scoped', { extraTests: { 'test/other.test.js': '// other\n' } });
  git(dir, ['mv', 'test/other.test.js', '.coding-flow/other.test.js']);
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /renamed: test\/other\.test\.js → \.coding-flow\/other\.test\.js/);
  assert.ok(latestVerify(dir).claim.failures.some((failure) => failure.signal === 'test-renamed'));
});

test('a report that omits every added line proves nothing', (t) => {
  const dir = repo(t, 'claim-report-omits-lines', { coverage: { upto: 2 } });
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /measured none of the 2 added line\(s\) in src\/lib\.js/);
  assert.equal(latestVerify(dir).claim.patch.totalLines, 0);
});

test('uncovered added lines fail the claim and name the file', (t) => {
  const dir = repo(t, 'claim-uncovered-lines', { coverage: { upto: 4, hit: 0 } });
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /only 0% of the 2 added line\(s\) are executed .*src\/lib\.js/);
});

test('the inline empty --claim form is refused instead of dropping the claim', (t) => {
  const dir = repo(t, 'claim-inline-empty');

  const res = run(dir, ['verify', '--claim=']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /--claim requires a kind/);
});

test('a claim needs at least one unchanged test file to hold behavior', (t) => {
  const dir = repo(t, 'claim-no-tests', { harness: { testGlobs: ['specs/**'] } });
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /no unchanged test file remains/);
  assert.equal(latestVerify(dir).claim.unchangedTestFiles, 0);
});

test('an uncommitted edit to an existing test fails the claim', (t) => {
  const dir = repo(t, 'claim-uncommitted-test');
  refactor(dir);
  write(dir, 'test/lib.test.js', "require('node:assert').equal(1, 2);\n");

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /test\/lib\.test\.js/);
});

test('a claim heading with a trailing note is read, not ignored', (t) => {
  const story = 'epics/epic-01-x/story-01-01-x';
  const dir = repo(t, 'claim-trailing-note', {
    story,
    claim: '## Claim: refactor (story 15-02)',
  });
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.equal(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.source, 'story');
});

test('a claim failure is printed even when no validation command was found', (t) => {
  const story = 'epics/epic-01-x/story-01-01-x';
  const dir = repo(t, 'claim-no-commands', { story, commands: [] });
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /no validation commands found/);
  assert.match(res.output, /Claim: refactor does NOT hold/);
});

// Independent review (2026-11-09): hiding a test is editing it. Each case below
// held the claim before the fix while behavior or the suite moved.

test('a policy file changed in the same diff breaks the claim', (t) => {
  const dir = repo(t, 'claim-policy');
  refactor(dir, { '.coding-flow/harness.json': JSON.stringify({ ignoredPaths: ['test/lib.test.js'] }) });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const evidence = latestVerify(dir);
  const failure = evidence.claim.failures.find((f) => f.signal === 'policy-changed');
  assert.ok(failure, JSON.stringify(evidence.claim.failures));
  assert.deepEqual(failure.files, ['.coding-flow/harness.json']);
});

test('a policy change declared in the story does not clear the claim', (t) => {
  const story = 'epics/epic-01-x/story-01-01-y';
  const dir = repo(t, 'claim-policy-declared', { story });
  refactor(dir, {
    '.coding-flow/harness.json': JSON.stringify({ minPatchCoverage: 0 }),
    [`${story}/story.md`]: '# Story\n\n## Claim: refactor\n\n## Policy Change\n\nLowered on purpose.\n',
  });

  const res = run(dir, ['verify', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  assert.ok(latestVerify(dir).claim.failures.some((f) => f.signal === 'policy-changed'));
});

test('a test-runner config changed in the same diff breaks the claim', (t) => {
  const dir = repo(t, 'claim-runner-config');
  refactor(dir, { 'tests.config.js': "module.exports = { ignore: ['lib.test.js'] };\n" });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'not-code');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['tests.config.js']);
  assert.match(res.output, /tests\.config\.js/);
});

test('a diff with no code file has nothing for the claim to prove', (t) => {
  const dir = repo(t, 'claim-no-code');
  write(dir, 'docs/notes.md', '# Notes\n');
  commit(dir, 'docs');

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  assert.ok(latestVerify(dir).claim.failures.some((f) => f.signal === 'no-code'));
});

test('prose next to the refactor does not break the claim', (t) => {
  const dir = repo(t, 'claim-prose');
  refactor(dir, { 'docs/notes.md': '# Notes\n', 'README.md': '# Readme\n' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.ok, true);
});

test('a coverage report older than the run is not proof', (t) => {
  const dir = repo(t, 'claim-stale-report', { commands: ['node -e "process.exit(0)"'] });
  refactor(dir);
  // Written by an earlier run, before this verify started: the commands below
  // write no report of their own.
  execFileSync(process.execPath, ['gen-coverage.js'], { cwd: dir });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'coverage');
  assert.ok(failure);
  assert.match(failure.detail, /cannot be shown to be exercised without a coverage report/);
});

test('deleting an existing test breaks the claim', (t) => {
  const dir = repo(t, 'claim-deleted-test', { extraTests: { 'test/other.test.js': "require('../src/lib');\n" } });
  write(dir, 'src/lib.js', AFTER);
  fs.unlinkSync(path.join(dir, 'test', 'other.test.js'));
  commit(dir, 'refactor');

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'test-changed');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['test/other.test.js']);
});

test('in a subdirectory install an edited existing test still breaks the claim', (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-claim-subdir-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'pkg');

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'test']);
  write(dir, 'src/lib.js', BEFORE);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n");
  write(dir, 'gen-coverage.js', coverageWriter('src/lib.js'));
  write(dir, '.gitignore', 'coverage/\n');
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands: ['node gen-coverage.js'] } }));
  commit(root, 'init');
  git(root, ['checkout', '-q', '-b', 'feature']);
  write(dir, 'src/lib.js', AFTER);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// edited\n");
  commit(root, 'refactor');

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'test-changed');
  assert.ok(failure, JSON.stringify(latestVerify(dir).claim));
  assert.deepEqual(failure.files, ['test/lib.test.js']);
});

test('an untracked test directory does not count as unchanged tests', (t) => {
  const dir = repo(t, 'claim-untracked-tests');
  refactor(dir);
  fs.rmSync(path.join(dir, 'test'), { recursive: true });
  commit(dir, 'drop the only test');
  write(dir, 'vendor/x/test/a.test.js', '');
  write(dir, '.gitignore', 'coverage/\nvendor/\n');
  commit(dir, 'ignore vendor');

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const signals = latestVerify(dir).claim.failures.map((f) => f.signal);
  assert.ok(signals.includes('no-unchanged-tests'), signals.join(', '));
});

// Second independent review (2026-11-09): the bypasses around the first fix.

test('policyGlobs emptied in the same diff does not switch the policy check off', (t) => {
  const dir = repo(t, 'claim-policy-globs');
  refactor(dir, {
    '.coding-flow/harness.json': JSON.stringify({ policyGlobs: [], ignoredPaths: ['test/lib.test.js'] }),
  });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'policy-changed');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['.coding-flow/harness.json']);
});

test('a package.json test-runner key changed in the same diff breaks the claim', (t) => {
  const dir = repo(t, 'claim-package-json', { extraTests: { 'package.json': '{ "name": "x" }\n' } });
  refactor(dir, { 'package.json': '{ "name": "x", "jest": { "testPathIgnorePatterns": ["lib"] } }\n' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'coverage');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['package.json']);
  assert.match(failure.detail, /no coverage report measures/);
});

test('a command dropped from the plan breaks the claim', (t) => {
  const story = 'epics/epic-01-x/story-01-01-y';
  const plan = (commands) => `# Plan\n\n## Commands\n\n\`\`\`bash\n${commands.join('\n')}\n\`\`\`\n`;
  const dir = repo(t, 'claim-plan-commands', {
    story,
    config: { validation: undefined },
    extraTests: {
      'package.json': JSON.stringify({ name: 'x', scripts: { cov: 'node gen-coverage.js', other: 'node -e 0' } }),
      [`${story}/plan.md`]: plan(['npm run cov', 'npm run other']),
    },
  });
  refactor(dir, { [`${story}/plan.md`]: plan(['npm run cov']) });

  const res = run(dir, ['verify', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  const evidence = latestVerify(dir);
  assert.equal(evidence.commandSource, 'plan.md');
  const failure = evidence.claim.failures.find((f) => f.signal === 'commands-changed');
  assert.ok(failure, JSON.stringify(evidence.claim.failures));
  assert.match(failure.detail, /npm run other/);
});

test('an edited existing test with a non-ASCII name breaks the claim', (t) => {
  const dir = repo(t, 'claim-non-ascii', { extraTests: { 'test/é.test.js': "require('../src/lib');\n" } });
  refactor(dir, { 'test/é.test.js': '// emptied\n' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'test-changed');
  assert.ok(failure, JSON.stringify(latestVerify(dir).claim.failures));
  assert.deepEqual(failure.files, ['test/é.test.js']);
});

test('an untracked new test with .only breaks the claim', (t) => {
  const dir = repo(t, 'claim-untracked-only');
  refactor(dir);
  write(dir, 'test/aaa.test.js', "describe.only('focus', () => {});\n");

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'weakened-test');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['test/aaa.test.js']);
});

test('a non-prose file under docs/ is not prose', (t) => {
  const dir = repo(t, 'claim-docs-code');
  refactor(dir, { 'docs/conf.py': 'extensions = []\n' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'not-code');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['docs/conf.py']);
});

test('the PR evidence block says when the claim held', () => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock({
    ok: true,
    commandsOk: true,
    commandsFound: 1,
    results: [],
    claim: { kind: 'refactor', ok: true, unchangedTestFiles: 2, failures: [] },
  });

  assert.match(block, /\*\*Claim held \(refactor\):\*\* 2 test file\(s\) from the base untouched/);
});

// Third independent review (2026-11-09).

test('a test-runner config with a code extension breaks the claim', (t) => {
  const dir = repo(t, 'claim-mocharc', { extraTests: { '.mocharc.js': "module.exports = { spec: ['test/**'] };\n" } });
  refactor(dir, { '.mocharc.js': "module.exports = { spec: ['test/other/**'] };\n" });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'policy-changed');
  assert.ok(failure, JSON.stringify(latestVerify(dir).claim.failures));
  assert.deepEqual(failure.files, ['.mocharc.js']);
});

test('a changed code file no test loaded breaks the claim, even under the tolerance', (t) => {
  const dir = repo(t, 'claim-not-loaded', { extraTests: { 'src/other.js': 'module.exports = 1;\n' } });
  // Many covered added lines in src/lib.js, one in a file the report never saw:
  // the percentage stays above 80, the file was still never run.
  const many = Array.from({ length: 10 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n');
  refactor(dir, { 'src/other.js': 'module.exports = 2;\n' }, { after: `${AFTER}${many}\n` });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'coverage');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['src/other.js']);
  assert.match(failure.detail, /not loaded by any test/);
});

test('deleting the plan\'s Commands section does not drop its commands from the claim', (t) => {
  const story = 'epics/epic-01-x/story-01-01-y';
  const dir = repo(t, 'claim-plan-section', {
    story,
    config: { validation: undefined },
    extraTests: {
      'package.json': JSON.stringify({ name: 'x', scripts: { test: 'node gen-coverage.js', other: 'node -e 0' } }),
      [`${story}/plan.md`]: '# Plan\n\n## Commands\n\n```bash\nnpm test\nnpm run other\n```\n',
    },
  });
  refactor(dir, { [`${story}/plan.md`]: '# Plan\n\nNo commands any more.\n' });

  const res = run(dir, ['verify', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  const evidence = latestVerify(dir);
  assert.notEqual(evidence.commandSource, 'plan.md');
  const failure = evidence.claim.failures.find((f) => f.signal === 'commands-changed');
  assert.ok(failure, JSON.stringify(evidence.claim.failures));
  assert.match(failure.detail, /npm run other/);
});

test('a diff base past a test edit on the same branch breaks the claim', (t) => {
  const dir = repo(t, 'claim-narrow-base');
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// expectation updated\n");
  commit(dir, 'tests: update expectation');
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor', '--base', 'HEAD~1']);

  assert.notEqual(res.code, 0, res.output);
  const signals = latestVerify(dir).claim.failures.map((f) => f.signal);
  assert.ok(signals.includes('base-not-shared'), signals.join(', '));
});

// Fourth independent review (2026-11-09).

test('a line removed from a file no report measures breaks the claim', (t) => {
  const pkg = (scripts) => `${JSON.stringify({ name: 'x', scripts }, null, 2)}\n`;
  const dir = repo(t, 'claim-posttest', {
    extraTests: {
      'package.json': pkg({ test: 'node gen-coverage.js', posttest: 'node --test test/', lint: 'node -e 0' }),
    },
  });
  // A pure deletion: the line between two others goes, nothing is added.
  refactor(dir, { 'package.json': pkg({ test: 'node gen-coverage.js', lint: 'node -e 0' }) });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'coverage');
  assert.ok(failure, JSON.stringify(latestVerify(dir).claim.failures));
  assert.deepEqual(failure.files, ['package.json']);
});

test('a Makefile recipe line removed breaks the claim', (t) => {
  const dir = repo(t, 'claim-makefile', {
    extraTests: { Makefile: 'test:\n\tnode gen-coverage.js\n\tnode --test test/\n' },
  });
  refactor(dir, { Makefile: 'test:\n\tnode gen-coverage.js\n' });

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'coverage');
  assert.ok(failure);
  assert.deepEqual(failure.files, ['Makefile']);
});

test('the pushed copy of this branch does not make a narrowed base shared', (t) => {
  const dir = repo(t, 'claim-pushed-base');
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-claim-remote-')));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '-q', '--bare']);
  git(dir, ['remote', 'add', 'origin', remote]);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// expectation updated\n");
  commit(dir, 'tests: update expectation');
  refactor(dir);
  git(dir, ['push', '-q', '-u', 'origin', 'feature']);

  const res = run(dir, ['verify', '--claim', 'refactor', '--base', 'HEAD~1']);

  assert.notEqual(res.code, 0, res.output);
  const signals = latestVerify(dir).claim.failures.map((f) => f.signal);
  assert.ok(signals.includes('base-not-shared'), signals.join(', '));
});

// Fifth independent review (2026-11-09): a ref sitting exactly at the narrowed
// base — the upstream pushed after the test commit, a backup branch — holds it.
test('a --base narrowed to an upstream pushed after the test edit breaks the claim', (t) => {
  const dir = repo(t, 'claim-pushed-early');
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-claim-remote-')));
  t.after(() => fs.rmSync(remote, { recursive: true, force: true }));
  git(remote, ['init', '-q', '--bare']);
  git(dir, ['remote', 'add', 'origin', remote]);
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// expectation updated\n");
  commit(dir, 'tests: update expectation');
  git(dir, ['push', '-q', '-u', 'origin', 'feature']);
  git(dir, ['branch', 'backup']);
  refactor(dir);

  for (const base of ['HEAD~1', 'origin/feature', 'backup']) {
    const res = run(dir, ['verify', '--claim', 'refactor', '--base', base]);

    assert.notEqual(res.code, 0, `${base}: ${res.output}`);
    const signals = latestVerify(dir).claim.failures.map((f) => f.signal);
    assert.ok(signals.includes('base-not-shared'), `${base}: ${signals.join(', ')}`);
  }
});

test('a --base that widens the diff is accepted', (t) => {
  const dir = repo(t, 'claim-wide-base');
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor', '--base', 'main']);

  assert.equal(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.ok, true);
});

// Review of 2026-11-09 (after the fifth round): the residual risks it named.

test('a recorded fork point past a test edit breaks the claim like a narrowing --base', (t) => {
  const dir = repo(t, 'claim-fork-point');
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// expectation updated\n");
  commit(dir, 'tests: update expectation');
  git(dir, ['branch', 'backup']);
  git(dir, ['config', 'branch.feature.codingFlowBase', 'backup']);
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.notEqual(res.code, 0, res.output);
  const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'base-not-shared');
  assert.ok(failure, JSON.stringify(latestVerify(dir).claim.failures));
  assert.match(failure.detail, /fork point \(backup\)/);
  assert.match(failure.detail, /--base main/);
});

test('a fork point at the branch the story started from still holds the claim', (t) => {
  const dir = repo(t, 'claim-fork-point-ok');
  git(dir, ['config', 'branch.feature.codingFlowBase', 'main']);
  refactor(dir);

  const res = run(dir, ['verify', '--claim', 'refactor']);

  assert.equal(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.ok, true);
});

test('a Claim section that opens with prose declares no claim', (t) => {
  const story = 'epics/epic-01-x/story-01-01-prose';
  const dir = repo(t, 'claim-prose-section', { story, claim: '## Claim\n\nWe claim this keeps the API stable.' });
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.equal(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim, undefined);
});

test('a Claim section opening with the kind and a note is read', (t) => {
  const story = 'epics/epic-01-x/story-01-01-noted';
  const dir = repo(t, 'claim-noted-section', { story, claim: '## Claim\n\nrefactor — extract sum from add.' });
  write(dir, 'test/lib.test.js', "require('../src/lib');\n// expectation updated\n");
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.kind, 'refactor');
});

test('a Claim section with a misspelt kind alone is refused, not dropped', (t) => {
  const story = 'epics/epic-01-x/story-01-01-typo';
  const dir = repo(t, 'claim-typo-section', { story, claim: '## Claim\n\nrefactr' });
  refactor(dir);

  const res = run(dir, ['verify', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  assert.equal(latestVerify(dir).claim.failures[0].signal, 'unknown-claim');
});

test('a new test that names the coverage report breaks the claim', (t) => {
  for (const tracked of [true, false]) {
    const dir = repo(t, `claim-forged-report-${tracked}`);
    write(dir, 'test/sum.test.js', "require('fs').writeFileSync('coverage/lcov.info', '');\n");
    if (tracked) {
      refactor(dir);
    } else {
      write(dir, 'src/lib.js', AFTER);
    }

    const res = run(dir, ['verify', '--claim', 'refactor']);

    assert.notEqual(res.code, 0, `${tracked}: ${res.output}`);
    const failure = latestVerify(dir).claim.failures.find((f) => f.signal === 'test-names-report');
    assert.ok(failure, `${tracked}: ${JSON.stringify(latestVerify(dir).claim.failures)}`);
    assert.deepEqual(failure.files, ['test/sum.test.js']);
  }
});

test('run names a failed claim even when the coverage gate also blocks', (t) => {
  const story = 'epics/epic-01-x/story-01-01-both';
  const dir = repo(t, 'claim-run-both', { story, source: 'src/auth/session.js', coverage: { hit: 0 } });
  write(dir, 'test/lib.test.js', "require('../src/auth/session');\n// expectation updated\n");
  refactor(dir, {}, { source: 'src/auth/session.js' });

  const res = run(dir, ['run', '--story', story]);

  assert.notEqual(res.code, 0, res.output);
  assert.match(res.output, /\[no proof\]/);
  assert.match(res.output, /refactor claim: 1 existing test file\(s\) changed: test\/lib\.test\.js/);
});

// Both promises on one verify (14-03 with 14-04): each one alone can fail the
// run, and a proof made without one cannot stand in for a run that asks for both.
const RED_AT_BASE = { version: 1, redAtBase: { command: 'node --test --test-reporter=tap {files}' } };

function runBoth(dir, args) {
  const env = { ...process.env };
  // The fixture's own `node --test` would skip its files inside the outer suite.
  delete env.NODE_TEST_CONTEXT;

  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('a held claim does not carry a fix that was never red at base', (t) => {
  const dir = repo(t, 'claim-and-red', { harness: RED_AT_BASE });
  refactor(dir);

  const res = runBoth(dir, ['verify', '--claim', 'refactor', '--red-at-base']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /the fix is not proven/);

  const evidence = latestVerify(dir);
  assert.equal(evidence.claim.ok, true);
  assert.equal(evidence.redAtBase.ok, false);
  assert.equal(evidence.ok, false);
});

test('a red at base does not carry a refactor claim that fails, nor reuse a proof made without it', (t) => {
  const buggy = 'function add(a, b) { return a - b; }\nmodule.exports = { add };\n';
  const dir = repo(t, 'red-and-claim', { harness: RED_AT_BASE, before: buggy, commands: ['node -e "process.exit(0)"'] });
  const addingTest = "const test = require('node:test');\nconst assert = require('node:assert');\n" +
    "const { add } = require('../src/lib');\ntest('adds', () => assert.equal(add(2, 3), 5));\n";
  refactor(dir, { 'test/add.test.js': addingTest }, { after: 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n' });

  const alone = runBoth(dir, ['verify', '--red-at-base', '--json']);
  assert.equal(alone.code, 0, alone.output);
  assert.equal(JSON.parse(alone.output).redAtBase.ok, true);

  const res = runBoth(dir, ['verify', '--claim', 'refactor', '--red-at-base']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /the refactor claim does not hold/);
  assert.doesNotMatch(res.output, /reused/i);

  const evidence = latestVerify(dir);
  assert.equal(evidence.reused, undefined);
  assert.equal(evidence.redAtBase.ok, true);
  assert.equal(evidence.claim.ok, false);
  assert.equal(evidence.ok, false);
});
