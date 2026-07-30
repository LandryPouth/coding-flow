'use strict';

// Contract tests for the ai-flow CLI.
// We test observable behavior (what the CLI writes to disk and its exit code),
// not the internals — that is what actually protects the user's repo against a
// regression in init / upgrade / uninstall / doctor.
//
// Zero dependency: only the built-in `node:test` runner (Node >= 18).
//   node --test        (or `npm test`)

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

// Creates a throwaway project and schedules its cleanup at the end of the test.
function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Runs the CLI in `cwd`. Never throws: returns { code, output }.
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

const REQUIRED_FILES = ['RULES.md', 'CLAUDE.md', 'package.json'];
const REQUIRED_DIRS = ['.claude/skills', 'docs', 'epics', '.coding-flow'];

test('init installs the base structure and succeeds', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init']);
  assert.equal(code, 0, 'init must exit 0');

  for (const f of REQUIRED_FILES) {
    assert.ok(fs.existsSync(path.join(dir, f)), `missing file after init: ${f}`);
  }
  for (const d of REQUIRED_DIRS) {
    assert.ok(fs.existsSync(path.join(dir, d)), `missing directory after init: ${d}`);
  }
});

test('init creates a private package.json when there is none', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true, 'the generated package.json must be private:true');
});

test('init --dry-run writes no file', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init', '--dry-run']);
  assert.equal(code, 0);
  assert.equal(fs.readdirSync(dir).length, 0, '--dry-run must write nothing');
});

test('doctor succeeds on a healthy install', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  assert.equal(run(dir, ['doctor']).code, 0, 'doctor must pass after a clean init');
});

test('doctor fails when a required file is missing', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  fs.unlinkSync(path.join(dir, 'RULES.md'));
  assert.notEqual(run(dir, ['doctor']).code, 0, 'doctor must detect a missing file');
});

test('doctor --fix restores a missing required file', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const target = path.join(dir, 'RULES.md');
  fs.unlinkSync(target);
  run(dir, ['doctor', '--fix']);
  assert.ok(fs.existsSync(target), 'doctor --fix must recreate the file');
});

test('upgrade is idempotent and preserves local edits', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'RULES.md');
  fs.appendFileSync(rules, '\n<!-- LOCAL-MARKER -->\n');

  const { code } = run(dir, ['upgrade']);
  assert.equal(code, 0, 'upgrade must exit 0');
  assert.ok(
    fs.readFileSync(rules, 'utf8').includes('LOCAL-MARKER'),
    'upgrade must never overwrite a local edit',
  );
});

test('init --force reinstalls and overwrites local edits', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'RULES.md');
  fs.appendFileSync(rules, '\n<!-- LOCAL-MARKER -->\n');

  run(dir, ['init', '--force']);
  assert.ok(
    !fs.readFileSync(rules, 'utf8').includes('LOCAL-MARKER'),
    '--force must reinstall the template over it',
  );
});

test('uninstall removes the managed files but keeps epics/', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);

  const story = path.join(dir, 'epics', 'epic-99-test', 'story.md');
  fs.mkdirSync(path.dirname(story), { recursive: true });
  fs.writeFileSync(story, 'my story');

  assert.equal(run(dir, ['uninstall']).code, 0, 'uninstall must exit 0');
  assert.ok(fs.existsSync(story), 'uninstall must never touch epics/');
  assert.ok(
    !fs.existsSync(path.join(dir, 'RULES.md')),
    'uninstall must remove the managed files',
  );
});

test('list-skills lists the available skills', (t) => {
  const dir = freshProject(t);
  const { code, output } = run(dir, ['list-skills']);
  assert.equal(code, 0);
  assert.ok(output.includes('run'), 'the output must contain at least one known skill');
});

test('version prints the package version and matches package.json', (t) => {
  const dir = freshProject(t);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const { code, output } = run(dir, ['version']);
  assert.equal(code, 0);
  assert.equal(output.trim(), pkg.version);
});
