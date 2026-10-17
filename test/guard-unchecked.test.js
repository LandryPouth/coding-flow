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
      throw new Error("stat '/home/someone/secret-project/x'");
    },
  };
  const result = evaluate(hook, dir);
  assert.equal(result.decision, 'unchecked');
  const logged = logLines(dir)[0].reason;
  assert.match(logged, /guard error/);
  assert.doesNotMatch(logged, /someone|\/home/);
});

test('an unknown tool carrying a path is unchecked; a read tool is allowed', (t) => {
  const dir = tmp(t);
  assert.equal(decide({ tool_name: 'MultiEdit2', tool_input: { file_path: '.env' }, cwd: dir }, dir).decision, 'unchecked');
  assert.equal(decide({ tool_name: 'Read', tool_input: { file_path: '.env' }, cwd: dir }, dir).decision, 'allow');
  assert.equal(decide({ tool_name: 'SomeMcpTool', tool_input: { query: 'x' }, cwd: dir }, dir).decision, 'allow');
});

test('a write tool with no path still has its content scanned for secrets', (t) => {
  const dir = tmp(t);
  const key = 'AK' + 'IA' + 'IOSFODNN7EXAMPLE';
  assert.equal(decide({ tool_name: 'Write', tool_input: { content: `K=${key}` }, cwd: dir }, dir).decision, 'deny');
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
    ['Artifact', { file_path: 'page.html' }], ['ArtifactData', { file_path: 'd.json' }],
  ];
  for (const [tool_name, tool_input] of calls) {
    assert.notEqual(evaluate({ tool_name, tool_input, cwd: dir }, dir).decision, 'unchecked', tool_name);
  }
  assert.equal(logLines(dir).length, 0);
});

test('an unchecked call outside the project logs a marker, not a ../ chain', (t) => {
  const dir = tmp(t);
  evaluate({ tool_name: 'MultiEdit2', tool_input: { file_path: '/etc/hosts' }, cwd: dir }, dir);
  assert.equal(logLines(dir)[0].path, '(outside project)');
});

test('a relative path escaping the project logs the marker too', (t) => {
  const dir = tmp(t);
  evaluate({ tool_name: 'MultiEdit2', tool_input: { file_path: '../../x.js' }, cwd: dir }, dir);
  assert.equal(logLines(dir)[0].path, '(outside project)');
});

test('an mcp__ tool is exempt; an OpenCode MCP tool (<server>_<tool>) is judged like any unknown tool (design decision 11)', (t) => {
  const dir = tmp(t);
  assert.equal(evaluate({ tool_name: 'mcp__fs__write_file', tool_input: { path: '.env' }, cwd: dir }, dir).decision, 'allow');
  assert.equal(logLines(dir).length, 0);
  assert.equal(evaluate({ tool_name: 'fs_write_file', tool_input: { path: '.env' }, cwd: dir }, dir).decision, 'unchecked');
  assert.equal(logLines(dir).length, 1);
});

test('a hook input that names no tool is unchecked, not allowed', (t) => {
  const dir = tmp(t);
  for (const hook of [{}, [], { cwd: dir, tool_input: { command: 'echo x > .env' } }]) {
    assert.equal(decide(hook, dir).decision, 'unchecked', JSON.stringify(hook));
  }
});

test('a Bash call with a missing or renamed command is unchecked; an empty one is allowed', (t) => {
  const dir = tmp(t);
  for (const tool_input of [undefined, {}, { cmd: 'echo x > .env' }]) {
    assert.equal(decide({ tool_name: 'Bash', tool_input, cwd: dir }, dir).decision, 'unchecked', JSON.stringify(tool_input));
  }
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: '' }, cwd: dir }, dir).decision, 'allow');
  const res = cli(dir, ['guard'], { tool_name: 'Bash', tool_input: { cmd: 'echo x > .env' } });
  assert.equal(res.code, 0);
  assert.equal(logLines(dir).length, 1);
});

test('the Claude hook turns an exception into unchecked: exit 0, NOT checked, one line', (t) => {
  const dir = tmp(t);
  const res = require('node:child_process').spawnSync(process.execPath, [CLI, 'guard'], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ cwd: dir, tool_name: 'Write', tool_input: { file_path: 42, content: 'x' } }),
  });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /guard error.*NOT checked/);
  assert.equal(logLines(dir).length, 1);
  assert.match(logLines(dir)[0].reason, /guard error/);
});

