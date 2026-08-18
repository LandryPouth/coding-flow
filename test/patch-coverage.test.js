'use strict';

// Line-level coverage of the change. The gate's cheap question is "did a test
// file move?"; this is the real one — are the lines this change ADDED actually
// executed by the suite that just ran. These tests pin that the stronger measure
// supersedes the weaker one, and that it degrades to the weaker one rather than
// guessing whenever it cannot see.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { parseLcov, parseIstanbulJson, measurePatchCoverage } = require('../bin/lib/coverage');

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

// The validation command a real project would run is `vitest --coverage` or
// `c8 node --test`. Here it is a stand-in that writes the same artifact those
// tools write, so the tests exercise the parsing and the gate without paying for
// a real suite on every run.
function coverageWriter({ file, covered, uncovered, format = 'lcov' }) {
  const spec = JSON.stringify({ file, covered, uncovered, format });
  return `
const fs = require("fs");
const path = require("path");
const spec = ${spec};
fs.mkdirSync("coverage", { recursive: true });

if (spec.format === "lcov") {
  const lines = ["TN:", "SF:" + path.resolve(spec.file)];
  for (const line of spec.covered) lines.push("DA:" + line + ",1");
  for (const line of spec.uncovered) lines.push("DA:" + line + ",0");
  lines.push("end_of_record", "");
  fs.writeFileSync("coverage/lcov.info", lines.join("\\n"));
} else {
  const statementMap = {};
  const s = {};
  let id = 0;
  for (const line of spec.covered) { statementMap[id] = { start: { line } }; s[id] = 1; id += 1; }
  for (const line of spec.uncovered) { statementMap[id] = { start: { line } }; s[id] = 0; id += 1; }
  fs.writeFileSync(
    "coverage/coverage-final.json",
    JSON.stringify({ [path.resolve(spec.file)]: { statementMap, s } }),
  );
}
`;
}

// A repo on a feature branch whose declared validation writes a coverage report.
// The writer lives on `main` so it is never itself part of the change under test.
function repo(t, prefix, { covered = [], uncovered = [], format = 'lcov', writeReport = true } = {}) {
  const dir = project(t, prefix);
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  fs.writeFileSync(
    path.join(dir, 'gen-coverage.js'),
    coverageWriter({ file: 'src/auth.js', covered, uncovered, format }),
  );

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

// 10 lines of source, so line numbers in the tests mean something.
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

// --- the parsers ------------------------------------------------------------

test('lcov: DA records become per-line hit counts', () => {
  const parsed = parseLcov(['TN:', 'SF:/repo/src/a.js', 'DA:1,3', 'DA:2,0', 'end_of_record'].join('\n'));

  assert.equal(parsed.size, 1);
  assert.equal(parsed.get('/repo/src/a.js').get(1), 3);
  assert.equal(parsed.get('/repo/src/a.js').get(2), 0);
});

test('lcov: a line hit by any statement counts as executed', () => {
  const parsed = parseLcov(['SF:/repo/a.js', 'DA:7,0', 'DA:7,4', 'end_of_record'].join('\n'));
  assert.equal(parsed.get('/repo/a.js').get(7), 4, 'executed once is executed');
});

test('istanbul json: statements map to their first line', () => {
  const parsed = parseIstanbulJson({
    '/repo/src/a.js': {
      statementMap: { 0: { start: { line: 4 } }, 1: { start: { line: 9 } } },
      s: { 0: 2, 1: 0 },
    },
  });

  assert.equal(parsed.get('/repo/src/a.js').get(4), 2);
  assert.equal(parsed.get('/repo/src/a.js').get(9), 0);
});

test('a changed line with no entry in the report is not executable, and does not count', () => {
  const report = { files: new Map([['src/a.js', new Map([[1, 1]])]]) };
  const measured = measurePatchCoverage({ report, changedLinesByFile: { 'src/a.js': [1, 2, 3] } });

  assert.equal(measured.totalLines, 1, 'blank lines and comments must not dilute the score');
  assert.equal(measured.coveredLines, 1);
  assert.equal(measured.percent, 100);
});

// --- the gate ---------------------------------------------------------------

test('a green suite whose report shows the change uncovered is NOT PROVEN', (t) => {
  const dir = repo(t, 'patch-uncovered', { covered: [1, 2, 3], uncovered: [4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir);

  const res = run(dir, ['verify']);
  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /30% of the 10 added line\(s\)/);
  assert.match(res.output, /src\/auth\.js: lines 4-10 not executed/, 'the lines are named, not just a percentage');
});

test('a fully covered change passes, and says so in line-level terms', (t) => {
  const dir = repo(t, 'patch-covered', { covered: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], uncovered: [] });
  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.mode, 'diff-lines');
  assert.equal(coverage.patch.percent, 100);
  assert.equal(coverage.patch.report.format, 'lcov');
});

