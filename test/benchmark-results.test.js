'use strict';

// The benchmark's results table is quoted from `run.js summarize`, never typed. Hand-
// copied figures drifted on every review of story 11-03 (a round-trip total, a test
// count, added-line figures), and a result nobody can re-derive is not a result. So
// the document's table must be byte-for-byte what the committed raw runs produce,
// and the summary must move when a raw run does.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'evals', 'benchmark', 'run.js');
const RUNS = path.join(ROOT, 'evals', 'benchmark', 'runs', '2026-10-17');
const DOC = path.join(ROOT, 'docs', 'experiments', 'reliability-benchmark.md');

function summarize(dir) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [RUN, 'summarize', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function copyOfRuns(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-bench-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(RUNS, dir, { recursive: true });
  return dir;
}

test('the results table in the experiment document is the summary of the committed runs', () => {
  const doc = fs.readFileSync(DOC, 'utf8');
  const block = doc.match(/<!-- summarize:begin -->\n([\s\S]*?)<!-- summarize:end -->/);

  assert.ok(block, 'the document has no summarize:begin/end block');
  assert.strictEqual(block[1], summarize(RUNS).output, 'regenerate it with: node evals/benchmark/run.js summarize evals/benchmark/runs/2026-10-17');
});

test('the summary reports first-pass, round-trips, cost and spec lines from the raw files', () => {
  const { code, output } = summarize(RUNS);

  assert.strictEqual(code, 0);
  assert.match(output, /^\| \*\*Total\*\* \| vanilla \| 4\/5 \| 1 \| .* \| \$0\.97 \| 217s \| 124 \|$/m);
  assert.match(output, /^\| \*\*Total\*\* \| coding-flow \| 3\/5 \| 2 \| .* \| \$3\.36 \| 547s \| 417 \|$/m);
  assert.match(output, /^\| 5 cross-module \| coding-flow \| no \| 1 \|/m);
});

test('changing a raw run changes the summary', (t) => {
  const dir = copyOfRuns(t);
  const before = summarize(dir).output;

  // Task 1, vanilla: make its first acceptance fail and add the re-prompt's exit.
  fs.writeFileSync(path.join(dir, '01-fix-A', 'exit-0'), '1\n');
  fs.writeFileSync(path.join(dir, '01-fix-A', 'exit-1'), '0\n');
  const after = summarize(dir).output;

  assert.notStrictEqual(after, before);
  assert.match(after, /^\| 1 fix \| vanilla \| no \| 1 \|/m);
  assert.match(after, /^\| \*\*Total\*\* \| vanilla \| 3\/5 \| 2 \|/m);
});

test('a directory with no runs is refused, not summarised as zeros', (t) => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-bench-empty-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));

  const { code, output } = summarize(empty);
  assert.strictEqual(code, 2);
  assert.match(output, /no <task>-<arm> directories/);
});
