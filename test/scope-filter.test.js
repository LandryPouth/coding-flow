'use strict';

// Evidence files and declared generated paths are not "changes": coverage, risk,
// weakening and deleted-test signals ignore them, while the guard and secret
// scanning keep their own lists. Throwaway repositories, observable output only.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function write(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function repo(t, harnessPatch = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-scope-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = { ...JSON.parse(fs.readFileSync(harnessPath, 'utf8')), ...harnessPatch };
  fs.writeFileSync(harnessPath, `${JSON.stringify(harness, null, 2)}\n`);

  write(dir, { 'README.md': '# x\n' });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  git(dir, ['switch', '-qc', 'story-07-02-x']);
  return dir;
}

function story(dir) {
  const rel = 'epics/epic-07-x/story-07-02-x';
  write(dir, { [`${rel}/story.md`]: '# X\n\nAdd a CRUD form backed by the api.\n' });
  return rel;
}

function verify(dir, rel) {
  return JSON.parse(run(dir, ['verify', '--json', '--no-cache', '--story', rel]).output);
}

function commitAll(dir, message) {
  git(dir, ['add', '-A', '-f']);
  git(dir, ['commit', '-qm', message]);
}

const behaviour = (files) => files.filter((f) => !f.startsWith('epics/'));

test("the tool's own run files are not changed files", (t) => {
  const dir = repo(t);
  const rel = story(dir);
  write(dir, {
    'src/a.js': 'exports.a = 1;\n',
    'test/a.test.js': 'x\n',
    '.coding-flow/runs/1-verify.json': '{}\n',
    '.coding-flow/runs/2-verify.json': '{}\n',
    '.coding-flow/runs/3-verify.json': '{}\n',
  });
  commitAll(dir, 'work');

  const files = verify(dir, rel).coverage.changedFiles;

  assert.ok(files.includes('src/a.js'));
  assert.deepEqual(files.filter((f) => f.startsWith('.coding-flow/')), []);
});

test('ignoredPaths leaves only the hand-written file in the behaviour set', (t) => {
  const dir = repo(t, { ignoredPaths: ['apps/api/generated/**'] });
  const rel = story(dir);
  write(dir, {
    'apps/api/generated/client.ts': 'export const c = 1;\n',
    'apps/api/generated/types.ts': 'export type T = 1;\n',
    'prisma/schema.prisma': 'model A { id Int }\n',
  });
  commitAll(dir, 'work');

  assert.deepEqual(behaviour(verify(dir, rel).coverage.changedFiles), ['prisma/schema.prisma']);
});

test('without ignoredPaths the same generated files are counted', (t) => {
  const dir = repo(t);
  const rel = story(dir);
  write(dir, { 'apps/api/generated/client.ts': 'export const c = 1;\n', 'prisma/schema.prisma': 'model A { id Int }\n' });
  commitAll(dir, 'work');

  assert.ok(verify(dir, rel).coverage.changedFiles.includes('apps/api/generated/client.ts'));
});

test('an ignored generated file with a risky path does not raise the risk', (t) => {
  const riskOf = (patch) => {
    const dir = repo(t, patch);
    const rel = story(dir);
    write(dir, { 'gen/payments/charge.ts': 'export const m = 1;\n' });
    commitAll(dir, 'work');
    return verify(dir, rel).coverage.riskPaths || [];
  };

  assert.ok(riskOf({}).includes('gen/payments/charge.ts'));
  assert.deepEqual(riskOf({ ignoredPaths: ['gen/**'] }), []);
});

test('a test deleted under an ignored path is not reported as weakened', (t) => {
  const dir = repo(t, { ignoredPaths: ['generated/**'] });
  write(dir, { 'generated/old.test.js': 'assert(1)\n' });
  commitAll(dir, 'add generated test');
  git(dir, ['switch', '-qc', 'story-07-02-y']);
  git(dir, ['rm', '-q', 'generated/old.test.js']);
  const rel = story(dir);
  write(dir, { 'src/a.js': 'exports.a = 1;\n', 'test/a.test.js': 'x\n' });
  commitAll(dir, 'work');

  const weakened = verify(dir, rel).coverage.weakenedTests || [];

  assert.ok(!weakened.some((w) => w.file === 'generated/old.test.js'));
});

test('ignoredPaths does not hide a secret in a generated file', (t) => {
  // A project-declared pattern, so the test carries no credential-shaped value.
  const dir = repo(t, {
    ignoredPaths: ['generated/**'],
    secretPatterns: [{ name: 'canary', pattern: 'CANARY_[0-9]{6}', precision: 'exact' }],
  });
  write(dir, { 'generated/leak.ts': 'export const k = "CANARY_123456";\n' });
  git(dir, ['add', '-A']);

  assert.match(run(dir, ['harness', 'check', '--json']).output, /canary/i);
});

test('doctor suggests ignoredPaths for a large generated directory in the last verify', (t) => {
  const dir = repo(t);
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const changedFiles = Array.from({ length: 30 }, (_, i) => `apps/api/generated/f${i}.ts`);
  fs.writeFileSync(path.join(runs, '2026-10-16T00-00-00-000Z-verify.json'), JSON.stringify({ coverage: { changedFiles } }));

  const report = JSON.parse(run(dir, ['doctor', '--json']).output);
  const hint = (report.warnings || []).find((w) => w.code === 'generated_not_ignored');

  assert.ok(hint, 'a generated_not_ignored warning');
  assert.match(hint.message, /apps\/api\/generated\/\*\*/);
});

test('doctor stays quiet for a small generated directory', (t) => {
  const dir = repo(t);
  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const changedFiles = Array.from({ length: 5 }, (_, i) => `generated/f${i}.ts`);
  fs.writeFileSync(path.join(runs, '2026-10-16T00-00-00-000Z-verify.json'), JSON.stringify({ coverage: { changedFiles } }));

  const report = JSON.parse(run(dir, ['doctor', '--json']).output);

  assert.ok(!(report.warnings || []).some((w) => w.code === 'generated_not_ignored'));
});
