'use strict';

// Cache replays: a validation command's result says whether the tests ran or a
// build tool (turbo, nx) replayed a previous run, and `freshTestsFor` refuses a
// full replay as proof at the risk levels the project names.

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

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });
}

function write(dir, file, content) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

function editJson(dir, file, edit) {
  const full = path.join(dir, '.coding-flow', file);
  const json = JSON.parse(fs.readFileSync(full, 'utf8'));
  edit(json);
  fs.writeFileSync(full, JSON.stringify(json, null, 2));
}

// A fake command printing `text` (a script file, so quoting never matters).
function fakeCommand(dir, name, text) {
  write(dir, name, `process.stdout.write(${JSON.stringify(text)});\n`);
  return `node ${name}`;
}

// Branch with one source change and a test file, so the coverage gate stays out
// of the way. `source` decides the risk: an auth path is high, a plain one is not.
function project(t, { command, source, harness = {}, validation = {} }) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-cache-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(dir, ['init', '--minimal']).code, 0);

  const commands = [fakeCommand(dir, 'fake.js', command)];
  editJson(dir, 'config.json', (config) => {
    config.validation = { commands, quality: [], ...validation };
  });
  if (Object.keys(harness).length) {
    editJson(dir, 'harness.json', (config) => Object.assign(config, harness));
  }

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/x']);

  write(dir, source, 'module.exports = 1;\n');
  write(dir, 'test/x.test.js', "require('node:test');\n");
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'change']);
  return dir;
}

function verify(dir) {
  const res = run(dir, ['verify', '--json']);
  let evidence = null;
  try {
    evidence = JSON.parse(res.output);
  } catch {
    // the assertion on res.output shows why
  }
  return { ...res, evidence };
}

const cacheOf = (text) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-cache-')));
  try {
    assert.equal(run(dir, ['init', '--minimal']).code, 0);
    const command = fakeCommand(dir, 'fake.js', text);
    editJson(dir, 'config.json', (config) => {
      config.validation = { commands: [command], quality: [] };
    });
    const { evidence } = verify(dir);
    return evidence.results[0];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('a turbo summary is read as full, partial, none, or unknown', () => {
  assert.equal(cacheOf('Cached:    5 cached, 5 total\n').cache, 'full');
  assert.equal(cacheOf('Cached:    2 cached, 5 total\n').cache, 'partial');
  assert.equal(cacheOf('Cached:    0 cached, 5 total\n').cache, 'none');
  assert.equal(cacheOf('all good\n').cache, 'unknown');
});

test('ANSI colour codes do not hide the summary', () => {
  const result = cacheOf('\u001b[1mCached:\u001b[22m    5 cached, 5 total\n');
  assert.equal(result.cache, 'full');
  assert.equal(result.cached, 5);
  assert.equal(result.total, 5);
});

test('a summary pushed out of the stored tail is still found', () => {
  const result = cacheOf(`Cached: 3 cached, 3 total\n${'noise\n'.repeat(2000)}`);
  assert.equal(result.cache, 'full');
});

test('nx reads from the cache: summary counts decide full or partial', () => {
  assert.equal(
    cacheOf('Nx read the output from the cache instead of running the command for 3 out of 3 tasks.\n').cache,
    'full',
  );
  assert.equal(
    cacheOf('Nx read the output from the cache instead of running the command for 1 out of 3 tasks.\n').cache,
    'partial',
  );
  assert.equal(cacheOf('> nx run app:test  [local cache]\n').cache, 'partial');
});

test('a low-risk story with a full replay passes and the output says it was replayed', (t) => {
  const dir = project(t, {
    command: 'Cached: 5 cached, 5 total\n',
    source: 'src/plain.js',
    harness: { freshTestsFor: ['high'] },
  });

  const res = run(dir, ['verify']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /replayed from cache: 5\/5 tasks/);
});

test('freshTestsFor: a full replay on a high-risk story is refused with advice', (t) => {
  const dir = project(t, {
    command: 'Cached: 5 cached, 5 total\n',
    source: 'src/auth/login.js',
    harness: { freshTestsFor: ['high'] },
  });

  const res = run(dir, ['verify']);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /fully replayed from a build-tool cache/);
  assert.match(res.output, /--force|freshCommands/);
});

test('freshTestsFor: a partial replay is still accepted', (t) => {
  const dir = project(t, {
    command: 'Cached: 2 cached, 5 total\n',
    source: 'src/auth/login.js',
    harness: { freshTestsFor: ['high'] },
  });

  assert.equal(run(dir, ['verify']).code, 0);
});

test('without freshTestsFor a full replay on a high-risk story is accepted', (t) => {
  const dir = project(t, { command: 'Cached: 5 cached, 5 total\n', source: 'src/auth/login.js' });

  assert.equal(run(dir, ['verify']).code, 0);
});

test('freshCommands run instead of the usual ones when the risk asks for it', (t) => {
  const dir = project(t, {
    command: 'Cached: 5 cached, 5 total\n',
    source: 'src/auth/login.js',
    harness: { freshTestsFor: ['high'] },
  });
  const fresh = fakeCommand(dir, 'fresh.js', 'Cached: 0 cached, 5 total\n');
  editJson(dir, 'config.json', (config) => {
    config.validation.freshCommands = [fresh];
  });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'fresh']);

  const { code, output, evidence } = verify(dir);

  assert.equal(code, 0, output);
  assert.deepEqual(evidence.results.map((r) => r.command), [fresh]);
  assert.equal(evidence.results[0].cache, 'none');
});

test('the PR evidence marks a replayed command', (t) => {
  const { buildEvidenceBlock } = require('../bin/lib/ship');
  const block = buildEvidenceBlock({
    ok: true,
    commandsFound: 1,
    results: [{ command: 'npm test', ok: true, exitCode: 0, durationMs: 5, cache: 'full' }],
  });

  assert.match(block, /replayed from cache/);
});
