'use strict';

// A validation command's time limit is configurable (globally or per command),
// a timeout names the knob, and a different limit is a different proof.

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

function project(t, validation) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-timeout-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);
  fs.writeFileSync(path.join(dir, 'slow.js'), 'setTimeout(() => {}, 2000);\n');
  fs.writeFileSync(path.join(dir, 'fast.js'), "console.log('fast');\n");
  const file = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.validation = { quality: [], ...validation };
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  return dir;
}

const verifyJson = (dir) => {
  const res = run(dir, ['verify', '--no-cache', '--json']);
  return { ...res, evidence: JSON.parse(res.output) };
};

test('a global validation.timeoutMs kills a slow command and the output names the knob', (t) => {
  const dir = project(t, { commands: ['node slow.js'], timeoutMs: 500 });

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /timeout after 0\.5 s \(validation\.timeoutMs\)/);
});

test('the object form sets a limit for one command, string entries keep working', (t) => {
  const dir = project(t, {
    commands: ['node fast.js', { command: 'node slow.js', timeoutMs: 500 }],
  });

  const { evidence } = verifyJson(dir);

  assert.deepEqual(evidence.results.map((r) => r.command), ['node fast.js', 'node slow.js']);
  assert.equal(evidence.results[0].ok, true);
  assert.equal(evidence.results[1].timedOut, true);
  assert.equal(evidence.results[1].timeoutMs, 500);
});

test('a per-command limit wins over the global one, in quality too', (t) => {
  const dir = project(t, {
    commands: ['node fast.js'],
    quality: [{ command: 'node slow.js', timeoutMs: 5000 }],
    timeoutMs: 500,
  });

  const { code, output } = verifyJson(dir);

  assert.equal(code, 0, output);
});

test('without a limit a command that finishes is untouched', (t) => {
  const dir = project(t, { commands: ['node fast.js'] });

  assert.equal(run(dir, ['verify']).code, 0);
});

test('a different limit is a different command contract', (t) => {
  const dir = project(t, { commands: ['node fast.js'] });
  const first = verifyJson(dir).evidence.commandsFingerprint;

  const file = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.validation.timeoutMs = 1200000;
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const second = verifyJson(dir).evidence.commandsFingerprint;

  assert.notEqual(first, second);
});

test('a per-command limit is part of the command contract too', (t) => {
  const dir = project(t, { commands: [{ command: 'node fast.js', timeoutMs: 5000 }] });
  const first = verifyJson(dir).evidence.commandsFingerprint;

  const file = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.validation.commands = [{ command: 'node fast.js', timeoutMs: 6000 }];
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  const second = verifyJson(dir).evidence.commandsFingerprint;

  assert.notEqual(first, second);
});

test('a malformed timeout is ignored and the command keeps the default limit', (t) => {
  const dir = project(t, {
    commands: [{ command: 'node fast.js', timeoutMs: 'soon' }],
    timeoutMs: -5,
  });

  const { code, evidence } = verifyJson(dir);

  assert.equal(code, 0);
  assert.deepEqual(evidence.results.map((r) => r.command), ['node fast.js']);
});

test('land sizes its lock for a raised command limit', () => {
  const { landLockTimeouts } = require('../bin/lib/worktree');
  const twentyMinutes = 20 * 60 * 1000;

  assert.ok(landLockTimeouts(1, twentyMinutes).staleMs > twentyMinutes);
});