test('line-level evidence overrides the test-file heuristic', (t) => {
  // A test file DID change — the weaker check would wave this through. The
  // report says the change is not executed, and the stronger measure wins.
  const dir = repo(t, 'patch-supersede', { covered: [1], uncovered: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.equal(coverage.mode, 'diff-lines');
  assert.ok(coverage.testFiles.includes('src/auth.test.js'), 'a test file did change');
  assert.equal(coverage.ok, false, 'and it still does not reach the change');
});

test('istanbul json reports are read the same way', (t) => {
  const dir = repo(t, 'patch-istanbul', {
    covered: [1, 2],
    uncovered: [3, 4, 5, 6, 7, 8, 9, 10],
    format: 'json',
  });
  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.equal(coverage.patch.report.format, 'istanbul-json');
});

test('minPatchCoverage is the project’s call', (t) => {
  const dir = repo(t, 'patch-threshold', { covered: [1, 2, 3, 4, 5], uncovered: [6, 7, 8, 9, 10] });
  const harnessPath = path.join(dir, '.coding-flow', 'harness.json');
  const harness = JSON.parse(fs.readFileSync(harnessPath, 'utf8'));
  harness.minPatchCoverage = 50;
  fs.writeFileSync(harnessPath, JSON.stringify(harness, null, 2));
  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  assert.equal(res.code, 0, res.output);
  assert.equal(JSON.parse(res.output).coverage.patch.percent, 50);
});

test('an exemption still applies at the line level', (t) => {
  const dir = repo(t, 'patch-exempt', { covered: [1], uncovered: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
  writeAuth(dir);

  const res = run(dir, ['verify', '--test-exemption', 'generated client, covered upstream', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.mode, 'diff-lines');
  assert.match(coverage.exemption, /generated client/);
  assert.equal(coverage.patch.ok, false, 'the measurement is still recorded, exempted not erased');
});

// --- degrading honestly -----------------------------------------------------

test('no coverage report at all falls back to the test-file question', (t) => {
  const dir = repo(t, 'patch-noreport', { writeReport: false });
  writeAuth(dir, { withTest: true });

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 0, res.output);
  assert.equal(coverage.mode, 'test-file', 'the weaker question, asked only when the stronger cannot be');
});

test('a report older than the run is ignored, not trusted', (t) => {
  // The most dangerous failure mode: a months-old lcov quietly waving every
  // change through. Here the suite writes no report, but a stale one is present.
  const dir = repo(t, 'patch-stale', { writeReport: false });
  fs.mkdirSync(path.join(dir, 'coverage'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'coverage', 'lcov.info'),
    ['SF:' + path.join(dir, 'src', 'auth.js'), 'DA:1,1', 'DA:2,1', 'end_of_record', ''].join('\n'),
  );
  const old = Date.now() / 1000 - 86400;
  fs.utimesSync(path.join(dir, 'coverage', 'lcov.info'), old, old);

  writeAuth(dir);

  const res = run(dir, ['verify', '--json']);
  const { coverage } = JSON.parse(res.output);

  assert.equal(res.code, 1, res.output);
  assert.equal(coverage.mode, 'test-file', 'a stale report is no report');
  assert.equal(coverage.ok, false, 'and no test file changed either');
});
