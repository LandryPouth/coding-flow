'use strict';

// `ai-flow report` is the return channel: the file a user who is not the author
// sends back instead of describing what broke. Two properties decide whether it
// is usable — it must contain the failure, and it must not contain the person.
// Both are tested here, and the redaction test asserts by difference against
// `--raw` so it cannot pass by producing an empty report.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

// Assembled at runtime rather than written out. The guard refuses to write an
// AWS key shape to disk, the pattern is `precision: "exact"` so the allowlist
// does not apply to it, and this file needs one to prove the guard catches it.
// Logged in docs/DOGFOODING.md: the tool cannot currently author its own
// security fixtures.
const FAKE_AWS_KEY = `AKIA${'IOSFODNN7EXAMPLE'}`;

function project(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(cwd, args) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function guard(cwd, payload) {
  try {
    execFileSync(process.execPath, [CLI, 'guard'], {
      cwd,
      input: JSON.stringify(payload),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
}

// A red verify carrying an absolute path in its output, which is exactly the
// shape the real harness writes.
function writeRedVerify(dir, absolutePath) {
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'runs', '2026-08-18T10-00-00-000Z-verify.json'),
    JSON.stringify({
      generatedAt: '2026-08-18T10:00:00.000Z',
      root: dir,
      story: 'epics/epic-01-x/story-01-01-y',
      ok: false,
      results: [
        {
          command: 'npm test',
          exitCode: 1,
          ok: false,
          durationMs: 4200,
          stdoutTail: `FAIL src/cart.test.ts:14 expected 3 got 0\nError: thrown at ${absolutePath}/src/cart.ts:9`,
          stderrTail: '',
        },
      ],
    }),
  );
}

test('the report carries the failure', (t) => {
  const dir = project(t, 'report-fail');
  writeRedVerify(dir, dir);

  const { code, output } = run(dir, ['report']);

  assert.equal(code, 0);
  assert.match(output, /npm test/, 'the failing command is named');
  assert.match(output, /exit 1/, 'the exit code is named');
  assert.match(output, /expected 3 got 0/, 'the line that explains the failure survives');
  assert.match(output, /Verify runs: \*\*1\*\* \(0 green, 1 red\)/);
});

test('the report does not carry the person', (t) => {
  const dir = project(t, 'report-redact');
  writeRedVerify(dir, dir);

  const redacted = run(dir, ['report']).output;
  const raw = run(dir, ['report', '--raw']).output;

  // Asserted by difference: the raw form must contain what the default strips,
  // otherwise this test would also pass on an empty report.
  assert.ok(raw.includes(dir), 'the raw report keeps the absolute path');
  assert.ok(!redacted.includes(dir), 'the default report strips the absolute path');

  const user = path.basename(os.homedir() || '');
  if (user && user.length > 2 && raw.includes(user)) {
    assert.ok(!redacted.includes(user), 'the default report strips the username');
  }

  // Stripping must not cost the diagnosis.
  assert.match(redacted, /expected 3 got 0/, 'redaction keeps the failure readable');
});

test('a guard denial reaches the report, and the secret never does', (t) => {
  const dir = project(t, 'report-denial');
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const code = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'src', 'cfg.js'), content: `const k = '${FAKE_AWS_KEY}';` },
    cwd: dir,
  });
  assert.equal(code, 2, 'the guard must refuse a secret');

  const report = run(dir, ['report']).output;

  assert.match(report, /Guard denials \(1\)/, 'the denial is counted');
  assert.match(report, /src\/cfg\.js/, 'the path that was blocked is named');
  assert.ok(!report.includes(FAKE_AWS_KEY), 'the matched secret is never written down');

  // Same guarantee in the log the report reads from, not just in the rendering.
  const denials = fs.readFileSync(path.join(dir, '.coding-flow', 'denials.jsonl'), 'utf8');
  assert.ok(!denials.includes(FAKE_AWS_KEY), 'the denial log never stores the secret either');
  assert.match(denials, /AWS access key/, 'it stores the name of the pattern instead');
});

test('recording a denial never changes what the guard decides', (t) => {
  const dir = project(t, 'report-nonblocking');
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  // A log path that cannot be appended to must not turn a refusal into a crash,
  // nor an allow into a refusal: diagnostics are best-effort by design, because
  // they run inside a security decision.
  fs.mkdirSync(path.join(dir, '.coding-flow', 'denials.jsonl'), { recursive: true });

  assert.equal(
    guard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, '.env'), content: 'A=1' },
      cwd: dir,
    }),
    2,
    'the refusal survives an unwritable log',
  );

  assert.equal(
    guard(dir, {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'src', 'ok.js'), content: 'export const a = 1;' },
      cwd: dir,
    }),
    0,
    'the allow survives an unwritable log',
  );
});

