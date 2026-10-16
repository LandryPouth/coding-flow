'use strict';

const { defineSuite } = require('../test-support/commands-only-suite');

defineSuite({
  target: 'opencode',
  files: (name) => `.opencode/skills/${name}/SKILL.md`,
  parser: 'yaml',
  describe: (parsed) => parsed.description,
});

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function initOpenCode(t, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-oc-msg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = run(['init', '--target', 'opencode', ...extra]);
  let doctor = '';
  try { doctor = run(['doctor']); } catch (err) { doctor = `${err.stdout || ''}${err.stderr || ''}`; }
  return { dir, out, doctor };
}

test('opencode: --target opencode wires the guard plugin by default, and says so', (t) => {
  const { dir, out, doctor } = initOpenCode(t, []);
  assert.match(out, /Guard plugin \(OpenCode\): wired/);
  assert.doesNotMatch(out, /Guard hook: none|not mechanically protected/);
  assert.doesNotMatch(doctor, /guard not available/);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js')));
});

test('opencode: --no-guard opts out, says so, and doctor then flags the hole', (t) => {
  const { dir, out } = initOpenCode(t, ['--no-guard']);
  assert.match(out, /Guard: skipped \(--no-guard\)/);
  assert.equal(fs.existsSync(path.join(dir, '.opencode', 'plugins')), false);
  // doctor exits non-zero on an error, which is the point here.
  const res = require('node:child_process').spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  const doctor = JSON.parse(res.stdout);
  assert.ok(doctor.errors.some((e) => e.code === 'opencode_guard_not_wired'));
});

test('opencode: --opencode is still accepted and changes nothing on this target', (t) => {
  const { out } = initOpenCode(t, ['--opencode']);
  assert.match(out, /Guard plugin \(OpenCode\): wired/);
});

test('opencode: report records enforcementTier plugin when the guard is wired, commands-only with --no-guard', (t) => {
  const report = (dir) => {
    const out = execFileSync(process.execPath, [CLI, 'report'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.split('## Platform coverage')[1].split('## Guard denials')[0];
  };
  assert.match(report(initOpenCode(t, []).dir), /\| opencode \|.*enforcementTier: plugin/);
  assert.match(report(initOpenCode(t, ['--no-guard']).dir), /\| opencode \|.*enforcementTier: commands-only/);
});

// Claude and OpenCode in the same project: OpenCode reads `.claude/skills`, so one
// skill set serves both and no second copy is written (OpenCode would keep one
// and warn "duplicate skill name").
function sharedProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-oc-shared-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { dir, run };
}

test('opencode beside claude: the .claude/skills copy serves both, no .opencode/skills duplicate', (t) => {
  const { dir, run } = sharedProject(t);
  run(['init', '--target', 'claude', '--with-skills']);
  const out = run(['init', '--target', 'opencode']);
  assert.match(out, /Skills \(opencode\): served from \.claude\/skills/);
  assert.equal(fs.existsSync(path.join(dir, '.opencode', 'skills')), false);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js')), 'the OpenCode guard is still wired');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'settings.json')), 'the Claude hook is kept');
  const doctor = JSON.parse(run(['doctor', '--json']));
  assert.deepEqual(doctor.errors, []);
  assert.equal(doctor.warnings.some((w) => /opencode/.test(w.code)), false);
});

test('opencode first, claude added later: init retires the .opencode/skills copy at once', (t) => {
  const { dir, run } = sharedProject(t);
  run(['init', '--target', 'opencode']);
  assert.ok(fs.existsSync(path.join(dir, '.opencode', 'skills', 'flow-run', 'SKILL.md')));
  // Adding Claude retires the OpenCode copy right away, not on the next upgrade.
  assert.match(run(['init', '--target', 'claude', '--with-skills']), /Skills \(opencode\): served from \.claude\/skills/);
  assert.equal(fs.existsSync(path.join(dir, '.opencode', 'skills', 'flow-run')), false);
  assert.equal(JSON.parse(run(['doctor', '--json'])).warnings.some((w) => /opencode/.test(w.code)), false);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md')));
});

test('opencode: upgrade retires the .opencode/command files an earlier version wrote, keeps an edited one', (t) => {
  const { dir, run } = sharedProject(t);
  run(['init', '--target', 'opencode']);
  // Simulate the earlier layout: commands recorded in the manifest.
  const manifestFile = path.join(dir, '.coding-flow', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const sha = (text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
  fs.mkdirSync(path.join(dir, '.opencode', 'command'), { recursive: true });
  for (const [name, text] of [['flow-run', 'old run'], ['flow-plan', 'old plan']]) {
    fs.writeFileSync(path.join(dir, '.opencode', 'command', `${name}.md`), text);
    manifest.platformCommands[`.opencode/command/${name}.md`] = sha(text);
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, '.opencode', 'command', 'flow-plan.md'), 'my edit');

  assert.ok(JSON.parse(run(['doctor', '--json'])).warnings.some((w) => w.code === 'opencode_legacy_commands'));
  const out = run(['upgrade']);
  assert.match(out, /Retired 1 file/);
  assert.match(out, /Kept \.opencode\/command\/flow-plan\.md: you edited it/);
  assert.equal(fs.existsSync(path.join(dir, '.opencode', 'command', 'flow-run.md')), false);
  assert.equal(fs.readFileSync(path.join(dir, '.opencode', 'command', 'flow-plan.md'), 'utf8'), 'my edit');
});

test('opencode: rendered skills pin npx to the version that wrote them', (t) => {
  const { dir, run } = sharedProject(t);
  run(['init', '--target', 'opencode']);
  const { version } = require('../package.json');
  const setup = fs.readFileSync(path.join(dir, '.opencode', 'skills', 'flow-setup', 'SKILL.md'), 'utf8');
  assert.ok(setup.includes(`npx @landry_pouth/coding-flow@${version} init`), 'flow-setup runs the pinned init');
  assert.doesNotMatch(setup, /npx @landry_pouth\/coding-flow(?![@\w-])/);
});

test('opencode: doctor flags a duplicated skill set', (t) => {
  const { dir, run } = sharedProject(t);
  run(['init', '--target', 'claude', '--with-skills']);
  run(['init', '--target', 'opencode']);
  // A second copy left by hand (or by an older version).
  fs.mkdirSync(path.join(dir, '.opencode', 'skills', 'flow-run'), { recursive: true });
  fs.copyFileSync(path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md'), path.join(dir, '.opencode', 'skills', 'flow-run', 'SKILL.md'));
  assert.ok(JSON.parse(run(['doctor', '--json'])).warnings.some((w) => w.code === 'opencode_skills_duplicated'));
});
