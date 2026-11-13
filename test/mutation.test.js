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
function project(t, prefix, { file = 'src/auth/limit.js', story = '' } = {}) {
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
  write(dir, file, 'function allowed(attempts, max) {\n  return attempts < max;\n}\n\nmodule.exports = { allowed };\n');
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

function verify(dir, extra = []) {
  const { code, output } = run(dir, ['verify', '--json', '--no-cache', ...extra]);
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
  write(dir, 'notes.txt', 'uncommitted work\n');
  harness(dir, { mutation: { command: 'node --test {files}', maxMutants: 5 } });
  const tokenBefore = verify(dir).evidence.provenance;
  const statusBefore = git(dir, ['status', '--porcelain']);

  const { evidence } = verify(dir);

  assert.equal(evidence.mutation.ran, true);
  assert.equal(worktreeCount(dir), 1);
  assert.equal(git(dir, ['status', '--porcelain']), statusBefore);
  assert.equal(git(dir, ['stash', 'list']), '');
  assert.equal(fs.readFileSync(path.join(dir, 'src/auth/limit.js'), 'utf8').includes('attempts < max'), true);
  assert.deepStrictEqual(evidence.provenance.treeToken, tokenBefore.treeToken);
});
