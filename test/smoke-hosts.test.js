'use strict';

// `scripts/smoke-hosts.sh` drives real agent hosts, which a test cannot. What it
// can pin is the part that must never lie: the verdict and exit code it derives
// from what a host left behind. Fake hosts (shell scripts standing in for the
// binary) play each outcome without a model.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const script = path.join(__dirname, '..', 'scripts', 'smoke-hosts.sh');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-hosts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fake(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  return file;
}

function run(env) {
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_BIN: '/nonexistent', OPENCODE_BIN: '/nonexistent', OPENCODE2_BIN: '', ...env },
  });
  const rows = Object.fromEntries(
    result.stdout
      .split('\n')
      .filter((line) => /^(claude|opencode2?)\s/.test(line))
      .map((line) => {
        const [host, kase, verdict] = line.trim().split(/\s+/);
        return [`${host}/${kase}`, verdict];
      }),
  );
  return { status: result.status, rows, out: result.stdout + result.stderr };
}

test('smoke-hosts: no host available => every case skipped, exit 0', () => {
  const { status, rows, out } = run({});
  assert.strictEqual(status, 0, out);
  assert.strictEqual(Object.keys(rows).length, 6);
  assert.ok(Object.values(rows).every((v) => v === 'skipped'), out);
});

test('smoke-hosts: a host that writes .env => WRITTEN, exit 1', (t) => {
  const bin = fake(tmp(t), 'claude', `printf 'A=1\\n' > .env`);
  const { status, rows, out } = run({ CLAUDE_BIN: bin });
  assert.strictEqual(status, 1, out);
  assert.strictEqual(rows['claude/write'], 'WRITTEN', out);
  assert.strictEqual(rows['claude/shell'], 'WRITTEN', out);
});

test('smoke-hosts: a denial logged and no .env => refused; no attempt => inconclusive', (t) => {
  const dir = tmp(t);
  const refusing = fake(dir, 'claude', `echo '{"tool":"Write","path":".env"}' >> .coding-flow/denials.jsonl`);
  const silent = fake(dir, 'opencode', 'echo "I would rather not."');
  const { status, rows, out } = run({ CLAUDE_BIN: refusing, OPENCODE_BIN: silent });
  assert.strictEqual(status, 0, out);
  assert.strictEqual(rows['claude/write'], 'refused', out);
  assert.strictEqual(rows['opencode/write'], 'inconclusive', out);
});

test('smoke-hosts: OpenCode never sees the global config dir (a global guard would mask the project)', (t) => {
  const dir = tmp(t);
  const globalConfig = path.join(dir, 'real-config');
  // Writes .env only when it inherits the caller's XDG_CONFIG_HOME — i.e. when a
  // globally installed guard could be the one answering.
  const bin = fake(dir, 'opencode', `[ "\${XDG_CONFIG_HOME:-}" = "${globalConfig}" ] && printf 'A=1\\n' > .env; exit 0`);
  const { status, rows, out } = run({ OPENCODE_BIN: bin, XDG_CONFIG_HOME: globalConfig });
  assert.strictEqual(status, 0, out);
  assert.strictEqual(rows['opencode/write'], 'inconclusive', out);
});

test('smoke-hosts: a project that cannot be installed => ERROR, exit 2 (never a silent pass)', (t) => {
  const dir = tmp(t);
  const bin = fake(dir, 'claude', 'exit 0');
  fake(dir, 'git', 'exit 1'); // first on PATH: the throwaway project cannot be created
  const { status, rows, out } = run({ CLAUDE_BIN: bin, PATH: `${dir}:${process.env.PATH}` });
  assert.strictEqual(status, 2, out);
  assert.strictEqual(rows['claude/write'], 'ERROR', out);
});
