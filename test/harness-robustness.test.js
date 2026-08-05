'use strict';

// What `verify` claims versus what it actually established. Four defects found on
// a real monorepo, all of the same family as the brownfield ones: the tool
// reported a state it had not established.
//
// - Run from a subdirectory, it resolved the config against that subdirectory,
//   silently swapped the declared commands for whatever package.json held, and
//   filed the evidence under the wrong root.
// - A passing command whose output exceeded the capture buffer was reported as
//   `exit 127` — a green suite recorded as a red proof.
// - A crash reached the user as a raw Node stack trace.
// - Re-running an unchanged story re-executed the whole suite every time.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

// spawnSync, not execFileSync: the relocated-root notice goes to stderr so that
// `--json` stays parseable, and execFileSync only surfaces stderr when the command
// fails. A helper that drops stderr on success cannot see the notice at all.
function run(cwd, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  return {
    code: result.status ?? 1,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    stdout: result.stdout || '',
  };
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

// A project with a real story and a real, declared validation command. Committed,
// because the freshness token — and therefore the cache — is a git primitive.
function makeProject(t, prefix, { commands = ['node -e "process.exit(0)"'] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(run(dir, ['init']).code, 0);

  const storyDir = path.join(dir, 'epics', 'epic-01-demo', 'story-01-01-demo');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Spec\n');
  fs.writeFileSync(path.join(storyDir, 'plan.md'), '# Plan\n');
  fs.writeFileSync(path.join(storyDir, 'tasks.md'), '# Tasks\n');

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands, quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'initial']);

  return { dir, story: 'epics/epic-01-demo/story-01-01-demo' };
}

function latestVerify(dir) {
  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const names = fs.readdirSync(runsDir).filter((n) => n.endsWith('-verify.json')).sort();
  return JSON.parse(fs.readFileSync(path.join(runsDir, names[names.length - 1]), 'utf8'));
}

test('verify from a subdirectory uses the project config, not the subdirectory', (t) => {
  const { dir, story } = makeProject(t, 'root', { commands: ['node -e "process.exit(0)"'] });

  // A workspace member with its own package.json and its own scripts — the exact
  // shape that made the tool drop the declared `tsc` and run `apps/web`'s lint.
  const member = path.join(dir, 'apps', 'web');
  fs.mkdirSync(member, { recursive: true });
  fs.writeFileSync(
    path.join(member, 'package.json'),
    JSON.stringify({ name: 'web', scripts: { test: 'node -e "process.exit(1)"' } }, null, 2),
  );

  const { code, output } = run(member, ['verify', '--story', story]);
  assert.equal(code, 0, output);

  const evidence = latestVerify(dir);
  assert.equal(fs.realpathSync(evidence.root), fs.realpathSync(dir), 'evidence filed under the wrong root');
  assert.equal(evidence.commandSource, 'config', 'the declared commands were replaced by package.json scripts');
  assert.equal(evidence.story, story);
});

test('a relocated root is announced, never silent', (t) => {
  const { dir, story } = makeProject(t, 'root-notice');
  const member = path.join(dir, 'apps', 'web');
  fs.mkdirSync(member, { recursive: true });

  const { output } = run(member, ['verify', '--story', story]);
  assert.match(output, /project root/i);

  // stderr, so a --json consumer still gets parseable stdout.
  const { stdout } = run(member, ['verify', '--story', story, '--json', '--no-cache']);
  assert.doesNotThrow(() => JSON.parse(stdout));
});

test('verify names the source of the commands it ran', (t) => {
  const { dir, story } = makeProject(t, 'source');

  const { output } = run(dir, ['verify', '--story', story]);
  // The silent swap from config to package.json is how a verify ends up proving
  // less than it claims. The source belongs in the human report, not only in JSON.
  assert.match(output, /Commands from: config/);
});

