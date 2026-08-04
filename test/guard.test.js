'use strict';

// Tests of the `guard` PreToolUse hook: deterministic refusal (exit 2) on a
// blocked path or a secret in the content, allow (exit 0) otherwise, fail-open on
// empty input / non-write tool, and idempotent wiring into .claude/settings.json.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
}

function project(t, prefix) {
  const dir = tmp(prefix);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Pass the hook payload on stdin; returns { code, stdout, stderr }.
function guard(cwd, payload, args = []) {
  const input = payload === null ? '' : JSON.stringify(payload);
  try {
    const stdout = execFileSync(process.execPath, [CLI, 'guard', ...args], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

function runCli(cwd, args) {
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

// Runs a hook command the way Claude Code would: `sh -c "<command>"` with the
// hook payload piped on stdin. Returns { code, stdout, stderr }.
function runHook(cwd, command, payload) {
  const input = payload === null ? '' : JSON.stringify(payload);
  try {
    const stdout = execFileSync('sh', ['-c', command], {
      cwd,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('guard denies writing a .env file (exit 2, deny decision)', (t) => {
  const dir = project(t, 'guard-env');
  const res = guard(dir, { tool_name: 'Write', tool_input: { file_path: '.env', content: 'X=1' } });
  assert.equal(res.code, 2, 'a blocked path must be refused with exit 2');
  const decision = JSON.parse(res.stdout);
  assert.equal(decision.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(res.stderr, /guard/);
});

test('guard denies writing a .pem key anywhere', (t) => {
  const dir = project(t, 'guard-pem');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'config/tls/server.pem', content: 'x' },
  });
  assert.equal(res.code, 2);
});

test('guard denies content that contains a secret', (t) => {
  const dir = project(t, 'guard-secret');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/config.ts', content: 'const k = "sk_live_0123456789abcdefghijkl";' },
  });
  assert.equal(res.code, 2, 'a secret in the content must be refused');
  assert.match(JSON.parse(res.stdout).systemMessage, /secret/i);
});

test('guard allows a normal source write', (t) => {
  const dir = project(t, 'guard-ok');
  const res = guard(
    dir,
    { tool_name: 'Write', tool_input: { file_path: 'src/index.ts', content: 'export const x = 1;' } },
    ['--json'],
  );
  assert.equal(res.code, 0);
  assert.equal(JSON.parse(res.stdout).hookSpecificOutput.permissionDecision, 'allow');
});

test('guard allows .env.example (safe example)', (t) => {
  const dir = project(t, 'guard-example');
  const res = guard(dir, {
    tool_name: 'Write',
    tool_input: { file_path: '.env.example', content: 'API_KEY=' },
  });
  assert.equal(res.code, 0);
});

test('guard is fail-open on empty stdin', (t) => {
  const dir = project(t, 'guard-empty');
  const res = guard(dir, null);
  assert.equal(res.code, 0, 'empty stdin must never block');
});

test('guard ignores non-write tools', (t) => {
  const dir = project(t, 'guard-read');
  const res = guard(dir, { tool_name: 'Read', tool_input: { file_path: '.env' } });
  assert.equal(res.code, 0, 'reading .env is not our business — allow');
});

test('guard denies a secret inside a MultiEdit new_string', (t) => {
  const dir = project(t, 'guard-multiedit');
  const res = guard(dir, {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: 'src/a.ts',
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'AKIAABCDEFGHIJKLMNOP' },
      ],
    },
  });
  assert.equal(res.code, 2);
});

test('init wires the guard hook into .claude/settings.json, idempotently', (t) => {
  const dir = project(t, 'guard-init');
  runCli(dir, ['init']);
  const settingsPath = path.join(dir, '.claude', 'settings.json');
  assert.ok(fs.existsSync(settingsPath), 'settings.json must be created');

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const pre = settings.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1, 'one PreToolUse hook is wired');
  assert.match(pre[0].hooks[0].command, /guard/);

  // Second init: no duplication.
  const second = runCli(dir, ['init']);
  assert.match(second.output, /already wired/);
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(after.hooks.PreToolUse.length, 1, 'the hook must not be duplicated');
});

test('init --no-guard skips wiring the hook', (t) => {
  const dir = project(t, 'guard-noguard');
  runCli(dir, ['init', '--no-guard']);
  assert.ok(
    !fs.existsSync(path.join(dir, '.claude', 'settings.json')),
    '--no-guard must not create settings.json',
  );
});

test('init merges the guard hook into an existing settings.json without clobbering', (t) => {
  const dir = project(t, 'guard-merge');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] },
  };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(existing, null, 2));

  runCli(dir, ['init']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(settings.permissions.allow, ['Bash(ls:*)'], 'the existing settings are preserved');
  assert.equal(settings.hooks.PreToolUse.length, 2, 'our hook is added alongside the existing one');
  assert.ok(settings.hooks.PreToolUse.some((e) => /guard/.test(e.hooks[0].command)));
});

test('the wired hook runs the resolved binary directly (fast path, no npx)', (t) => {
  const dir = project(t, 'guard-fastpath');
  runCli(dir, ['init']);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  const command = settings.hooks.PreToolUse[0].hooks[0].command;

  // The emitted command spawns a locally-resolved binary, not npx, in the
  // happy path: R='<real path>'; if [ -f "$R" ]; then node "$R" guard; else …
  assert.match(command, /^R='/);
  assert.match(command, /if \[ -f "\$R" \]; then node "\$R" guard/);

  // allow: normal source write
  const allow = runHook(dir, command, {
    tool_name: 'Write',
    tool_input: { file_path: 'src/index.ts', content: 'export const x = 1;' },
  });
  assert.equal(allow.code, 0, 'the fast path must allow a normal write');

  // deny: blocked path
  const deny = runHook(dir, command, {
    tool_name: 'Write',
    tool_input: { file_path: '.env', content: 'X=1' },
  });
  assert.equal(deny.code, 2, 'the fast path must deny a blocked path');
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('init upgrades an existing npx-based guard hook to the resolved binary', (t) => {
  const dir = project(t, 'guard-upgrade');
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  const existing = {
    permissions: { allow: ['Bash(ls:*)'] },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Write|Edit',
          hooks: [
            { type: 'command', command: 'npx --yes @landry_pouth/coding-flow@0.4.0 guard', timeout: 30 },
          ],
        },
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(existing, null, 2));

  const res = runCli(dir, ['init']);
  assert.match(res.output, /upgraded/);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 2, 'the hook is upgraded in place, never duplicated');
  assert.ok(settings.permissions.allow.includes('Bash(ls:*)'), 'existing permissions are preserved');
  assert.ok(
    settings.hooks.PreToolUse.some((e) => e.matcher === 'Bash' && e.hooks[0].command === 'echo hi'),
    'unrelated hooks are untouched',
  );

  const guardEntry = settings.hooks.PreToolUse.find((e) => /guard/.test(e.hooks[0].command));
  assert.equal(guardEntry.matcher, 'Write|Edit', 'the user matcher is preserved');
  assert.equal(guardEntry.hooks[0].timeout, 60, 'the timeout is updated to the current value');
  assert.match(guardEntry.hooks[0].command, /^R='/, 'the command is replaced with the fast path');
  assert.match(
    guardEntry.hooks[0].command,
    /coding-flow@0\.4\.0 guard/,
    'the npx fallback stays pinned to the installed version',
  );
});
