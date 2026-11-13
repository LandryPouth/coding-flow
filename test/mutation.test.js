'use strict';

// Story 15-05: the mutation probe, opt-in, high-risk diffs only. Every test
// drives a throwaway repository through `ai-flow verify`: the probe runs in a
// throwaway worktree, and what is asserted is the evidence, the exit code, and
// that the user's tree and worktrees are as they were.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function scratch(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function commit(dir, message) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message]);
}

function write(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}

function harness(dir, settings) {
  write(dir, '.coding-flow/harness.json', JSON.stringify({ version: 1, ...settings }, null, 2));
}

const STORY = 'epics/epic-01-limits/story-01-01-limit-attempts';

// A base on `main` with a story and a placeholder, then a branch adding `file`:
// `attempts < max`, with a test that never tries `attempts === max`, so the
// `<` → `<=` mutant survives.
const LIMIT = 'function allowed(attempts, max) {\n  return attempts < max;\n}\n\nmodule.exports = { allowed };\n';

function project(t, prefix, { file = 'src/auth/limit.js', story = '', body = LIMIT } = {}) {
  const dir = scratch(t, prefix);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'mutation@example.com']);
  git(dir, ['config', 'user.name', 'Mutation']);
  write(dir, '.gitignore', '.coding-flow/\n');
  write(dir, 'package.json', JSON.stringify({ name: 'mutation-fixture', scripts: { test: 'node --test' } }, null, 2));
  write(dir, `${STORY}/story.md`, `# Story 01-01 — Limit attempts\n\n## Acceptance Criteria\n\n- [x] Attempts are limited.\n${story}`);
  write(dir, 'README.md', 'fixture\n');
  commit(dir, 'base');
  git(dir, ['checkout', '-q', '-b', 'feat']);
  write(dir, file, body);
  write(dir, 'test/limit.test.js', [
    "const test = require('node:test');",
    "const assert = require('node:assert');",
    `const { allowed } = require('../${file}');`,
    '',
    "test('far below and far above the limit', () => {",
    '  assert.equal(allowed(1, 3), true);',
    '  assert.equal(allowed(5, 3), false);',
    '});',
    '',
  ].join('\n'));
  commit(dir, 'feat: limit attempts');
  return dir;
}

function run(dir, args) {
  const env = { ...process.env, CI: '', AI_FLOW_FORCE_TTY: '1', NODE_ENV: 'test' };
  delete env.NODE_TEST_CONTEXT;

  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function verify(dir, extra = [], { cache = false } = {}) {
  const { code, output } = run(dir, ['verify', '--json', ...(cache ? [] : ['--no-cache']), ...extra]);
  return { code, output, evidence: JSON.parse(output) };
}

function worktreeCount(dir) {
  return git(dir, ['worktree', 'list', '--porcelain']).split(/\n\n+/).filter(Boolean).length;
}

test('a high-risk diff whose test misses a < → <= change lists the survivor with its file and line', (t) => {
  const dir = project(t, 'mutation-survivor');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.ok(evidence.mutation, output);
  assert.equal(evidence.mutation.ran, true, output);
  assert.deepStrictEqual(evidence.mutation.survived, [{ file: 'src/auth/limit.js', line: 2, operator: '< → <=' }]);
  assert.equal(evidence.mutation.killed, 0);
  assert.equal(typeof evidence.mutation.durationMs, 'number');
  // Not strict: a contrary signal is a warning, the verdict is not lowered by it.
  assert.equal(evidence.mutation.ok, true);

  const text = run(dir, ['verify', '--no-cache']).output;
  assert.match(text, /src\/auth\/limit\.js:2/);
});

test('a medium or low diff with no claim runs no mutation', (t) => {
  const dir = project(t, 'mutation-quiet', { file: 'src/util/limit.js' });
  const marker = path.join(scratch(t, 'mutation-marker'), 'ran');
  harness(dir, { mutation: { command: `touch '${marker}' && node --test {files}`, maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(fs.existsSync(marker), false, 'the mutation command never ran');
  assert.ok(!evidence.mutation || evidence.mutation.ran === false, output);
});

test('a refactor claim runs the probe on a medium diff, guarded by the tests already there', (t) => {
  const dir = project(t, 'mutation-refactor', { file: 'src/util/limit.js' });
  git(dir, ['checkout', '-q', '-b', 'refactor']);
  write(dir, 'src/util/limit.js', 'function allowed(attempts, max) {\n  return max > attempts;\n}\n\nmodule.exports = { allowed };\n');
  commit(dir, 'refactor: read the limit first');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir, ['--claim', 'refactor', '--base', 'feat']);

  assert.equal(evidence.mutation.ran, true, output);
  assert.deepStrictEqual(evidence.mutation.survived, [{ file: 'src/util/limit.js', line: 2, operator: '> → >=' }]);
});

test('no mutation config, no mutation, whatever the risk', (t) => {
  const dir = project(t, 'mutation-off');

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation, undefined, output);
});

test('the same tree twice samples the same sites', (t) => {
  const dir = project(t, 'mutation-seed');
  write(dir, 'src/auth/rules.js', [
    'function rules(a, b, c, d) {',
    '  const x = a === b && c < d;',
    '  const y = a !== c || b >= d;',
    '  return x === true || y === false;',
    '}',
    '',
    'module.exports = { rules };',
    '',
  ].join('\n'));
  commit(dir, 'feat: rules');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 3 } });

  const first = verify(dir).evidence.mutation;
  const second = verify(dir).evidence.mutation;
  const sites = (m) => m.mutants.map(({ file, line, operator }) => `${file}:${line} ${operator}`);

  assert.equal(first.mutants.length, 3);
  assert.deepStrictEqual(sites(second), sites(first));
  assert.equal(second.seed, first.seed);
});