test('a deny through evaluate writes nothing to the unchecked log', (t) => {
  const dir = tmp(t);
  assert.equal(evaluate({ tool_name: 'Write', tool_input: { file_path: '.env', content: 'A=1' }, cwd: dir }, dir).decision, 'deny');
  assert.equal(logLines(dir).length, 0);
  assert.equal(logLines(dir, 'denials.jsonl').length, 1);
});

test('a shell command too dynamic to read is counted by report, but doctor does not warn on it', (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init']).code, 0);
  cli(dir, ['guard'], { tool_name: 'Bash', tool_input: { command: 'echo x > "$OUT"' } });
  cli(dir, ['guard'], { tool_name: 'Bash', tool_input: { command: "node <<'EOF'\nconsole.log(1)\nEOF" } });
  assert.equal(logLines(dir).length, 2);
  assert.match(cli(dir, ['report']).stdout, /Unchecked writes \(2\)/);
  const doctor = JSON.parse(cli(dir, ['doctor', '--json']).stdout);
  assert.ok(!doctor.warnings.some((w) => w.code === 'guard_unchecked'));
});

test('a file whose name starts with two dots inside the project keeps its relative path', (t) => {
  const dir = tmp(t);
  evaluate({ tool_name: 'MultiEdit2', tool_input: { file_path: path.join(dir, '..hidden', 'x.js') }, cwd: dir }, dir);
  assert.equal(logLines(dir)[0].path, '..hidden/x.js');
});

test('the spawned guard says NOT checked on stderr for an unchecked call', (t) => {
  const dir = tmp(t);
  const res = require('node:child_process').spawnSync(process.execPath, [CLI, 'guard'], {
    cwd: dir, encoding: 'utf8',
    input: JSON.stringify({ cwd: dir, tool_name: 'MultiEdit2', tool_input: { file_path: 'src/a.js' } }),
  });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /NOT checked/);
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

test('an unreadable harness.json is unchecked, not a silent fallback to the defaults', (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, '.coding-flow', 'harness.json'));
  const hook = { tool_name: 'Write', tool_input: { file_path: 'src/a.js', content: 'x' }, cwd: dir };
  assert.equal(evaluate(hook, dir).decision, 'unchecked');
  assert.match(logLines(dir)[0].reason, /harness\.json/);
  // The default policy still refuses what it refuses.
  assert.equal(evaluate({ ...hook, tool_input: { file_path: '.env', content: 'A=1' } }, dir).decision, 'deny');
  const bash = evaluate({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: dir }, dir);
  assert.equal(bash.decision, 'unchecked');
});

test('a Bash call with a null command reaches the spawned guard as unchecked', (t) => {
  const dir = tmp(t);
  const res = cli(dir, ['guard'], { tool_name: 'Bash', tool_input: { command: null } });
  assert.equal(res.code, 0);
  assert.equal(logLines(dir).length, 1);
});

test('doctor ignores unchecked entries older than 7 days', (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init']).code, 0);
  const old = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
  fs.writeFileSync(path.join(dir, '.coding-flow', 'guard-unchecked.jsonl'), `${JSON.stringify({ at: old, tool: 'x', path: null, reason: 'r' })}\n`);
  const doctor = JSON.parse(cli(dir, ['doctor', '--json']).stdout);
  assert.ok(!doctor.warnings.some((w) => w.code === 'guard_unchecked'));
});

test('the plugin read-only list stays inside the guard read-only set', (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const source = fs.readFileSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js'), 'utf8');
  const names = source.match(/\/\^\(([a-z|]+)\)\$\/i/)[1].split('|');
  for (const name of names) {
    assert.equal(decide({ tool_name: name, tool_input: { path: 'x' }, cwd: dir }, dir).decision, 'allow', name);
  }
});

