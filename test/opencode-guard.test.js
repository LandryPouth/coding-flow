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
  const plugin = await mod.default.server({ directory: dir });
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

// OpenCode launched from an IDE or a desktop entry often has no `node` on its
// PATH. A plugin that spawned `node` would then fail open in silence; it loads
// the guard in-process instead, so the deny holds with an empty PATH.
test('the plugin still refuses a blocked write when `node` is not on the PATH', (t) => {
  const dir = tmp(t, 'oc-nonode');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const copy = path.join(dir, 'plugin-under-test.mjs');
  fs.copyFileSync(path.join(dir, PLUGIN), copy);
  const script = [
    `const { default: plugin } = await import(${JSON.stringify(pathToFileURL(copy).href)});`,
    `const before = (await plugin.server({ directory: ${JSON.stringify(dir)} }))['tool.execute.before'];`,
    `try { await before({ tool: 'write' }, { args: { filePath: ${JSON.stringify(path.join(dir, '.env'))}, content: 'A=1' } }); console.log('ALLOWED'); }`,
    `catch (e) { console.log('BLOCKED ' + e.message); }`,
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: { PATH: '' },
    encoding: 'utf8',
  });
  assert.match(out, /^BLOCKED coding-flow guard: .*blocked harness path/);
});

test('a refusal tells the agent not to route around it; the denial log keeps only the reason', async (t) => {
  const dir = tmp(t, 'oc-advice');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const before = await loadHook(dir);
  await assert.rejects(
    before({ tool: 'write' }, { args: { filePath: path.join(dir, '.env'), content: 'A=1' } }),
    /blocked harness path.*Do not retry this under another name/,
  );
  // The Claude hook says the same through its own channel.
  const hook = require('node:child_process').spawnSync(process.execPath, [CLI, 'guard'], {
    cwd: dir,
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, '.env'), content: 'A=1' }, cwd: dir }),
    encoding: 'utf8',
  });
  assert.equal(hook.status, 2);
  assert.match(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecisionReason, /Do not retry this/);
  assert.doesNotMatch(fs.readFileSync(path.join(dir, '.coding-flow', 'denials.jsonl'), 'utf8'), /Do not retry/);
});

// OpenCode 2.x loads the default export and calls `setup(ctx)`, which registers
// the hook on `ctx.tool` with V2's argument names (`path`, `shell`, `patch`).
async function loadV2(dir) {
  const copy = path.join(dir, 'plugin-v2-under-test.mjs');
  fs.copyFileSync(path.join(dir, PLUGIN), copy);
  const mod = await import(pathToFileURL(copy).href);
  const hooks = [];
  await mod.default.setup({ location: { directory: dir }, tool: { hook: async (name, fn) => hooks.push({ name, fn }) } });
  return { mod, hooks };
}

test('the generated plugin refuses on the OpenCode 2.x entry with V2 argument names', async (t) => {
  const dir = tmp(t, 'oc-v2');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const { mod, hooks } = await loadV2(dir);

  assert.equal(mod.default.id, 'coding-flow.guard');
  assert.equal(typeof mod.default.server, 'function');
  assert.deepEqual(hooks.map((h) => h.name), ['execute.before']);
  const before = hooks[0].fn;

  await assert.rejects(before({ tool: 'write', input: { path: '.env', content: 'A=1' } }), /coding-flow guard: .*blocked harness path/);
  await assert.rejects(before({ tool: 'edit', input: { path: '.env', oldString: 'a', newString: 'x' } }), /blocked harness path/);
  await assert.rejects(before({ tool: 'shell', input: { command: 'echo A=1 > .env' } }), /blocked harness path/);
  await assert.rejects(
    before({ tool: 'patch', input: { patchText: '*** Begin Patch\n*** Add File: .env\n+A=1\n*** End Patch' } }),
    /blocked harness path/,
  );
  await assert.rejects(
    before({ tool: 'patch', input: { patchText: '*** Begin Patch\r\n*** Add File: .env\r\n+A=1\r\n*** End Patch' } }),
    /blocked harness path/,
    'a CRLF patch is still parsed',
  );
  await assert.rejects(before({ tool: 'write', input: { path: 'src/a.js', content: `k = "${SECRET}"` } }), /secret/i);

  // Harmless calls and unknown tools stay open.
  await before({ tool: 'write', input: { path: 'src/a.js', content: 'const a = 1;\n' } });
  await before({ tool: 'shell', input: { command: 'npm test' } });
  await before({ tool: 'mystery', input: { path: '.env' } });
});

test('setup returns quietly when OpenCode 1.x hands it a context without `tool`', async (t) => {
  const dir = tmp(t, 'oc-v2-partial');
  assert.equal(run(dir, ['init', '--opencode']).code, 0);
  const copy = path.join(dir, 'plugin-partial.mjs');
  fs.copyFileSync(path.join(dir, PLUGIN), copy);
  const mod = await import(pathToFileURL(copy).href);

  await mod.default.setup({ options: {} });
  await mod.default.setup(undefined);

  // The V1 entry keeps working from the same file.
  assert.equal(mod.CodingFlowGuard, undefined, 'one V1 entry only, or 1.x registers the guard twice');
  const before = (await mod.default.server({ directory: dir }))['tool.execute.before'];
  await assert.rejects(before({ tool: 'write' }, { args: { filePath: path.join(dir, '.env'), content: 'A=1' } }), /blocked harness path/);
});