test('a Mutation Exemption naming the survivor excuses the signal and keeps the reason', (t) => {
  const reason = 'src/auth/limit.js:2 — the limit itself is pinned by the rate-limit contract test elsewhere.';
  const strict = { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } };

  const bare = project(t, 'mutation-strict');
  harness(bare, strict);
  const failed = verify(bare, ['--story', STORY]);
  assert.notEqual(failed.code, 0, failed.output);
  assert.equal(failed.evidence.ok, false);
  assert.equal(failed.evidence.mutation.ok, false);
  assert.deepStrictEqual(failed.evidence.mutation.unexcused, ['src/auth/limit.js:2']);

  const excused = project(t, 'mutation-exempt', { story: `\n## Mutation Exemption\n\n${reason}\n` });
  harness(excused, strict);
  const held = verify(excused, ['--story', STORY]);
  assert.equal(held.evidence.mutation.ok, true, held.output);
  assert.deepStrictEqual(held.evidence.mutation.unexcused, []);
  assert.equal(held.evidence.mutation.exemption, reason);
});

test('an exemption naming another line does not excuse the survivor', (t) => {
  const dir = project(t, 'mutation-other-line', { story: '\n## Mutation Exemption\n\nsrc/auth/limit.js:20 is equivalent.\n' });
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { evidence } = verify(dir, ['--story', STORY]);

  assert.equal(evidence.mutation.ok, false);
  assert.deepStrictEqual(evidence.mutation.unexcused, ['src/auth/limit.js:2']);
});

test('a probe that cannot run is reported as not examined, never as killed', (t) => {
  const dir = project(t, 'mutation-broken');
  harness(dir, { mutation: { command: 'exit 1 # {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /does not pass/);
  assert.equal(evidence.mutation.survived, undefined);
});

test('no worktree remains after a run, and the user tree token is unchanged', (t) => {
  const dir = project(t, 'mutation-clean');
  // A tracked edit: with an untracked file, verify records no tree token at all.
  write(dir, 'README.md', 'uncommitted work\n');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });
  const tokenBefore = verify(dir).evidence.provenance;
  const statusBefore = git(dir, ['status', '--porcelain']);

  const { evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true);
  assert.equal(worktreeCount(dir), 1);
  assert.equal(git(dir, ['status', '--porcelain']), statusBefore);
  assert.equal(git(dir, ['stash', 'list']), '');
  assert.equal(fs.readFileSync(path.join(dir, 'src/auth/limit.js'), 'utf8').includes('attempts < max'), true);
  assert.notEqual(tokenBefore.git.treeToken, undefined);
  assert.equal(evidence.provenance.git.treeToken, tokenBefore.git.treeToken);

  // An untracked file too: verify records no tree token then (a known defect
  // outside this story), so what is asserted is what git shows.
  write(dir, 'notes.txt', 'untracked work\n');
  const statusUntracked = git(dir, ['status', '--porcelain']);
  const again = verify(dir).evidence;
  assert.equal(again.mutation.ran, true);
  assert.equal(git(dir, ['status', '--porcelain']), statusUntracked);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'untracked work\n');
  assert.equal(worktreeCount(dir), 1);
});

