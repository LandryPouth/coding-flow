'use strict';

// Monorepo coverage: every package's fresh report is read against its own
// package root, merged, and a file no report reaches is unmeasured — not
// uncovered. The rung is the weakest of the parts.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { loadCoverageReports } = require('../bin/lib/coverage');

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

function tmp(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

// lcov with package-relative SF, as jest writes it.
function lcov(file, covered, uncovered = []) {
  return [
    'TN:',
    `SF:${file}`,
    ...covered.map((l) => `DA:${l},1`),
    ...uncovered.map((l) => `DA:${l},0`),
    'end_of_record',
    '',
  ].join('\n');
}

const SRC = Array.from({ length: 6 }, (_, i) => `const l${i + 1} = ${i + 1};`).join('\n') + '\n';

// A workspace on main with a validation command that writes the given reports,
// then a feature branch adding source files (and optionally test files).
function monorepo(t, { reports, sources, tests = [] }) {
  const dir = tmp(t, 'mono');
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  write(dir, 'package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*', 'packages/*'] }));
  for (const pkg of ['apps/api', 'apps/web', 'packages/ui']) {
    write(dir, `${pkg}/package.json`, JSON.stringify({ name: path.basename(pkg) }));
  }

  const writers = reports.map(
    ({ file, content }) =>
      `fs.mkdirSync(path.dirname(${JSON.stringify(file)}), { recursive: true });` +
      `fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(content)});`,
  );
  write(dir, 'gen.js', `const fs = require('fs'); const path = require('path');\n${writers.join('\n')}\n`);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node gen.js'], quality: [] };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/x']);

  for (const file of sources) write(dir, file, SRC);
  for (const file of tests) write(dir, file, "require('node:test');\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'change']);

  return dir;
}

const verify = (dir) => {
  const res = run(dir, ['verify', '--json']);
  let evidence = null;
  try {
    evidence = JSON.parse(res.output);
  } catch {
    // leave null; the assertion on res.output shows why
  }
  return { ...res, coverage: evidence && evidence.coverage };
};

test('two packages with package-relative SF paths are both read, and verified', (t) => {
  const dir = monorepo(t, {
    reports: [
      { file: 'apps/api/coverage/lcov.info', content: lcov('src/auth.js', [1, 2, 3, 4, 5, 6]) },
      { file: 'packages/ui/coverage/lcov.info', content: lcov('src/auth2.js', [1, 2, 3, 4, 5, 6]) },
    ],
    sources: ['apps/api/src/auth.js', 'packages/ui/src/auth2.js'],
  });

  const res = verify(dir);

  assert.equal(res.code, 0, res.output);
  assert.equal(res.coverage.tier, 'verified');
  assert.equal(res.coverage.patch.report.reports.length, 2);
  assert.deepEqual(
    res.coverage.patch.report.reports.map((r) => r.package).sort(),
    ['apps/api', 'packages/ui'],
  );
});

test('a package whose added line is not executed is named with its repo-relative path', (t) => {
  const dir = monorepo(t, {
    reports: [
      { file: 'apps/api/coverage/lcov.info', content: lcov('src/auth.js', [1, 2, 3, 4, 5, 6]) },
      { file: 'packages/ui/coverage/lcov.info', content: lcov('src/auth2.js', [1], [2, 3, 4, 5, 6]) },
    ],
    sources: ['apps/api/src/auth.js', 'packages/ui/src/auth2.js'],
  });

  const res = verify(dir);

  assert.equal(res.code, 1, res.output);
  assert.equal(res.coverage.ok, false);
  assert.deepEqual(res.coverage.patch.uncovered.map((u) => u.file), ['packages/ui/src/auth2.js']);
});

test('a file outside every report is unmeasured, not uncovered, and the rung is evidence', (t) => {
  const dir = monorepo(t, {
    reports: [{ file: 'apps/api/coverage/lcov.info', content: lcov('src/auth.js', [1, 2, 3, 4, 5, 6]) }],
    sources: ['apps/api/src/auth.js', 'apps/web/auth.tsx'],
    tests: ['apps/web/auth.test.tsx'],
  });

  const res = verify(dir);

  assert.equal(res.code, 0, res.output);
  assert.equal(res.coverage.tier, 'evidence', 'weakest part decides');
  assert.deepEqual(res.coverage.patch.unmeasured, ['apps/web/auth.tsx']);
  assert.deepEqual(res.coverage.patch.uncovered, [], 'unmeasured is not uncovered');
});

test('an unmeasured file with no test in its package blocks', (t) => {
  const dir = monorepo(t, {
    reports: [{ file: 'apps/api/coverage/lcov.info', content: lcov('src/auth.js', [1, 2, 3, 4, 5, 6]) }],
    sources: ['apps/api/src/auth.js', 'apps/web/auth.tsx'],
  });

  const res = verify(dir);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(res.coverage.patch.unprovenUnmeasured, ['apps/web/auth.tsx']);
});

test('a stale report in one package is ignored, the other is used', (t) => {
  const dir = tmp(t, 'stale');
  write(dir, 'package.json', JSON.stringify({ workspaces: ['apps/*'] }));
  write(dir, 'apps/api/package.json', '{}');
  write(dir, 'apps/web/package.json', '{}');
  write(dir, 'apps/api/coverage/lcov.info', lcov('src/auth.js', [1]));
  write(dir, 'apps/web/coverage/lcov.info', lcov('src/w.js', [1]));

  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(dir, 'apps/web/coverage/lcov.info'), old, old);

  const report = loadCoverageReports(dir, {
    candidates: ['apps/*/coverage/lcov.info'],
    since: Date.now() - 60_000,
  });

  assert.deepEqual(report.reports.map((r) => r.package), ['apps/api']);
  assert.ok(report.files.has('apps/api/src/auth.js'));
  assert.ok(!report.files.has('apps/web/src/w.js'));
});

test('two reports for one file merge by max hits and both are recorded', (t) => {
  const dir = tmp(t, 'merge');
  write(dir, 'package.json', '{}');
  write(dir, 'coverage/lcov.info', lcov('src/s.js', [1], [2]));
  write(dir, 'coverage/coverage-final.json', JSON.stringify({
    [path.join(dir, 'src/s.js')]: { statementMap: { 0: { start: { line: 2 } } }, s: { 0: 3 } },
  }));

  const report = loadCoverageReports(dir, {
    candidates: ['coverage/lcov.info', 'coverage/coverage-final.json'],
  });

  assert.equal(report.reports.length, 2);
  assert.equal(report.files.get('src/s.js').get(1), 1);
  assert.equal(report.files.get('src/s.js').get(2), 3);
});

test('a single root-level report behaves as before', (t) => {
  const dir = tmp(t, 'root');
  write(dir, 'package.json', '{}');
  write(dir, 'coverage/lcov.info', lcov('src/s.js', [1]));

  const report = loadCoverageReports(dir, { candidates: ['coverage/lcov.info'] });

  assert.equal(report.path, 'coverage/lcov.info');
  assert.deepEqual(report.packageRoots, ['']);
  assert.ok(report.files.has('src/s.js'));
});
