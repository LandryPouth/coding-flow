'use strict';

// The coverage gate: a green suite is not evidence that THIS story is covered.
// These tests pin the one claim the gate exists to make — a risky change that
// adds no test does not come out `verified` — and, just as importantly, the
// cases where it must stay silent, because a gate that fires wrongly is a gate
// people switch off.

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

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A project on a feature branch: the shape every story is meant to be run in,
// so the gate reads the branch's whole contribution and not just what happens
// to be uncommitted right now.
function repo(t, prefix) {
  const dir = project(t, prefix);
  assert.equal(run(dir, ['init']).code, 0);

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/story']);

  const config = path.join(dir, '.coding-flow', 'config.json');
  const parsed = JSON.parse(fs.readFileSync(config, 'utf8'));
  parsed.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(config, `${JSON.stringify(parsed, null, 2)}\n`);

  return dir;
}

// `risk` drives the gate: only medium/high stories are gated.
function story(dir, { risk = 'high', extra = '' } = {}) {
  const rel = 'epics/epic-01/story-01-01-demo';
  const storyDir = path.join(dir, rel);
  fs.mkdirSync(storyDir, { recursive: true });

  const intent = risk === 'high'
    ? 'Change who is allowed through: this story alters an authorization decision.'
    : risk === 'medium'
      ? 'Add a CRUD form backed by the api.'
      : 'Update the wording of the footer.';

  fs.writeFileSync(path.join(storyDir, 'spec.md'), `# Demo\n\n${intent}\n${extra}\n`);
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '# Plan\n');
  return rel;
}

function commit(dir, files, message) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

// --- the gate fires ---------------------------------------------------------

test('a green suite over a risky change with no test is NOT verified', (t) => {
  const dir = repo(t, 'cov-fires');
  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, 'the story must not pass on a suite that proves nothing about it');
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /no test file did/);
  assert.match(res.output, /src\/auth\.js/, 'the uncovered file is named');
});

test('the evidence separates "commands passed" from "change proved"', (t) => {
  const dir = repo(t, 'cov-evidence');
  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const evidence = JSON.parse(res.output);

  assert.equal(evidence.commandsOk, true, 'every declared command did pass');
  assert.equal(evidence.coverage.ok, false, 'and the change is still not covered');
  assert.equal(evidence.ok, false, 'so the proof does not hold');
  assert.ok(evidence.coverage.behaviorFiles.includes('src/auth.js'));
});

test('a story blocked by the gate is not shippable', (t) => {
  const dir = repo(t, 'cov-status');
  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');
  run(dir, ['verify', '--story', rel]);

  // No green verify was recorded, so nothing downstream can read it as proven.
  const runs = path.join(dir, '.coding-flow', 'runs');
  const proofs = fs
    .readdirSync(runs)
    .filter((f) => f.endsWith('-verify.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(runs, f), 'utf8')));

  assert.ok(proofs.length > 0, 'the attempt is still recorded');
  assert.ok(!proofs.some((p) => p.ok), 'none of them claims the story is proved');
});

// --- the gate stays silent --------------------------------------------------

test('a test changed alongside the code passes the gate', (t) => {
  const dir = repo(t, 'cov-tested');
  const rel = story(dir, { risk: 'high' });
  commit(
    dir,
    {
      'src/auth.js': 'module.exports = () => true;\n',
      'src/auth.test.js': "require('node:test');\n",
    },
    'auth change with test',
  );

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const evidence = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(evidence.ok, true);
  assert.ok(evidence.coverage.testFiles.includes('src/auth.test.js'));
});

test('a brand-new untracked test counts (it is the case that matters most)', (t) => {
  const dir = repo(t, 'cov-untracked');
  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');
  fs.writeFileSync(path.join(dir, 'src', 'auth.spec.js'), "require('node:test');\n");

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.ok, true);
});

test('a low-risk story is never gated', (t) => {
  const dir = repo(t, 'cov-low');
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'src/footer.js': 'module.exports = "hi";\n' }, 'copy change');

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  const { coverage } = JSON.parse(res.output);
  assert.equal(coverage.required, false);
  assert.match(coverage.reason, /low/);
});

test('a docs-only change trips nothing', (t) => {
  const dir = repo(t, 'cov-docs');
  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'docs/architecture.md': '# Notes\n' }, 'docs');

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  assert.match(JSON.parse(res.output).coverage.reason, /no behavior file/);
});

test('outside a git repository the gate cannot see, so it stays quiet', (t) => {
  const dir = project(t, 'cov-nogit');
  assert.equal(run(dir, ['init']).code, 0);
  const config = path.join(dir, '.coding-flow', 'config.json');
  const parsed = JSON.parse(fs.readFileSync(config, 'utf8'));
  parsed.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(config, `${JSON.stringify(parsed, null, 2)}\n`);
  const rel = story(dir, { risk: 'high' });

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.required, false);
});

// --- the escape hatch leaves a mark ----------------------------------------

