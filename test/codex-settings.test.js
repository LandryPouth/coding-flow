'use strict';

// The Codex write guard is a file we generate into the user's .codex/config.toml.
// What has to hold: it denies exactly the harness blocked paths, it never touches
// a file it did not write, and it follows the blocked-path list on upgrade.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const { MARKER, renderConfig } = require('../bin/lib/codex-settings');

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-codex-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(cwd, args) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const tomlPath = (dir) => path.join(dir, '.codex', 'config.toml');
const harnessPath = (dir) => path.join(dir, '.coding-flow', 'harness.json');
const denied = (toml) => [...toml.matchAll(/^"([^"]+)" = "deny"$/gm)].map((m) => m[1]);

test('init --target codex writes a marker-stamped profile denying exactly the harness blocked paths', (t) => {
  const dir = project(t);
  assert.equal(cli(dir, ['init', '--target', 'codex']).code, 0);
  const toml = fs.readFileSync(tomlPath(dir), 'utf8');
  assert.ok(toml.startsWith(MARKER));
  const blocked = JSON.parse(fs.readFileSync(harnessPath(dir), 'utf8')).blockedPaths;
  const expected = new Set(blocked.flatMap((g) => (g.endsWith('/**') ? [g, g.slice(0, -3)] : [g])));
  assert.deepEqual(new Set(denied(toml)), expected);
  assert.match(toml, /^"\/" = "read"$/m);
});

test('a foreign .codex/config.toml is left byte-for-byte untouched and doctor does not error on it', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, '.codex'));
  const mine = '# my own codex config\nmodel = "x"\n';
  fs.writeFileSync(tomlPath(dir), mine);
  const res = cli(dir, ['init', '--target', 'codex']);
  assert.equal(res.code, 0);
  assert.match(res.output, /skipped/);
  assert.equal(fs.readFileSync(tomlPath(dir), 'utf8'), mine);
  cli(dir, ['upgrade']);
  assert.equal(fs.readFileSync(tomlPath(dir), 'utf8'), mine);
  const report = JSON.parse(cli(dir, ['doctor', '--json']).output);
  assert.equal(report.errors.filter((e) => e.file === '.codex/config.toml').length, 0);
  assert.equal(report.warnings.filter((e) => e.file === '.codex/config.toml').length, 0);
});

test('a comment added above the marker makes the file foreign', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  const edited = `# mine\n${fs.readFileSync(tomlPath(dir), 'utf8')}`;
  fs.writeFileSync(tomlPath(dir), edited);
  cli(dir, ['upgrade']);
  assert.equal(fs.readFileSync(tomlPath(dir), 'utf8'), edited);
});

test('upgrade regenerates a stale marker-stamped profile and follows harness.json', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  fs.writeFileSync(tomlPath(dir), `${MARKER}\n\n# old version\n`);
  assert.equal(cli(dir, ['upgrade']).code, 0);
  assert.equal(fs.readFileSync(tomlPath(dir), 'utf8').includes('old version'), false);

  const harness = JSON.parse(fs.readFileSync(harnessPath(dir), 'utf8'));
  harness.blockedPaths = ['vault/**'];
  fs.writeFileSync(harnessPath(dir), JSON.stringify(harness));
  cli(dir, ['upgrade']);
  assert.deepEqual(denied(fs.readFileSync(tomlPath(dir), 'utf8')).sort(), ['vault', 'vault/**']);
});

test('doctor: a missing profile on a codex project is a guard_not_wired error; a stale one a warning', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  fs.rmSync(tomlPath(dir));
  let report = JSON.parse(cli(dir, ['doctor', '--json']).output);
  assert.ok(report.errors.some((e) => e.code === 'guard_not_wired' && e.file === '.codex/config.toml'));

  fs.mkdirSync(path.dirname(tomlPath(dir)), { recursive: true });
  fs.writeFileSync(tomlPath(dir), `${MARKER}\n\n# old\n`);
  report = JSON.parse(cli(dir, ['doctor', '--json']).output);
  assert.ok(report.warnings.some((w) => w.code === 'codex_sandbox_stale'));
  assert.equal(report.errors.some((e) => e.file === '.codex/config.toml'), false);
});

test('a claude project never gets a .codex/config.toml nor a Codex doctor finding', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'claude']);
  assert.equal(fs.existsSync(tomlPath(dir)), false);
  const report = JSON.parse(cli(dir, ['doctor', '--json']).output);
  assert.equal([...report.errors, ...report.warnings].some((i) => `${i.file}`.includes('.codex')), false);
});

test('init --no-guard on codex writes no profile and records commands-only', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex', '--no-guard']);
  assert.equal(fs.existsSync(tomlPath(dir)), false);
  const runs = path.join(dir, '.coding-flow', 'runs');
  const rec = fs.readdirSync(runs).map((n) => JSON.parse(fs.readFileSync(path.join(runs, n), 'utf8'))).find((r) => r.kind === 'platform');
  assert.equal(rec.enforcementTier, 'commands-only');
});

test('renderConfig quotes patterns safely', () => {
  assert.ok(renderConfig(['a"b']).includes('"a\\"b" = "deny"'));
});

test('a non-string blockedPaths entry does not crash upgrade or doctor', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex']);
  const harness = JSON.parse(fs.readFileSync(harnessPath(dir), 'utf8'));
  harness.blockedPaths = ['.env', 5, null];
  fs.writeFileSync(harnessPath(dir), JSON.stringify(harness));
  assert.equal(cli(dir, ['upgrade']).code, 0);
  assert.deepEqual(denied(fs.readFileSync(tomlPath(dir), 'utf8')), ['.env']);
});

test('init --dry-run on codex writes no profile', (t) => {
  const dir = project(t);
  cli(dir, ['init', '--target', 'codex', '--dry-run']);
  assert.equal(fs.existsSync(tomlPath(dir)), false);
});

test('init --minimal --target codex wires the profile', (t) => {
  const dir = project(t);
  assert.equal(cli(dir, ['init', '--minimal', '--target', 'codex']).code, 0);
  assert.ok(fs.readFileSync(tomlPath(dir), 'utf8').startsWith(MARKER));
});