test('uncommitted edits to the diff are not examined, a failure under strict', (t) => {
  const dir = project(t, 'mutation-dirty');
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });
  write(dir, 'src/auth/limit.js', 'function allowed(attempts, max) {\n  return attempts < max && max > 0;\n}\n\nmodule.exports = { allowed };\n');

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /uncommitted changes in src\/auth\/limit\.js/);
  assert.equal(evidence.ok, false);
});

test('a green run whose probe did not answer is never replayed once the same content is committed', (t) => {
  const dir = project(t, 'mutation-replay');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });
  write(dir, 'src/auth/limit.js', 'function allowed(attempts, max) {\n  return attempts < max && max > 0;\n}\n\nmodule.exports = { allowed };\n');

  const dirty = verify(dir, [], { cache: true });
  assert.equal(dirty.evidence.ok, true, dirty.output);
  assert.equal(dirty.evidence.mutation.ran, false);

  commit(dir, 'feat: the limit must be positive');
  const committed = verify(dir, [], { cache: true });
  assert.notEqual(committed.evidence.reused, true, 'the not-examined answer is not replayed');
  assert.equal(committed.evidence.mutation.ran, true, committed.output);
  assert.ok(committed.evidence.mutation.survived.length > 0);
});

test('a high-risk diff with no site in its JS/TS lines is not examined, never ok under strict', (t) => {
  const dir = project(t, 'mutation-no-site', { body: 'function allowed(attempts, max) {\n  return Boolean(Math.min(1, Math.max(0, max - attempts)));\n}\n\nmodule.exports = { allowed };\n' });
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /no site in the diff's committed JS\/TS lines/);
  assert.equal(evidence.mutation.ok, false);
  assert.equal(evidence.ok, false);
});

test('an exemption inside an HTML comment excuses nothing', (t) => {
  const dir = project(t, 'mutation-commented', { story: '\n## Mutation Exemption\n\n<!-- src/auth/limit.js:2 is equivalent -->\n<!-- unclosed src/auth/limit.js:2\n' });
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { evidence } = verify(dir, ['--story', STORY]);

  assert.equal(evidence.mutation.ok, false);
  assert.deepStrictEqual(evidence.mutation.unexcused, ['src/auth/limit.js:2']);
  assert.equal(evidence.mutation.exemption, undefined);
});

test('the probe stops at its budget, says so, and leaves no worktree', (t) => {
  const dir = project(t, 'mutation-budget');
  harness(dir, { mutation: { command: 'sleep 5; node --test {files}', maxMutants: 5, timeoutMs: 1500 } });
  const started = Date.now();

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /budget of 1\.5s \(mutation\.timeoutMs\) ran out/);
  assert.ok(Date.now() - started < 60000, 'the budget bounded the run');
  assert.equal(worktreeCount(dir), 1);
});

test('the ship PR body names the probe: survivors, or why it did not answer', () => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = (mutation) => buildEvidenceBlock({ ok: true, commandsOk: true, results: [], mutation });

  assert.match(block({ ran: true, ok: true, killed: 3, unexcused: ['src/auth/limit.js:2'] }), /\*\*Mutation:\*\* ⚠️ 3 killed, 1 survived: src\/auth\/limit\.js:2/);
  assert.match(block({ ran: false, ok: false, reason: 'not examined — no site' }), /\*\*Mutation:\*\* ❌ not examined — no site/);
  assert.match(block({ ran: false, ok: true, reason: 'not examined — no site' }), /\*\*Mutation:\*\* ⚠️ not examined — no site/);
  assert.doesNotMatch(block({ ran: false, skipped: true, ok: true, reason: 'risk is low' }), /Mutation/);
});

