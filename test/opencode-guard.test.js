'use strict';

// The OpenCode guard is a plugin file, so what is worth testing is the
// observable: what init lays down (and what it refuses to), and — the part that
// matters — that the generated plugin, loaded the way OpenCode loads it and
// handed OpenCode-shaped tool calls, refuses a secret and lets a normal write
// through. No OpenCode binary needed: the plugin contract is one hook.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const PLUGIN = path.join('.opencode', 'plugins', 'coding-flow-guard.js');

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

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A secret built at runtime, so this file never contains a literal one.
const SECRET = `sk-${'proj'}-${'a'.repeat(40)}`;

// Loads the generated plugin and calls its hook as OpenCode does. The file is
// copied to .mjs only because Node needs the extension to treat it as ESM inside
// a throwaway directory; the content is byte-identical.
async function loadHook(dir) {
  const copy = path.join(dir, 'plugin-under-test.mjs');
  fs.copyFileSync(path.join(dir, PLUGIN), copy);
  const mod = await import(pathToFileURL(copy).href);
  const plugin = await mod.CodingFlowGuard({ directory: dir });
  return plugin['tool.execute.before'];
}

test('init lays the plugin down only when OpenCode is asked for or already used', (t) => {
  const plain = tmp(t, 'oc-plain');
  assert.equal(run(plain, ['init']).code, 0);
  assert.equal(fs.existsSync(path.join(plain, '.opencode')), false);

  const flagged = tmp(t, 'oc-flag');
  const res = run(flagged, ['init', '--opencode']);
  assert.equal(res.code, 0);
  assert.match(res.output, /Guard plugin \(OpenCode\): wired/);
  assert.equal(fs.existsSync(path.join(flagged, PLUGIN)), true);

  const detected = tmp(t, 'oc-detect');
  fs.writeFileSync(path.join(detected, 'opencode.json'), '{}');
  assert.equal(run(detected, ['init']).code, 0);
  assert.equal(fs.existsSync(path.join(detected, PLUGIN)), true);
});

test('--no-guard and --dry-run write nothing', (t) => {
  const noGuard = tmp(t, 'oc-noguard');
  assert.equal(run(noGuard, ['init', '--opencode', '--no-guard']).code, 0);
  assert.equal(fs.existsSync(path.join(noGuard, PLUGIN)), false);

  const dry = tmp(t, 'oc-dry');
  const res = run(dry, ['init', '--opencode', '--dry-run']);
  assert.match(res.output, /would create \.opencode\/plugins/);
  assert.equal(fs.existsSync(path.join(dry, '.opencode')), false);
});

test('a second run is a no-op and a plugin that is not ours is never overwritten', (t) => {
  const dir = tmp(t, 'oc-idem');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const first = fs.readFileSync(path.join(dir, PLUGIN), 'utf8');

  assert.match(run(dir, ['upgrade']).output, /OpenCode plugin already wired/);
  assert.equal(fs.readFileSync(path.join(dir, PLUGIN), 'utf8'), first);

  fs.writeFileSync(path.join(dir, PLUGIN), '// mine\nexport const X = async () => ({});\n');
  const res = run(dir, ['upgrade']);
  assert.match(res.output, /not ours/);
  assert.equal(fs.readFileSync(path.join(dir, PLUGIN), 'utf8'), '// mine\nexport const X = async () => ({});\n');
});

test('the generated plugin refuses a secret and a blocked path, and lets a normal write through', async (t) => {
  const dir = tmp(t, 'oc-e2e');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const before = await loadHook(dir);

  // Blocked path through OpenCode's `write`.
  await assert.rejects(
    before({ tool: 'write' }, { args: { filePath: path.join(dir, '.env'), content: 'A=1' } }),
    /blocked harness path/,
  );

  // Secret in content, through `write` and through `edit`.
  await assert.rejects(
    before({ tool: 'write' }, { args: { filePath: path.join(dir, 'src.js'), content: `k = "${SECRET}"` } }),
    /secret/i,
  );
  await assert.rejects(
    before({ tool: 'edit' }, { args: { filePath: path.join(dir, 'src.js'), oldString: 'a', newString: SECRET } }),
    /secret/i,
  );

  // Shell write form: `bash` is guarded like Claude's `Bash`.
  await assert.rejects(before({ tool: 'bash' }, { args: { command: 'echo A=1 > .env' } }), /blocked harness path/);

  // apply_patch: how GPT-family models edit in OpenCode. The secret rides in an
  // added line, the blocked path in the section header or a Move to.
  const patch = (body) => `*** Begin Patch\n${body}\n*** End Patch`;
  await assert.rejects(
    before({ tool: 'apply_patch' }, { args: { patchText: patch(`*** Add File: src.js\n+k = "${SECRET}"`) } }),
    /secret/i,
  );
  await assert.rejects(
    before({ tool: 'apply_patch' }, { args: { patchText: patch('*** Add File: .env\n+A=1') } }),
    /blocked harness path/,
  );
  await assert.rejects(
    before({ tool: 'apply_patch' }, { args: { patchText: patch('*** Update File: a.txt\n*** Move to: .env\n@@\n+x') } }),
    /blocked harness path/,
  );
  await before({ tool: 'apply_patch' }, { args: { patchText: patch('*** Add File: ok.js\n+const a = 1;') } });
  await before({ tool: 'apply_patch' }, { args: { patchText: patch('*** Delete File: old.txt') } });

  // The normal paths stay open — a guard that cries wolf gets turned off.
  await before({ tool: 'write' }, { args: { filePath: path.join(dir, 'src.js'), content: 'const a = 1;\n' } });
  await before({ tool: 'bash' }, { args: { command: 'npm test' } });
  await before({ tool: 'read' }, { args: { filePath: path.join(dir, '.env') } });

  // A refusal leaves the same trace as on Claude Code.
  assert.match(fs.readFileSync(path.join(dir, '.coding-flow', 'denials.jsonl'), 'utf8'), /\.env/);
});

test('doctor flags a project that uses OpenCode without the guard, and stays quiet once wired', (t) => {
  const dir = tmp(t, 'oc-doctor');
  assert.equal(run(dir, ['init']).code, 0);
  fs.writeFileSync(path.join(dir, 'opencode.json'), '{}');

  const missing = JSON.parse(run(dir, ['doctor', '--json']).output);
  assert.ok(missing.errors.some((e) => e.code === 'opencode_guard_not_wired'));

  assert.equal(run(dir, ['upgrade']).code, 0);
  const wired = JSON.parse(run(dir, ['doctor', '--json']).output);
  assert.equal(wired.errors.some((e) => /opencode/.test(e.code)), false);
  assert.equal(wired.warnings.some((w) => /opencode/.test(w.code)), false);
});

test('a project that uses OpenCode gets its own skills copy, whatever the Claude plugin says', (t) => {
  const dir = tmp(t, 'oc-skills');
  const res = run(dir, ['init', '--opencode']);
  assert.equal(res.code, 0);
  assert.equal(fs.existsSync(path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md')), true);
});
