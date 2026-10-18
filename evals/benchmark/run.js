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

// Prints the results table of one committed run directory (`runs/<date>/`), so the
// experiment document quotes this output instead of figures copied by hand. Each
// `<task>-<arm>/` holds `run-*.json`, `exit-*` and `final.patch` (see its README).
function summarize(runsDir) {
  const ARMS = { A: 'vanilla', B: 'coding-flow' };
  const cells = fs.existsSync(runsDir)
    ? fs.readdirSync(runsDir).filter((name) => /^\d\d-.+-[AB]$/.test(name)).sort()
    : [];

  if (cells.length === 0) {
    console.error(`no <task>-<arm> directories in: ${runsDir}`);
    process.exit(2);
  }

  const num = (x) => x.toLocaleString('en-US');
  const zero = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0, ms: 0, firstPass: 0, roundTrips: 0, specLines: 0, tasks: 0 });
  const row = (task, arm, s) =>
    `| ${task} | ${ARMS[arm]} | ${task.startsWith('**') ? `${s.firstPass}/${s.tasks}` : (s.firstPass ? 'yes' : 'no')} `
    + `| ${s.roundTrips} | ${num(s.in)}/${num(s.out)} | ${num(s.cacheRead)} | ${num(s.cacheWrite)} `
    + `| $${s.usd.toFixed(2)} | ${Math.round(s.ms / 1000)}s | ${s.specLines} |`;
  const totals = {};
  const rows = [];

  for (const cell of cells) {
    const dir = path.join(runsDir, cell);
    const files = fs.readdirSync(dir);
    const stats = zero();

    for (const file of files.filter((f) => /^run-.+\.json$/.test(f))) {
      const run = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      stats.in += run.usage.input_tokens;
      stats.out += run.usage.output_tokens;
      stats.cacheRead += run.usage.cache_read_input_tokens;
      stats.cacheWrite += run.usage.cache_creation_input_tokens;
      stats.usd += run.total_cost_usd;
      stats.ms += run.duration_ms;
    }

    // One `exit-<k>` per acceptance run: the first is the unprompted attempt, each
    // later one follows a re-prompt.
    const exits = files.filter((f) => /^exit-\d+$/.test(f)).sort();
    stats.firstPass = fs.readFileSync(path.join(dir, exits[0]), 'utf8').trim() === '0' ? 1 : 0;
    stats.roundTrips = exits.length - 1;
    stats.tasks = 1;

    // Added lines under spec/; the grader's accept.spec.js is not in final.patch.
    let inSpec = false;
    for (const line of fs.readFileSync(path.join(dir, 'final.patch'), 'utf8').split('\n')) {
      if (line.startsWith('diff --git ')) inSpec = / b\/spec\//.test(line);
      else if (inSpec && line.startsWith('+') && !line.startsWith('+++')) stats.specLines += 1;
    }

    const [, id, name, arm] = cell.match(/^(\d\d)-(.+)-([AB])$/);
    rows.push(row(`${Number(id)} ${name}`, arm, stats));

    totals[arm] = totals[arm] || zero();
    for (const key of Object.keys(stats)) totals[arm][key] += stats[key];
  }

  for (const arm of Object.keys(totals).sort()) rows.push(row('**Total**', arm, totals[arm]));

  const out = [
    '| Task | Arm | First-pass | Round-trips | Tokens (in/out) | Cache read | Cache write | Cost | Time | Spec lines added |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ];

  if (totals.A && totals.B) {
    const ratio = (key) => `${(totals.B[key] / totals.A[key]).toFixed(1)}×`;
    out.push(
      '',
      `coding-flow against vanilla: cost ${ratio('usd')}, time ${ratio('ms')}, `
      + `cache writes ${ratio('cacheWrite')}, spec lines added ${ratio('specLines')}.`,
    );
  }

  process.stdout.write(`${out.join('\n')}\n`);
}

const [command, ...rest] = process.argv.slice(2);

if (command === 'setup') {
  setup(rest[0], rest[1]);
} else if (command === 'accept') {
  accept(rest[0], rest[1]);
} else if (command === 'summarize') {
  summarize(rest[0] || '');
} else if (command === 'tasks') {
  process.stdout.write(`${tasks().join('\n')}\n`);
} else {
  process.stderr.write(
    'usage:\n'
    + '  node evals/benchmark/run.js tasks\n'
    + '  node evals/benchmark/run.js setup <task-id> [dir]\n'
    + '  node evals/benchmark/run.js accept <workspace> <task-id>\n'
    + '  node evals/benchmark/run.js summarize <runs/date-dir>\n',
  );
  process.exit(2);
}
