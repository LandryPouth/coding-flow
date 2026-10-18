'use strict';

// A migration is behavior (story 13-01). `**/migrations/**` and `**/*.sql` were
// in both `highRiskPaths` and the default `nonBehaviorGlobs`, and the coverage
// gate dropped non-behavior files first: a branch adding only
// `ALTER TABLE users DROP COLUMN email;` verified green at `not-required`,
// "docs, story, or lockfile only" (DOGFOODING, 2026-10-18). A path that is
// high-risk is now never non-behavior; a user's own non-behavior glob that is
// not high-risk still wins.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const DROP = 'ALTER TABLE users DROP COLUMN email;\n';

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

// `.coding-flow/config.json` only, on `main`; the work goes on `feature`.
function repo(t, prefix, extra = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  write(dir, '.coding-flow/config.json', JSON.stringify({ validation: { commands: ['node -e "process.exit(0)"'] } }));
  for (const [file, content] of Object.entries(extra)) write(dir, file, content);
  write(dir, 'README.md', '# app\n');
  commit(dir, 'init');
  git(dir, ['checkout', '-q', '-b', 'feature']);
  return dir;
}

function latestVerify(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  const name = fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runs, name), 'utf8'));
}

test('a migration-only diff fails the coverage gate, and the reason names the migration', (t) => {
  const dir = repo(t, 'mig-alone');
  write(dir, 'migrations/002.sql', DROP);
  commit(dir, 'drop email');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN/);
  const { coverage } = latestVerify(dir);
  assert.equal(coverage.ok, false);
  assert.equal(coverage.tier, 'missing');
  assert.match(coverage.reason, /migrations\/002\.sql/);
});

test('the same migration with a test changed passes at evidence', (t) => {
  const dir = repo(t, 'mig-test');
  write(dir, 'migrations/002.sql', DROP);
  write(dir, 'test/migrations.test.js', "require('node:assert').ok(true);\n");
  commit(dir, 'drop email + test');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Coverage: evidence/);
  assert.equal(latestVerify(dir).coverage.tier, 'evidence');
});

test('the same migration with a declared exemption passes and records the text', (t) => {
  const dir = repo(t, 'mig-exempt');
  write(dir, 'migrations/002.sql', DROP);
  commit(dir, 'drop email');
  const reason = 'schema-only, checked by db:migrate on a scratch db';

  const res = run(dir, ['verify', '--test-exemption', reason]);

  assert.equal(res.code, 0, res.output);
  const { coverage } = latestVerify(dir);
  assert.equal(coverage.ok, true);
  assert.equal(coverage.exemption, reason);
});

test('docs and generated code only: no behavior, and the reason lists what was excluded', (t) => {
  // A story whose wording raises the risk to medium, so the gate runs at all.
  const story = 'epics/epic-01-x/story-01-01-x';
  const dir = repo(t, 'mig-none', {
    [`${story}/story.md`]: '# Regenerate the database client after the migration\n',
  });
  write(dir, 'docs/a.md', 'note\n');
  write(dir, 'src/generated/x.gen.ts', 'export const x = 1;\n');
  commit(dir, 'docs + generated');

  const res = run(dir, ['verify', '--story', story]);

  assert.equal(res.code, 0, res.output);
  const { coverage } = latestVerify(dir);
  assert.equal(coverage.mode, 'none');
  assert.match(coverage.reason, /excluded by nonBehaviorGlobs/);
  assert.match(coverage.reason, /docs\/a\.md/);
  assert.match(coverage.reason, /src\/generated\/x\.gen\.ts/);
  assert.doesNotMatch(coverage.reason, /lockfile only/);
});

test("a user's non-behavior glob that is not high-risk keeps .sql files non-behavior", (t) => {
  const dir = repo(t, 'mig-user', {
    '.coding-flow/harness.json': JSON.stringify({
      highRiskPaths: ['**/auth/**'],
      nonBehaviorGlobs: ['**/*.sql', '**/*.md'],
    }),
  });
  write(dir, 'src/auth/login.js', 'module.exports = () => true;\n');
  write(dir, 'db/seed.sql', "INSERT INTO users VALUES (1, 'a');\n");
  commit(dir, 'login + seed');

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  const { coverage } = latestVerify(dir);
  assert.deepEqual(coverage.behaviorFiles, ['src/auth/login.js']);
  assert.match(coverage.reason, /src\/auth\/login\.js/);
  assert.doesNotMatch(coverage.reason, /seed\.sql/);
});
