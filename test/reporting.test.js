'use strict';

// What the tool says about what it did. Two commands used to report a count and
// nothing else — `uninstall` for files it deletes, `commands` for a cheat sheet
// that contradicted the front door it is supposed to summarise.

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

function initProject(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init']).code, 0);
  return dir;
}

test('uninstall --dry-run names every file it would remove', (t) => {
  const dir = initProject(t, 'report-uninstall');

  const { code, output } = run(dir, ['uninstall', '--dry-run']);
  assert.equal(code, 0, output);

  // A bare count gives the user nothing to check a dry run against, on the one
  // command that deletes.
  const planned = JSON.parse(run(dir, ['uninstall', '--dry-run', '--json']).output).removedFiles;
  assert.ok(planned.length > 0);
  for (const file of planned) {
    assert.ok(output.includes(file), `${file} is missing from the dry-run report`);
  }

  assert.match(output, /Would remove files/, 'a dry run does not speak in the past tense');
});

test('uninstall --dry-run removes nothing', (t) => {
  const dir = initProject(t, 'report-uninstall-dry');
  const before = fs.readdirSync(dir).sort();

  run(dir, ['uninstall', '--dry-run']);
  assert.deepEqual(fs.readdirSync(dir).sort(), before);
});

test('the cheat sheet follows the front door, not the subcommand list', (t) => {
  const dir = initProject(t, 'report-commands');

  const { code, output } = run(dir, ['commands']);
  assert.equal(code, 0, output);

  // `harness check --quick` is machinery nobody types; `verify` is the escape
  // hatch a user reaches for. help --all already said so; commands disagreed.
  assert.match(output, /verify/);
  assert.doesNotMatch(output, /harness/);
});

test('verify keeps its direct form in the cheat sheet', (t) => {
  const dir = initProject(t, 'report-commands-form');

  const commands = JSON.parse(run(dir, ['commands', '--json']).output);
  // `npm run flow:verify -- --story x` is not a command worth teaching, so no
  // npm script was added for it.
  assert.match(commands.daily.verify, /verify --story <dir>/);
  assert.doesNotMatch(commands.daily.verify, /npm run/);

  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['flow:verify'], undefined);
});

test('the cheat sheet columns line up on the longest name', (t) => {
  const dir = initProject(t, 'report-align');

  const lines = run(dir, ['commands']).output
    .split('\n')
    .filter((line) => /^ {2}\w/.test(line));

  assert.ok(lines.length > 0);
  // `uninstall` is nine characters and used to eat its own gap against padEnd(8).
  const columns = new Set(lines.map((line) => line.indexOf(line.trim().split(/\s+/)[1])));
  assert.equal(columns.size, 1, `values start at different columns: ${[...columns].join(', ')}`);
});