test('the report works on a project that has done nothing yet', (t) => {
  const dir = project(t, 'report-empty');

  const { code, output } = run(dir, ['report']);

  assert.equal(code, 0, 'an empty project still produces a sendable file');
  assert.match(output, /Guard denials \(0\)/);
  assert.match(output, /None recorded/);
});

test('--out writes the file the user is meant to send', (t) => {
  const dir = project(t, 'report-out');
  writeRedVerify(dir, dir);

  const { code, output } = run(dir, ['report', '--out', 'coding-flow-report.md']);

  assert.equal(code, 0);
  assert.match(output, /Report written to coding-flow-report\.md/);
  assert.match(fs.readFileSync(path.join(dir, 'coding-flow-report.md'), 'utf8'), /npm test/);
});

// --- naming the failure, not the noise around it ------------------------------
//
// Found by running `report` on this repo's own red run. The tail filter matched
// /fail/, node:test names tests in prose, and prose says "fails": the report led
// with `ok 395 - verify in an uninitialised directory fails cleanly` — a PASSING
// line — while the actual failure was nowhere on the page.

function writeVerifyWithOutput(dir, results) {
  fs.writeFileSync(
    path.join(dir, '.coding-flow', 'runs', '2026-08-18T11-00-00-000Z-verify.json'),
    JSON.stringify({
      generatedAt: '2026-08-18T11:00:00.000Z',
      root: dir,
      ok: false,
      results,
    }),
  );
}

test('a passing line whose test name contains "fail" is not reported as a failure', (t) => {
  const dir = project(t, 'report-passing-line');
  writeVerifyWithOutput(dir, [
    {
      command: 'npm test',
      exitCode: 1,
      ok: false,
      durationMs: 100,
      stdoutTail: [
        'ok 395 - verify in an uninitialised directory fails cleanly',
        '# Subtest: worktree remove refuses a dirty worktree',
        'not ok 396 - the cart totals VAT',
        "  AssertionError: expected 3 got 0",
        '# fail 1',
      ].join('\n'),
      stderrTail: '',
    },
  ]);

  const { output } = run(dir, ['report']);

  assert.match(output, /not ok 396 - the cart totals VAT/, 'the real failure must be in the file');
  assert.match(output, /expected 3 got 0/);
  assert.doesNotMatch(output, /ok 395/, 'a pass must not be listed under failures');
  assert.doesNotMatch(output, /# Subtest:/, 'nor must a progress line');
});

test('a zero counter is not a failure, a non-zero one is', (t) => {
  const dir = project(t, 'report-counters');
  writeVerifyWithOutput(dir, [
    {
      command: 'npm test',
      exitCode: 1,
      ok: false,
      durationMs: 100,
      stdoutTail: ['# fail 0', '# errors 0', 'not ok 12 - boom', '# fail 1'].join('\n'),
      stderrTail: '',
    },
  ]);

  const { output } = run(dir, ['report']);

  assert.match(output, /not ok 12 - boom/);
  assert.match(output, /# fail 1/, 'the count of failures is worth keeping');
  assert.doesNotMatch(output, /# fail 0/, 'a zero count says nothing failed');
});

test('failureLines recorded at capture time win over the truncated tail', (t) => {
  const dir = project(t, 'report-failurelines');
  writeVerifyWithOutput(dir, [
    {
      command: 'npm test',
      exitCode: 1,
      ok: false,
      durationMs: 100,
      // What the harness now records: chosen from the whole stream, before all
      // but the last 4 KB was discarded.
      failureLines: ['not ok 42 - the discount applies twice', '  AssertionError: expected 10 got 20'],
      // What survives in the tail of a verbose runner: the summary, and nothing
      // that says which test broke.
      stdoutTail: '# tests 410\n# pass 409\n# fail 1\n',
      stderrTail: '',
    },
  ]);

  const { output } = run(dir, ['report']);

  assert.match(output, /the discount applies twice/, 'the recorded lines are what the reader needs');
  assert.match(output, /expected 10 got 20/);
});

test('a failure that printed no recognisable reason still shows its output', (t) => {
  const dir = project(t, 'report-silent');
  writeVerifyWithOutput(dir, [
    {
      command: 'make build',
      exitCode: 2,
      ok: false,
      durationMs: 100,
      stdoutTail: 'linking objects\nwriting artifact\n',
      stderrTail: '',
    },
  ]);

  const { output } = run(dir, ['report']);

  assert.match(output, /writing artifact/, 'a silent failure is itself the signal, so the tail goes in');
});
