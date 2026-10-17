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
const skipOnWindows = process.platform !== 'win32' ? false : 'the script and its fake hosts are bash (Linux/macOS only)';

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

test('smoke-hosts: no host available => every case skipped, exit 3 (nothing was run, not a pass)', { skip: skipOnWindows }, () => {
  const { status, rows, out } = run({});
  assert.strictEqual(status, 3, out);
  assert.strictEqual(Object.keys(rows).length, 6);
  assert.ok(Object.values(rows).every((v) => v === 'skipped'), out);
});

test('smoke-hosts: a host that writes .env => WRITTEN, exit 1', { skip: skipOnWindows }, (t) => {
  const bin = fake(tmp(t), 'claude', `printf 'A=1\\n' > .env`);
  const { status, rows, out } = run({ CLAUDE_BIN: bin });
  assert.strictEqual(status, 1, out);
  assert.strictEqual(rows['claude/write'], 'WRITTEN', out);
  assert.strictEqual(rows['claude/shell'], 'WRITTEN', out);
});

test('smoke-hosts: every case that ran refused => exit 0', { skip: skipOnWindows }, (t) => {
  const refusing = fake(tmp(t), 'claude', `echo '{"tool":"Write","path":".env"}' >> .coding-flow/denials.jsonl`);
  const { status, rows, out } = run({ CLAUDE_BIN: refusing });
  assert.strictEqual(status, 0, out);
  assert.strictEqual(rows['claude/write'], 'refused', out);
  assert.strictEqual(rows['claude/shell'], 'refused', out);
  assert.strictEqual(rows['opencode/write'], 'skipped', out);
});

test('smoke-hosts: a denial for another path is not a refusal of .env', { skip: skipOnWindows }, (t) => {
  const other = fake(tmp(t), 'claude', `echo '{"tool":"Write","path":".envrc","reason":"not .env"}' >> .coding-flow/denials.jsonl`);
  const { status, rows, out } = run({ CLAUDE_BIN: other });
  assert.strictEqual(status, 3, out);
  assert.strictEqual(rows['claude/write'], 'inconclusive', out);
});

test('smoke-hosts: a denial logged and no .env => refused; no attempt => inconclusive, exit 3', { skip: skipOnWindows }, (t) => {
  const dir = tmp(t);
  const refusing = fake(dir, 'claude', `echo '{"tool":"Write","path":".env"}' >> .coding-flow/denials.jsonl`);
  const silent = fake(dir, 'opencode', 'echo "I would rather not."');
  const { status, rows, out } = run({ CLAUDE_BIN: refusing, OPENCODE_BIN: silent });
  assert.strictEqual(status, 3, out);
  assert.strictEqual(rows['claude/write'], 'refused', out);
  assert.strictEqual(rows['opencode/write'], 'inconclusive', out);
  // The host's own output says why it never tried; the temp dir is gone afterwards.
  assert.match(out, /opencode\/write inconclusive[^\n]*\n {2}I would rather not\./, out);
});

test('smoke-hosts: no host sees the global config (a global guard would mask the project)', { skip: skipOnWindows }, (t) => {
  const dir = tmp(t);
  const globalConfig = path.join(dir, 'real-config');
  // Each fake writes .env only when it could read the global config — i.e. when a
  // globally installed guard could be the one answering. Claude reads user settings
  // unless --setting-sources leaves them out; OpenCode, the caller's XDG_CONFIG_HOME.
  const claude = fake(dir, 'claude', `case " $* " in *" --setting-sources project,local "*) ;; *) printf 'A=1\\n' > .env ;; esac`);
  const opencodeBody = `[ "\${XDG_CONFIG_HOME:-}" = "${globalConfig}" ] && printf 'A=1\\n' > .env; exit 0`;
  const opencode = fake(dir, 'opencode', opencodeBody);
  const opencode2 = fake(dir, 'opencode2', opencodeBody);
  const { status, rows, out } = run({
    CLAUDE_BIN: claude, OPENCODE_BIN: opencode, OPENCODE2_BIN: opencode2, XDG_CONFIG_HOME: globalConfig,
  });
  assert.strictEqual(status, 3, out);
  for (const host of ['claude', 'opencode', 'opencode2']) assert.strictEqual(rows[`${host}/write`], 'inconclusive', out);
});

test('smoke-hosts: a project that cannot be installed => ERROR, exit 2 (never a silent pass)', { skip: skipOnWindows }, (t) => {
  const dir = tmp(t);
  const bin = fake(dir, 'claude', 'exit 0');
  fake(dir, 'git', 'exit 1'); // first on PATH: the throwaway project cannot be created
  const { status, rows, out } = run({ CLAUDE_BIN: bin, PATH: `${dir}:${process.env.PATH}` });
  assert.strictEqual(status, 2, out);
  assert.strictEqual(rows['claude/write'], 'ERROR', out);
});
