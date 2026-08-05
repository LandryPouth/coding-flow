'use strict';

// The onboarding gate. Folding the brownfield scan into `init` made the expensive
// half of onboarding — /flow-plan reading the code and writing the project docs —
// invisible. `doctor` is the one place a stalled onboarding can surface, and it
// used to answer "installed correctly" on a repo whose docs were still our stubs.
// Installed is not onboarded.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const ONBOARDING_DOCS = ['docs/project-context.md', 'docs/conventions.md', 'docs/roadmap.md'];

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

function project(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function brownfield(t, prefix) {
  const dir = project(t, prefix);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'app.tsx'), 'export default null;\n');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'demo', scripts: { test: 'vitest' }, dependencies: { next: '14.0.0' } }),
  );
  assert.equal(run(dir, ['init']).code, 0);
  return dir;
}

function write(dir, relative, text) {
  fs.appendFileSync(path.join(dir, relative), text);
}

function warnings(dir, args = ['doctor']) {
  const res = run(dir, [...args, '--json']);
  assert.equal(res.code, 0, res.output);
  return JSON.parse(res.output).warnings.map((warning) => warning.code);
}

test('doctor warns when a brownfield repo still has the installed doc templates', (t) => {
  const dir = brownfield(t, 'onboard-pending');

  const { code, output } = run(dir, ['doctor']);
  // A warning, never an error: unfinished onboarding is not a broken install, and
  // a red exit here would break CI for every project that never needed the docs.
  assert.equal(code, 0, output);
  assert.match(output, /project docs are still the installed templates/);
  assert.match(output, /\/flow-plan bootstrap/, 'the warning carries the action');
  assert.ok(warnings(dir).includes('brownfield_not_onboarded'));
});

test('the warning clears once the project docs are written', (t) => {
  const dir = brownfield(t, 'onboard-done');
  ONBOARDING_DOCS.forEach((doc) => write(dir, doc, '\nReal content for this project.\n'));

  assert.ok(!warnings(dir).includes('brownfield_not_onboarded'));
});

test('partial progress is not nagged', (t) => {
  const dir = brownfield(t, 'onboard-partial');
  write(dir, 'docs/project-context.md', '\nWe are a Next.js order system.\n');

  // Someone mid-onboarding is making progress; telling them to start is noise.
  assert.ok(!warnings(dir).includes('brownfield_not_onboarded'));
});

test('a greenfield repo is never told to document a codebase it does not have', (t) => {
  const dir = project(t, 'onboard-greenfield');
  assert.equal(run(dir, ['init']).code, 0);

  assert.ok(!warnings(dir).includes('brownfield_not_onboarded'));
});

test('the check is exact, not a length heuristic', (t) => {
  const dir = brownfield(t, 'onboard-exact');
  // One byte of real editing is enough to prove a human touched the file. The
  // separate strict-mode `thin_doc` warning is what catches a doc edited badly.
  write(dir, 'docs/project-context.md', 'x');
  write(dir, 'docs/conventions.md', 'x');
  write(dir, 'docs/roadmap.md', 'x');

  assert.ok(!warnings(dir).includes('brownfield_not_onboarded'));
});

test('the check fires in strict mode too, alongside the thin-doc warning', (t) => {
  const dir = brownfield(t, 'onboard-strict');
  const codes = warnings(dir, ['doctor', '--strict']);

  assert.ok(codes.includes('brownfield_not_onboarded'));
});

test('a missing manifest degrades to silence rather than crashing', (t) => {
  const dir = brownfield(t, 'onboard-nomanifest');
  fs.rmSync(path.join(dir, '.coding-flow', 'manifest.json'));

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /node:internal/);
  assert.doesNotMatch(output, /still the installed templates/);
});

test('a corrupt manifest degrades to silence rather than crashing', (t) => {
  const dir = brownfield(t, 'onboard-badmanifest');
  fs.writeFileSync(path.join(dir, '.coding-flow', 'manifest.json'), 'not json');

  const { code, output } = run(dir, ['doctor']);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /node:internal/);
});

test('a deleted project doc does not read as an untouched template', (t) => {
  const dir = brownfield(t, 'onboard-deleted');
  fs.rmSync(path.join(dir, 'docs', 'roadmap.md'));

  // doctor already reports the missing file as an error; claiming it is also an
  // untouched template would be a second, wrong story about the same file.
  const { output } = run(dir, ['doctor']);
  assert.doesNotMatch(output, /still the installed templates/);
});