test('a Mutation Exemption section that is itself inside an HTML comment excuses nothing', (t) => {
  const dir = project(t, 'mutation-commented-section', { story: '\n<!--\n## Mutation Exemption\n\nsrc/auth/limit.js:2 is equivalent.\n-->\n' });
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { evidence } = verify(dir, ['--story', STORY]);

  assert.equal(evidence.mutation.ok, false);
  assert.deepStrictEqual(evidence.mutation.unexcused, ['src/auth/limit.js:2']);
});

test('the budget holds even when a detached grandchild keeps the pipes open', { skip: process.platform === 'win32' }, (t) => {
  const dir = project(t, 'mutation-grandchild');
  const detach = "node -e \"require('child_process').spawn('sleep', ['25'], { detached: true, stdio: 'inherit' }).unref()\"";
  harness(dir, { mutation: { command: `${detach}; node --test {files}`, maxMutants: 5, timeoutMs: 1500 } });
  const started = Date.now();

  const { output, evidence } = verify(dir);

  assert.ok(Date.now() - started < 15000, `verify took ${Date.now() - started}ms`);
  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /budget/);
  assert.equal(worktreeCount(dir), 1);
});

test('a proof is not replayed once HEAD moved, even onto the same content', (t) => {
  const dir = project(t, 'mutation-head');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });
  const first = verify(dir, [], { cache: true });
  assert.equal(first.evidence.mutation.ran, true, first.output);

  git(dir, ['reset', '--soft', 'HEAD~1']);
  git(dir, ['commit', '-q', '-m', 'feat: limit attempts, again']);
  const second = verify(dir, [], { cache: true });

  assert.notEqual(second.evidence.reused, true, 'a proof made at another HEAD is not replayed');
  assert.equal(second.evidence.mutation.ran, true, second.output);
});

test('an untracked scratch file outside the diff does not block the probe', (t) => {
  const dir = project(t, 'mutation-scratch');
  write(dir, 'scratch.js', 'console.log(1 < 2);\n');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true, output);
});

test('an uncommitted edit to a tracked non-JS file is not examined', (t) => {
  const dir = project(t, 'mutation-package');
  write(dir, 'package.json', JSON.stringify({ name: 'mutation-fixture', scripts: { test: 'node --test' }, type: 'commonjs' }, null, 2));
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /uncommitted changes in package\.json/);
});