async function loadPlugin(t, dir, edit) {
  const copy = path.join(dir, `plugin-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(copy, edit(fs.readFileSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js'), 'utf8')));
  const mod = await import(pathToFileURL(copy).href);
  const before = (await mod.default.server({ directory: dir }))['tool.execute.before'];
  const original = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  t.after(() => {
    process.stderr.write = original;
  });
  return { before, lines, restore: () => (process.stderr.write = original) };
}

test('the plugin logs unchecked when the guard cannot run, or there is no guard module', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);

  const spawnFails = await loadPlugin(t, dir, (src) =>
    src
      .replace(/const BINARY = .*;/, 'const BINARY = "/nonexistent/ai-flow.js";')
      .replace('["npx", ["--yes", FALLBACK, "guard"]]', '["coding-flow-no-such-command", []]'));
  await spawnFails.before({ tool: 'shell' }, { args: { command: 'echo hi' } });
  spawnFails.restore();
  assert.equal(logLines(dir).length, 1);
  assert.match(logLines(dir)[0].reason, /could not run/);
  assert.ok(spawnFails.lines.some((line) => /NOT checked/.test(line)));

  const noModule = await loadPlugin(t, dir, (src) =>
    src.replace(/const BINARY = .*;/, 'const BINARY = "/nonexistent/ai-flow.js";').replace(/const FALLBACK = .*;/, 'const FALLBACK = "";'));
  await noModule.before({ tool: 'shell' }, { args: { command: 'echo hi' } });
  noModule.restore();
  assert.equal(logLines(dir).length, 2);
  assert.match(logLines(dir)[1].reason, /no guard module/);
});

test('the plugin reports a shell call with no command as unchecked', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const plugin = await loadPlugin(t, dir, (src) => src);
  await plugin.before({ tool: 'shell' }, { args: {} });
  plugin.restore();
  assert.equal(logLines(dir).length, 1);
  assert.ok(plugin.lines.some((line) => /NOT checked/.test(line)));
});

test('the plugin forwards the spawned guard\'s NOT checked line when it falls back to the spawn', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const plugin = await loadPlugin(t, dir, (src) => src.replace('local = createRequire(BINARY)("./lib/guard.js");', 'local = null;'));
  await plugin.before({ tool: 'multiedit2' }, { args: { filePath: 'src/a.js' } });
  plugin.restore();
  assert.ok(plugin.lines.some((line) => /NOT checked/.test(line)));
  assert.equal(logLines(dir).length, 1);
});

test('an exception from a non-string path is unchecked and still logged', (t) => {
  const dir = tmp(t);
  for (const file_path of [5, ['a', '.env'], { x: 1 }]) {
    assert.equal(evaluate({ tool_name: 'Write', tool_input: { file_path, content: 'x' }, cwd: dir }, dir).decision, 'unchecked');
  }
  const lines = logLines(dir);
  assert.equal(lines.length, 3);
  assert.ok(lines.every((line) => line.path === null && /guard error/.test(line.reason)));
});

test('the plugin reports a spawned guard that exits with no decision', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  // A binary that crashes (exit 1) and no in-process module: the spawn path.
  const crash = path.join(dir, 'crash.js');
  fs.writeFileSync(crash, 'process.exit(1);\n');
  const plugin = await loadPlugin(t, dir, (src) => src.replace(/const BINARY = .*;/, `const BINARY = ${JSON.stringify(crash)};`));
  await plugin.before({ tool: 'write' }, { args: { filePath: 'src/a.js', content: 'x' } });
  plugin.restore();
  assert.ok(plugin.lines.some((line) => /no decision \(exit 1\).*NOT checked/.test(line)));
  assert.equal(logLines(dir).length, 1);
  assert.match(logLines(dir)[0].reason, /no decision \(exit 1\)/);
});

test('the plugin keeps its fallback unchecked log bounded', async (t) => {
  const dir = tmp(t);
  assert.equal(cli(dir, ['init', '--opencode']).code, 0);
  const log = path.join(dir, '.coding-flow', 'guard-unchecked.jsonl');
  const line = JSON.stringify({ at: new Date().toISOString(), tool: 'x', path: null, reason: 'old'.padEnd(200, '.') });
  fs.writeFileSync(log, `${Array(2000).fill(line).join('\n')}\n`);
  assert.ok(fs.statSync(log).size > 256 * 1024);
  const noModule = await loadPlugin(t, dir, (src) =>
    src.replace(/const BINARY = .*;/, 'const BINARY = "/nonexistent/ai-flow.js";').replace(/const FALLBACK = .*;/, 'const FALLBACK = "";'));
  await noModule.before({ tool: 'shell' }, { args: { command: 'echo hi' } });
  noModule.restore();
  const lines = logLines(dir);
  assert.equal(lines.length, 201);
  assert.match(lines[200].reason, /no guard module/);
});
