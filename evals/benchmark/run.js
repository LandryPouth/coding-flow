'use strict';

// Sets up one benchmark run and grades it. Nothing here talks to an agent — the
// arm is whatever you point at the workspace — so the same two commands grade a
// headless `claude -p`, an interactive session, or a human.
//
//   node evals/benchmark/run.js setup 05-cross-module
//   ... let the arm work in the printed workspace ...
//   node evals/benchmark/run.js accept <workspace> 05-cross-module
//
// Zero dependencies, like the rest of this repo.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const HERE = __dirname;
const FIXTURE = path.join(HERE, 'fixture');
const TASKS = path.join(HERE, 'tasks');

const BASE_SPECS = ['money', 'expenses', 'approvals', 'report'].map((n) => `spec/${n}.spec.js`);

// The actor check appears 4 times in the fixture. A finished refactor leaves 2:
// the shared helper, and `rejectExpense`'s own copy, which the task leaves alone.
const DUPLICATION_BASELINE = 4;
const DUPLICATION_TARGET = 2;

function tasks() {
  return fs.readdirSync(TASKS).filter((n) => fs.existsSync(path.join(TASKS, n, 'PROMPT.md'))).sort();
}

function requireTask(id) {
  if (!tasks().includes(id)) {
    console.error(`unknown task: ${id}\nknown: ${tasks().join(', ')}`);
    process.exit(2);
  }
}

function setup(id, target) {
  requireTask(id);

  const dir = target || fs.mkdtempSync(path.join(os.tmpdir(), `bench-${id}-`));
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(FIXTURE, dir, { recursive: true });

  // The acceptance file is deliberately NOT copied here. An arm that can read the
  // grader writes to the grader, and the run stops measuring anything.

  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'benchmark@example.com');
  git('config', 'user.name', 'Benchmark');
  git('add', '-A');
  git('commit', '-q', '-m', `benchmark fixture: ${id}`);

  process.stdout.write(`${dir}\n`);
  process.stderr.write(
    `task     ${id}\n`
    + `prompt   ${path.join(TASKS, id, 'PROMPT.md')}\n`
    + `baseline committed; grade with:\n`
    + `  node ${path.relative(process.cwd(), __filename)} accept ${dir} ${id}\n`,
  );
}

function runSpecs(dir, specs) {
  const result = spawnSync(process.execPath, ['--test', ...specs], { cwd: dir, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const read = (key) => Number((output.match(new RegExp(`^# ${key} (\\d+)$`, 'm')) || [])[1] || 0);

  return { ok: result.status === 0, pass: read('pass'), fail: read('fail'), output };
}

function accept(dir, id) {
  requireTask(id);

  if (!fs.existsSync(path.join(dir, 'src'))) {
    console.error(`not a benchmark workspace: ${dir}`);
    process.exit(2);
  }

  fs.copyFileSync(path.join(TASKS, id, 'accept.spec.js'), path.join(dir, 'spec', 'accept.spec.js'));

  const regression = runSpecs(dir, BASE_SPECS);
  const acceptance = runSpecs(dir, ['spec/accept.spec.js']);

  const line = (name, r) =>
    `${r.ok ? 'PASS' : 'FAIL'}  ${name.padEnd(12)} ${r.pass} passed, ${r.fail} failed`;

  process.stdout.write(`${line('regression', regression)}\n${line('acceptance', acceptance)}\n`);

  if (!regression.ok || !acceptance.ok) {
    process.stdout.write(`\n${(regression.ok ? acceptance : regression).output.trimEnd()}\n`);
  }

  // Task 03 is a refactor: its acceptance is a characterization test and passes on
  // an untouched fixture too, so a run that did nothing would score green on
  // acceptance alone. Completion needs the duplication to have collapsed.
  //
  // Occurrences, not files. `approvals.js` legitimately keeps one copy for
  // `rejectExpense`, which the task deliberately leaves out of scope — so the file
  // stays on the list whether or not `approveExpense` was converted, and counting
  // files cannot tell a finished refactor from a half-finished one.
  if (id === '03-refactor') {
    const sites = [];

    for (const file of fs.readdirSync(path.join(dir, 'src')).filter((f) => f.endsWith('.js'))) {
      const hits = fs
        .readFileSync(path.join(dir, 'src', file), 'utf8')
        .split('throw new Error(`unknown actor').length - 1;

      if (hits > 0) {
        sites.push(`${file}\u00d7${hits}`);
      }
    }

    const total = sites.reduce((sum, entry) => sum + Number(entry.split('\u00d7')[1]), 0);

    process.stdout.write(
      `\n${total <= DUPLICATION_TARGET ? 'PASS' : 'FAIL'}  duplication  ${total} occurrence(s) `
      + `(baseline ${DUPLICATION_BASELINE}, target ${DUPLICATION_TARGET}): ${sites.join(', ') || 'none'}\n`,
    );

    if (total > DUPLICATION_TARGET) {
      process.exit(1);
    }
  }

  process.exit(regression.ok && acceptance.ok ? 0 : 1);
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'setup') {
  setup(rest[0], rest[1]);
} else if (command === 'accept') {
  accept(rest[0], rest[1]);
} else if (command === 'tasks') {
  process.stdout.write(`${tasks().join('\n')}\n`);
} else {
  process.stderr.write(
    'usage:\n'
    + '  node evals/benchmark/run.js tasks\n'
    + '  node evals/benchmark/run.js setup <task-id> [dir]\n'
    + '  node evals/benchmark/run.js accept <workspace> <task-id>\n',
  );
  process.exit(2);
}