test('a Mutation Exemption heading inside a fenced code block excuses nothing', (t) => {
  const fence = '\n```markdown\n## Mutation Exemption\n\nsrc/auth/limit.js:2 is equivalent.\n```\n\n~~~\n## Mutation Exemption\n\nsrc/auth/limit.js:2 again\n~~~\n';
  const dir = project(t, 'mutation-fenced', { story: fence });
  harness(dir, { mode: 'strict', mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { evidence } = verify(dir, ['--story', STORY]);

  assert.equal(evidence.mutation.ok, false);
  assert.deepStrictEqual(evidence.mutation.unexcused, ['src/auth/limit.js:2']);
});

test('the head recorded is the commit the probe mutated, read before it ran', (t) => {
  const dir = project(t, 'mutation-head-before');
  const head = git(dir, ['rev-parse', 'HEAD']);
  // The command moves the user's branch while the probe runs.
  harness(dir, { mutation: { command: `git -C '${dir}' commit -q --allow-empty -m moved; node --test {files}`, maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true, output);
  assert.notEqual(git(dir, ['rev-parse', 'HEAD']), head, 'the branch did move during the run');
  assert.equal(evidence.mutation.head, head);
});

test('an uncommitted edit to a markdown test fixture is not examined', (t) => {
  const dir = project(t, 'mutation-md-fixture');
  write(dir, 'test/fixtures/sample.md', '# sample\n');
  commit(dir, 'test: a markdown fixture');
  write(dir, 'test/fixtures/sample.md', '# sample, edited\n');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, false, output);
  assert.match(evidence.mutation.reason, /uncommitted changes in test\/fixtures\/sample\.md/);
});

test('a mutant decided while a detached grandchild holds the pipes is not a timeout', { skip: process.platform === 'win32' }, (t) => {
  const dir = project(t, 'mutation-grace');
  const out = path.join(scratch(t, 'mutation-grace-out'), 'report.json');
  const detach = "node -e \"require('child_process').spawn('sleep', ['6'], { detached: true, stdio: 'inherit' }).unref()\"";
  const probe = path.join(__dirname, '..', 'scripts', 'mutation-probe.js');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;

  execFileSync(process.execPath, [probe, '--repo', dir, '--base', 'main', '--head', 'feat', '--command', `${detach}; node --test {files}`,
    '--timeout', '1', '--json', out], { cwd: dir, env, stdio: 'ignore' });
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));

  assert.deepStrictEqual(report.mutants.map((m) => m.status), ['survived']);
});

test('a diff that steps down from strict at the base still fails on its survivors', (t) => {
  const dir = project(t, 'mutation-step-down');
  const settings = { mutation: { command: 'node --test {files}', maxMutants: 5 } };
  git(dir, ['checkout', '-q', 'main']);
  harness(dir, { mode: 'strict', ...settings });
  git(dir, ['add', '-f', '.coding-flow/harness.json']);
  git(dir, ['commit', '-q', '-m', 'strict policy']);
  git(dir, ['checkout', '-q', 'feat']);
  git(dir, ['merge', '-q', '--no-edit', 'main']);
  harness(dir, { mode: 'standard', ...settings });

  const { code, output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true, output);
  assert.equal(evidence.mutation.survived.length, 1, output);
  assert.equal(evidence.mutation.enforced, true, output);
  assert.equal(evidence.mutation.ok, false, output);
  assert.notEqual(code, 0, output);
});

test('a diff that drops its own path from highRiskPaths still runs the probe', (t) => {
  const dir = project(t, 'mutation-drop-path');
  const settings = { mutation: { command: 'node --test {files}', maxMutants: 5 } };
  git(dir, ['checkout', '-q', 'main']);
  harness(dir, { highRiskPaths: ['src/auth/**'], ...settings });
  git(dir, ['add', '-f', '.coding-flow/harness.json']);
  git(dir, ['commit', '-q', '-m', 'auth is high risk']);
  git(dir, ['checkout', '-q', 'feat']);
  git(dir, ['merge', '-q', '--no-edit', 'main']);
  harness(dir, { highRiskPaths: ['src/payments/**'], ...settings });

  const { output, evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true, output);
  assert.deepStrictEqual(evidence.mutation.survived, [{ file: 'src/auth/limit.js', line: 2, operator: '< → <=' }]);
});

// A base commit with no harness.json, or an unreadable one, is scored with the
// defaults: emptying highRiskPaths in the diff does not lower the risk.
for (const [label, atBase] of [['absent', null], ['invalid JSON', '{ not json']]) {
  test(`a base harness ${label}: emptying highRiskPaths still runs and enforces the probe`, (t) => {
    const dir = project(t, 'mutation-base-default');
    if (atBase !== null) {
      git(dir, ['checkout', '-q', 'main']);
      write(dir, '.coding-flow/harness.json', atBase);
      git(dir, ['add', '-f', '.coding-flow/harness.json']);
      git(dir, ['commit', '-q', '-m', 'broken policy']);
      git(dir, ['checkout', '-q', 'feat']);
      git(dir, ['merge', '-q', '--no-edit', 'main']);
    }
    harness(dir, { failOnContrarySignals: true, highRiskPaths: [], mutation: { command: 'node --test {files}', maxMutants: 5 } });

    const { code, output, evidence } = verify(dir);

    assert.equal(evidence.mutation.ran, true, output);
    assert.equal(evidence.mutation.survived.length, 1, output);
    assert.equal(evidence.mutation.enforced, true, output);
    assert.equal(evidence.mutation.ok, false, output);
    assert.notEqual(code, 0, output);
  });
}
