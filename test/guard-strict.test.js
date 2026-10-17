'use strict';

// `mode: strict` turns "the guard could not check this" into a refusal, on both
// hosts; `standard` keeps allowing and logging it. Observable behaviour only:
// exit codes, thrown errors, doctor output.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const PLUGIN = path.join('.opencode', 'plugins', 'coding-flow-guard.js');

function project(t, mode) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-strict-')));
  fs.mkdirSync(path.join(dir, '.coding-flow'));
  if (mode) {
    fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ mode }));
  }
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(cwd, args, input) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      input: input === undefined ? '' : JSON.stringify({ cwd, ...input }),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: `${err.stdout || ''}`, stderr: `${err.stderr || ''}` };
  }
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const UNCHECKED = 'F=.env; echo A=1 > $F';

test('hook: strict refuses what it could not check, standard allows it', (t) => {
  const strict = cli(project(t, 'strict'), ['guard'], bash(UNCHECKED));
  assert.equal(strict.code, 2);
  assert.match(strict.stdout, /"permissionDecision":"deny"/);
  assert.match(strict.stdout, /not checked, refused in strict mode:/);

  assert.equal(cli(project(t, 'standard'), ['guard'], bash(UNCHECKED)).code, 0);
  assert.equal(cli(project(t), ['guard'], bash(UNCHECKED)).code, 0);
});

test('hook: an ordinary strict session is not refused', (t) => {
  const dir = project(t, 'strict');
  for (const call of [
    { tool_name: 'Read', tool_input: { file_path: 'src/a.js' } },
    { tool_name: 'Grep', tool_input: { pattern: 'x' } },
    { tool_name: 'Write', tool_input: { file_path: 'src/a.js', content: 'ok' } },
    bash('npm test'),
  ]) {
    assert.equal(cli(dir, ['guard'], call).code, 0, call.tool_name);
  }
});

test('hook: strict never locks out a write to harness.json because of strictness alone', (t) => {
  // A strict repo holding a nested project whose harness.json is broken: every write
  // from there is unchecked (its policy cannot be read), so strict refuses it — except
  // the write that repairs that file.
  const dir = project(t, 'strict');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  const nested = path.join(dir, 'pkg');
  fs.mkdirSync(path.join(nested, '.coding-flow'), { recursive: true });
  fs.writeFileSync(path.join(nested, '.coding-flow', 'harness.json'), '{ not json');
  const write = (file_path) => ({ cwd: nested, tool_name: 'Write', tool_input: { file_path, content: '{"mode":"standard"}' } });

  assert.equal(cli(nested, ['guard'], write('src/a.js')).code, 2);
  assert.equal(cli(nested, ['guard'], write('.coding-flow/harness.json')).code, 0);
});

test('an unreadable harness.json is the standard posture', (t) => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), '{ not json');
  assert.equal(cli(dir, ['guard'], bash(UNCHECKED)).code, 0);
});

test('doctor prints the posture for both modes', (t) => {
  for (const [mode, line] of [
    ['strict', 'guard: strict (unchecked writes are refused)'],
    ['standard', 'guard: standard (unchecked writes are allowed and logged)'],
  ]) {
    const dir = project(t, mode);
    assert.equal(cli(dir, ['init', '--minimal']).code, 0);
    fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ mode }));
    const out = cli(dir, ['doctor']);
    assert.ok(out.stdout.includes(line), `${mode}: ${out.stdout}`);
  }
});

// The plugin, loaded the way OpenCode loads it, with its binary gone and its
// fallback unable to run — the case where no guard can decide.
async function brokenPlugin(t, dir, directory = dir) {
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const source = fs
    .readFileSync(path.join(dir, PLUGIN), 'utf8')
    .replace(/const BINARY = .*;/, 'const BINARY = "/nonexistent/ai-flow.js";')
    .replace('["npx", ["--yes", FALLBACK, "guard"]]', '["coding-flow-no-such-command", []]');
  const copy = path.join(dir, 'plugin-under-test.mjs');
  fs.writeFileSync(copy, source);
  const mod = await import(pathToFileURL(copy).href);
  const original = process.stderr.write;
  process.stderr.write = () => true;
  t.after(() => {
    process.stderr.write = original;
  });
  return (await mod.default.server({ directory }))['tool.execute.before'];
}

test('plugin: with no decision available, strict throws and standard lets the write through', async (t) => {
  const write = { tool: 'write' };
  const args = { args: { filePath: 'src/a.js', content: 'ok' } };

  const strict = await brokenPlugin(t, project(t, 'strict'));
  await assert.rejects(() => strict(write, args), /not checked, refused in strict mode/);

  const standard = await brokenPlugin(t, project(t, 'standard'));
  await standard(write, args);
});

test('plugin: strict holds when OpenCode starts below the project root', async (t) => {
  const dir = project(t, 'strict');
  fs.mkdirSync(path.join(dir, 'sub'));
  const hook = await brokenPlugin(t, dir, path.join(dir, 'sub'));
  await assert.rejects(() => hook({ tool: 'write' }, { args: { filePath: 'a.js', content: 'ok' } }), /not checked, refused in strict mode/);
});

test('plugin: with no decision available, strict still lets the user repair harness.json', async (t) => {
  const hook = await brokenPlugin(t, project(t, 'strict'));
  await hook({ tool: 'write' }, { args: { filePath: '.coding-flow/harness.json', content: '{"mode":"standard"}' } });
  await hook({ tool: 'edit' }, { args: { filePath: '.coding-flow/harness.json', newString: '"standard"' } });
  await assert.rejects(
    () => hook({ tool: 'write' }, { args: { filePath: '.coding-flow/harness.json.bak', content: 'x' } }),
    /not checked, refused in strict mode/,
  );
});

test('doctor says why the posture is standard when harness.json cannot be read', (t) => {
  const dir = project(t);
  assert.equal(cli(dir, ['init', '--minimal']).code, 0);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), '{ not json');
  assert.match(cli(dir, ['doctor']).stdout + '', /guard: standard \(\.coding-flow\/harness\.json could not be read;/);
});

test('plugin: strict refuses an unchecked call the in-process guard returns', async (t) => {
  const dir = project(t, 'strict');
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ mode: 'strict' }));
  const copy = path.join(dir, 'plugin-under-test.mjs');
  fs.copyFileSync(path.join(dir, PLUGIN), copy);
  const hook = (await (await import(pathToFileURL(copy).href)).default.server({ directory: dir }))['tool.execute.before'];

  await assert.rejects(() => hook({ tool: 'shell' }, { args: { command: UNCHECKED } }), /not checked, refused in strict mode/);
  await hook({ tool: 'write' }, { args: { filePath: 'src/a.js', content: 'ok' } });
});