test('a declared test exemption unblocks the story and is recorded verbatim', (t) => {
  const dir = repo(t, 'cov-exempt');
  const rel = story(dir, {
    risk: 'high',
    extra: '\n## Test Exemption\n\nVendor SDK bump; behavior is covered by the existing suite.\n',
  });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const evidence = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(evidence.ok, true);
  assert.match(evidence.coverage.exemption, /Vendor SDK bump/);

  // Visible, not silent: the human-readable output names the tier and quotes the
  // reason, so nobody reads "passed" without seeing what carried it.
  const human = run(dir, ['verify', '--story', rel, '--no-cache']);
  assert.match(human.output, /Coverage: exempted — "Vendor SDK bump/);
  assert.equal(evidence.coverage.tier, 'exempted');
});

// --- risk read from the diff, not from the prose ---------------------------
//
// Story text is written by the agent. A gate keyed only on that text is a gate
// the agent can stand down by choosing milder words. The files it touched are
// not a claim, they are a fact.

test('a bland story cannot talk the gate down when the diff touches auth', (t) => {
  const dir = repo(t, 'cov-bland');
  // Nothing in this story says "auth", "permission", or any other risk term.
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'src/auth/session.js': 'module.exports = () => true;\n' }, 'quiet auth change');

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, 'the diff is what decides');
  assert.equal(coverage.ok, false);
  assert.equal(coverage.riskSource, 'diff');
  assert.ok(coverage.riskPaths.includes('src/auth/session.js'));
});

test('the human output names the path that raised the risk', (t) => {
  const dir = repo(t, 'cov-bland-print');
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'src/payments/charge.js': 'module.exports = () => 1;\n' }, 'quiet payment change');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /Risk read from the diff, not the story/);
  assert.match(res.output, /charge\.js/);
});

// The gate's credibility depends on never blocking on something a test suite
// cannot answer. A migration is genuinely high-risk — and genuinely not unit
// testable. Blocking it teaches the developer to reach for --test-exemption on
// reflex, which is how a gate stops meaning anything.
test('a migration raises the risk but is not asked for a unit test', (t) => {
  const dir = repo(t, 'cov-migration');
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'db/migrations/003_add_role.sql': 'ALTER TABLE users ADD role text;\n' }, 'migration');

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.ok, true);
  assert.equal(coverage.mode, 'none', 'nothing executable changed');
});

test('type declarations and build config never demand coverage', (t) => {
  const dir = repo(t, 'cov-nonbehavior');
  const rel = story(dir, { risk: 'high' });
  commit(
    dir,
    {
      'src/auth/types.d.ts': 'export type Role = "admin" | "user";\n',
      'vitest.config.ts': 'export default {};\n',
    },
    'types and config',
  );

  const res = run(dir, ['verify', '--story', rel, '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.ok, true, 'a .d.ts can never appear in a coverage report');
  assert.equal(coverage.mode, 'none');
});

test('an ordinary diff still passes untouched', (t) => {
  const dir = repo(t, 'cov-ordinary');
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'src/footer.js': 'module.exports = "hi";\n' }, 'copy change');

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.required, false);
});

// --- the gate no longer needs epics/ ---------------------------------------

test('a risky change with no story at all is still gated', (t) => {
  const dir = repo(t, 'cov-nostory');
  commit(dir, { 'src/payments/charge.js': 'module.exports = () => 1;\n' }, 'payments');

  // No --story: the project-wide verify, on a repo that never adopted epics/.
  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, 'the proof layer works without the story layer');
  assert.equal(coverage.ok, false);
  assert.equal(coverage.riskSource, 'diff');
});

test('--test-exemption is the escape hatch when there is no story to write in', (t) => {
  const dir = repo(t, 'cov-flag');
  commit(dir, { 'src/payments/charge.js': 'module.exports = () => 1;\n' }, 'payments');

  const res = run(dir, ['verify', '--test-exemption', 'vendor SDK bump, no behavior change', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.ok, true);
  assert.match(coverage.exemption, /vendor SDK bump/, 'the reason is recorded verbatim');
});

test('--test-exemption without a reason is refused', (t) => {
  const dir = repo(t, 'cov-flag-empty');
  commit(dir, { 'src/payments/charge.js': 'module.exports = () => 1;\n' }, 'payments');

  const res = run(dir, ['verify', '--test-exemption', '--json']);

  assert.equal(res.code, 1);
  assert.match(res.output, /requires a reason/, 'the reason is the artifact; a bare flag is not one');
});

test('preflight reports the diff-derived risk, so the mode cannot be undersold', (t) => {
  const dir = repo(t, 'cov-preflight');
  const rel = story(dir, { risk: 'low' });
  commit(dir, { 'src/auth/session.js': 'module.exports = () => true;\n' }, 'quiet auth change');

  const res = run(dir, ['harness', 'preflight', '--story', rel, '--json']);
  const contract = JSON.parse(res.output);

  assert.equal(contract.risk.level, 'high');
  assert.equal(contract.recommendedMode, 'strict');
  assert.equal(contract.risk.source, 'diff');
});

test('requireTestChange: false turns the gate off for the whole project', (t) => {
  const dir = repo(t, 'cov-off');
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
  harness.requireTestChange = false;
  fs.writeFileSync(harnessPath, `${JSON.stringify(harness, null, 2)}\n`);

  const rel = story(dir, { risk: 'high' });
  commit(dir, { 'src/auth.js': 'module.exports = () => true;\n' }, 'auth change');

  const res = run(dir, ['verify', '--story', rel, '--json']);

  assert.equal(res.code, 0, res.output);
  assert.match(JSON.parse(res.output).coverage.reason, /disabled by harness config/);
});
