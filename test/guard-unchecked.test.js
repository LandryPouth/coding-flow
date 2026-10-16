'use strict';

// "The guard did not look" is a third outcome, neither allow nor deny: it is
// logged, counted by `report`, warned about by `doctor`, and never written for a
// call the guard did judge.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { decide, evaluate } = require('../bin/lib/guard');

function tmp(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-unchecked-')));
  fs.mkdirSync(path.join(dir, '.coding-flow'));
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
    return { code: err.status ?? 1, stdout: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const logLines = (dir, file = 'guard-unchecked.jsonl') => {
  try {
    return fs.readFileSync(path.join(dir, '.coding-flow', file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};

test('an unparseable hook input is unchecked, not allowed', (t) => {
  const dir = tmp(t);
  const result = evaluate(null, dir);
  assert.equal(result.decision, 'unchecked');
  assert.ok(result.reason);
  assert.equal(logLines(dir).length, 1);
});

test('an exception inside the decision is unchecked and logged', (t) => {
  const dir = tmp(t);
  const hook = {
    cwd: dir,
    get tool_name() {
      throw new Error('boom');
    },
  };
  const result = evaluate(hook, dir);
  assert.equal(result.decision, 'unchecked');
  assert.match(logLines(dir)[0].reason, /boom/);
});

test('an unknown tool carrying a path is unchecked; a read tool is allowed', (t) => {
  const dir = tmp(t);
  assert.equal(decide({ tool_name: 'MultiEdit2', tool_input: { file_path: '.env' }, cwd: dir }, dir).decision, 'unchecked');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '.env' }, cwd: dir }, dir).decision, 'allow');
  assert.equal(decide({ tool_name: 'SomeMcpTool', tool_input: { query: 'x' }, cwd: dir }, dir).decision, 'allow');
});

test('a write tool with no path, and a path that cannot be resolved, are unchecked', (t) => {
  const dir = tmp(t);
  assert.equal(decide({ tool_name: 'Write', tool_input: { content: 'x' }, cwd: dir }, dir).decision, 'unchecked');
  fs.symlinkSync('b', path.join(dir, 'a'));
  fs.symlinkSync('a', path.join(dir, 'b'));
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 'a', content: 'x' }, cwd: dir }, dir).decision, 'unchecked');
});

test('a deny is still a deny and writes nothing to the unchecked log', (t) => {
  const dir = tmp(t);
  const res = cli(dir, ['guard'], { tool_name: 'Write', tool_input: { file_path: '.env', content: 'A=1' } });
  assert.equal(res.code, 2);
  assert.equal(logLines(dir).length, 0);
  assert.equal(logLines(dir, 'denials.jsonl').length, 1);
});

test('the Claude hook exits 0 on an unchecked call and logs one line', (t) => {
  const dir = tmp(t);
  const res = cli(dir, ['guard'], { tool_name: 'MultiEdit2', tool_input: { file_path: 'src/a.js' } });
  assert.equal(res.code, 0);
  assert.equal(logLines(dir).length, 1);
});

test('a normal session logs nothing', (t) => {
  const dir = tmp(t);
  const calls = [
    ['Read', { file_path: 'a.js' }], ['Glob', { pattern: '*.js', path: dir }], ['Grep', { pattern: 'x', path: dir }],
    ['WebFetch', { url: 'https://x.test' }], ['Task', { prompt: 'x' }], ['TodoWrite', { todos: [] }],
    ['read', { filePath: 'a.js' }], ['list', { path: dir }], ['skill', { name: 'x' }],
    ['Write', { file_path: 'src/new.js', content: 'x' }], ['Bash', { command: 'npm test' }],
  ];
  for (const [tool_name, tool_input] of calls) {
    assert.notEqual(evaluate({ tool_name, tool_input, cwd: dir }, dir).decision, 'unchecked', tool_name);
  }
  assert.equal(logLines(dir).length, 0);
});

test('report counts unchecked writes with their reasons, and doctor warns', (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init']).code, 0);
  for (let i = 0; i < 3; i += 1) {
    cli(dir, ['guard'], { tool_name: 'MultiEdit2', tool_input: { file_path: 'src/a.js' } });
  }
  const report = cli(dir, ['report']).stdout;
  assert.match(report, /Unchecked writes \(3\)/);
  assert.match(report, /3 × tool MultiEdit2 is unknown/);
  const doctor = JSON.parse(cli(dir, ['doctor', '--json']).stdout);
  assert.ok(doctor.warnings.some((w) => w.code === 'guard_unchecked'));
});

test('the OpenCode plugin reports a write it could not read as unchecked, not as allowed', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const copy = path.join(dir, 'plugin-under-test.mjs');
  fs.copyFileSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js'), copy);
  const mod = await import(pathToFileURL(copy).href);
  const before = (await mod.default.server({ directory: dir }))['tool.execute.before'];

  const stderr = [];
  const original = process.stderr.write;
  process.stderr.write = (chunk) => {
    stderr.push(String(chunk));
    return true;
  };
  t.after(() => {
    process.stderr.write = original;
  });

  await before({ tool: 'write' }, { args: { content: 'x' } });
  await before({ tool: 'patch' }, { args: { patchText: 'garbage' } });
  await before({ tool: 'multiedit' }, { args: { filePath: 'src/a.js' } });
  await before({ tool: 'read' }, { args: { filePath: 'src/a.js' } });

  assert.equal(logLines(dir).length, 3);
  assert.equal(stderr.filter((line) => /NOT checked/.test(line)).length, 3);
});