test('a passing command that outprints the buffer is a tool error, not a failure', (t) => {
  const { dir, story } = makeProject(t, 'overflow', {
    commands: ['node -e "console.log(\'x\'.repeat(200000)); process.exit(0)"'],
  });

  const { code, output } = run(dir, ['verify', '--story', story], {
    CODING_FLOW_MAX_OUTPUT_BYTES: '1024',
  });

  assert.equal(code, 1, 'an unobservable command cannot count as proof');
  assert.match(output, /tool error/i);
  assert.doesNotMatch(output, /exit 127/, 'a fabricated exit code misreports a passing suite as broken');

  const evidence = latestVerify(dir);
  assert.equal(evidence.results[0].exitCode, null, 'the real exit code was never observed');
  assert.match(evidence.results[0].toolError, /could not be captured/);
});

test('an unchanged story is not re-verified', (t) => {
  const { dir, story } = makeProject(t, 'cache');

  const first = run(dir, ['verify', '--story', story]);
  assert.equal(first.code, 0, first.output);
  const runsAfterFirst = fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).length;

  const second = run(dir, ['verify', '--story', story]);
  assert.equal(second.code, 0, second.output);
  assert.match(second.output, /already proved/);

  // The reuse must not fabricate a second evidence: a proof that records a run
  // which never happened is the one thing this tool cannot do.
  assert.equal(fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).length, runsAfterFirst);
});

test('--no-cache re-executes and files a fresh proof', (t) => {
  const { dir, story } = makeProject(t, 'cache-off');

  run(dir, ['verify', '--story', story]);
  const before = fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).length;

  const { code, output } = run(dir, ['verify', '--story', story, '--no-cache']);
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /already proved/);
  assert.equal(fs.readdirSync(path.join(dir, '.coding-flow', 'runs')).length, before + 1);
});

test('editing tracked source invalidates the cached proof', (t) => {
  const { dir, story } = makeProject(t, 'cache-edit');

  run(dir, ['verify', '--story', story]);
  fs.writeFileSync(path.join(dir, 'docs', 'conventions.md'), '# changed\n');
  git(dir, ['add', '-A']);

  const { output } = run(dir, ['verify', '--story', story]);
  assert.doesNotMatch(output, /already proved/, 'the proof no longer describes this code');
});

test('a new untracked file invalidates the cached proof', (t) => {
  const { dir, story } = makeProject(t, 'cache-untracked');

  run(dir, ['verify', '--story', story]);
  // The freshness token ignores untracked files by design; the cache must not,
  // or a brand-new source file would be waved through by a stale green.
  fs.writeFileSync(path.join(dir, 'new-source.js'), 'module.exports = 1;\n');

  const { output } = run(dir, ['verify', '--story', story]);
  assert.doesNotMatch(output, /already proved/);
});

test('changing the declared commands invalidates the cached proof', (t) => {
  const { dir, story } = makeProject(t, 'cache-commands');

  run(dir, ['verify', '--story', story]);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation.commands = ['node -e "process.exit(0)"', 'node -e "process.exit(0)"'];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const { output } = run(dir, ['verify', '--story', story]);
  assert.doesNotMatch(output, /already proved/, 'a proof of two commands is not a proof of three');
});

test('a red verify is never served from cache', (t) => {
  const { dir, story } = makeProject(t, 'cache-red', {
    commands: ['node -e "process.exit(1)"'],
  });

  assert.equal(run(dir, ['verify', '--story', story]).code, 1);

  const second = run(dir, ['verify', '--story', story]);
  assert.equal(second.code, 1);
  assert.doesNotMatch(second.output, /already proved/);
});

test('a crash reports as a bug, not as a stack trace', (t) => {
  const { dir, story } = makeProject(t, 'crash');

  // A file where the evidence directory belongs: `writeVerifyEvidence` calls
  // mkdirSync and gets EEXIST. Any unhandled throw used to reach the user as a
  // raw Node stack trace, which agents driving the CLI reported as "the tool
  // errored internally" — indistinguishable, from the outside, from a red suite.
  fs.rmSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true, force: true });
  fs.writeFileSync(path.join(dir, '.coding-flow', 'runs'), 'blocking file\n');

  const { code, output } = run(dir, ['verify', '--story', story]);

  assert.equal(code, 1);
  assert.doesNotMatch(output, /at Object\.mkdirSync|node:fs:\d+/, 'raw stack trace reached the user');
  assert.match(output, /not a validation failure/, 'the report must separate a tool bug from a red suite');
});
