'use strict';

// Tests du hook PreToolUse `guard` : refus déterministe (exit 2) sur chemin
// bloqué ou secret dans le contenu, allow (exit 0) sinon, fail-open sur entrée
// vide / outil non-écrivain, et câblage idempotent dans .claude/settings.json.

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

// Passe le payload hook sur stdin ; renvoie { code, stdout, stderr }.
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

test('guard denies writing a .env file (exit 2, deny decision)', (t) => {
  const dir = project(t, 'guard-env');
  const res = guard(dir, { tool_name: 'Write', tool_input: { file_path: '.env', content: 'X=1' } });
  assert.equal(res.code, 2, 'un chemin bloqué doit être refusé avec exit 2');
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
  assert.equal(res.code, 2, 'un secret dans le contenu doit être refusé');
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
  assert.equal(res.code, 0, 'stdin vide ne doit jamais bloquer');
});

test('guard ignores non-write tools', (t) => {
  const dir = project(t, 'guard-read');
  const res = guard(dir, { tool_name: 'Read', tool_input: { file_path: '.env' } });
  assert.equal(res.code, 0, 'lire .env n’est pas notre affaire — allow');
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
  assert.ok(fs.existsSync(settingsPath), 'settings.json doit être créé');

  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const pre = settings.hooks.PreToolUse;
  assert.ok(Array.isArray(pre) && pre.length === 1, 'un hook PreToolUse est câblé');
  assert.match(pre[0].hooks[0].command, /guard/);

  // Deuxième init : pas de duplication.
  const second = runCli(dir, ['init']);
  assert.match(second.output, /already wired/);
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  assert.equal(after.hooks.PreToolUse.length, 1, 'le hook ne doit pas être dupliqué');
});

test('init --no-guard skips wiring the hook', (t) => {
  const dir = project(t, 'guard-noguard');
  runCli(dir, ['init', '--no-guard']);
  assert.ok(
    !fs.existsSync(path.join(dir, '.claude', 'settings.json')),
    '--no-guard ne doit pas créer settings.json',
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
  assert.deepEqual(settings.permissions.allow, ['Bash(ls:*)'], 'les réglages existants sont préservés');
  assert.equal(settings.hooks.PreToolUse.length, 2, 'notre hook est ajouté à côté de l’existant');
  assert.ok(settings.hooks.PreToolUse.some((e) => /guard/.test(e.hooks[0].command)));
});
