'use strict';

// `<command> --help` must be a pure read. It once ran the install it was asked
// about (docs/DOGFOODING.md, 2026-10-16): 13 files, an opencode.json, 12 npm scripts.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { USAGE } = require('../bin/lib/usage');

const COMMANDS = [...new Set(USAGE.split('\n').map((l) => l.match(/^ {2}ai-flow (\S+)/)).filter(Boolean).map((m) => m[1]))];

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      if (name === '.git') continue;
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else out.push(`${path.relative(dir, full)}:${fs.readFileSync(full, 'utf8')}`);
    }
  };
  walk(dir);
  return out.join('\n');
}

function repo(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-help-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"x","scripts":{}}\n');
  return dir;
}

for (const flag of ['--help', '-h']) {
  test(`every command answers ${flag} with its usage and touches nothing`, (t) => {
    const dir = repo(t);
    const before = snapshot(dir);
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });

    for (const command of COMMANDS) {
      const res = spawnSync(process.execPath, [CLI, command, flag], { cwd: dir, encoding: 'utf8' });
      assert.equal(res.status, 0, `${command}: ${res.stdout}${res.stderr}`);
      assert.match(res.stdout, new RegExp(`ai-flow ${command}`), `${command} prints its usage`);
    }

    assert.equal(snapshot(dir), before, 'the tree is unchanged');
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), status);
  });
}

test('a subcommand --help prints the command usage and writes nothing', (t) => {
  const dir = repo(t);
  const before = snapshot(dir);
  const res = spawnSync(process.execPath, [CLI, 'worktree', 'add', '--help'], { cwd: dir, encoding: 'utf8' });

  assert.equal(res.status, 0);
  assert.match(res.stdout, /ai-flow worktree add/);
  assert.equal(snapshot(dir), before);
});

test('an unknown flag on init fails instead of installing', (t) => {
  const dir = repo(t);
  const before = snapshot(dir);
  const res = spawnSync(process.execPath, [CLI, 'init', '--hlep'], { cwd: dir, encoding: 'utf8' });

  assert.equal(res.status, 1);
  assert.match(`${res.stdout}${res.stderr}`, /unknown flag "--hlep"/);
  assert.equal(snapshot(dir), before);
});

test('an unknown flag on uninstall fails instead of uninstalling', (t) => {
  const dir = repo(t);
  const before = snapshot(dir);
  const res = spawnSync(process.execPath, [CLI, 'uninstall', '--hlep'], { cwd: dir, encoding: 'utf8' });

  assert.equal(res.status, 1);
  assert.match(`${res.stdout}${res.stderr}`, /unknown flag "--hlep"/);
  assert.equal(snapshot(dir), before);
});

test('every dispatched command is in the usage table, so its --help cannot fall through and run', () => {
  const source = fs.readFileSync(CLI, 'utf8');
  const dispatched = [...new Set([...source.matchAll(/command === "([a-z][a-z-]*)"/g)].map((m) => m[1]))];

  assert.deepEqual(dispatched.filter((c) => !COMMANDS.includes(c)), []);
});
