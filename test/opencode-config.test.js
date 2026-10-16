'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ensureOpenCodeInstructions,
  inspectOpenCodeInstructions,
  installGlobalCommands,
  uninstallGlobalCommands,
  globalOpenCodeDir,
} = require('../bin/lib/opencode-config');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  return { ...env, ...extra };
}

test('instructions: nothing to point at without a RULES.md', (t) => {
  const root = tmp(t, 'cf-oc-ins-');
  assert.equal(ensureOpenCodeInstructions({ root }).status, 'no-rules');
  assert.equal(fs.existsSync(path.join(root, 'opencode.json')), false);
});

test('instructions: creates opencode.json, then is idempotent', (t) => {
  const root = tmp(t, 'cf-oc-ins-');
  fs.writeFileSync(path.join(root, 'RULES.md'), '# rules\n');
  assert.equal(ensureOpenCodeInstructions({ root }).status, 'created');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')).instructions, ['RULES.md']);
  assert.equal(ensureOpenCodeInstructions({ root }).status, 'unchanged');
  assert.equal(inspectOpenCodeInstructions(root), 'wired');
});

test('instructions: merges into an existing config and keeps every other key', (t) => {
  const root = tmp(t, 'cf-oc-ins-');
  fs.writeFileSync(path.join(root, 'RULES.md'), '# rules\n');
  fs.writeFileSync(path.join(root, 'opencode.json'), JSON.stringify({ model: 'x/y', instructions: ['docs/a.md'] }));
  assert.equal(ensureOpenCodeInstructions({ root }).status, 'merged');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'opencode.json'), 'utf8'));
  assert.equal(config.model, 'x/y');
  assert.deepEqual(config.instructions, ['docs/a.md', 'RULES.md']);
});

test('instructions: a config with comments is left byte-for-byte alone', (t) => {
  const root = tmp(t, 'cf-oc-ins-');
  fs.writeFileSync(path.join(root, 'RULES.md'), '# rules\n');
  const text = '{\n  // mine\n  "model": "x/y"\n}\n';
  fs.writeFileSync(path.join(root, 'opencode.jsonc'), text);
  assert.equal(ensureOpenCodeInstructions({ root }).status, 'skipped');
  assert.equal(fs.readFileSync(path.join(root, 'opencode.jsonc'), 'utf8'), text);
});

test('global: installs, refreshes a pristine file, keeps an edited one, uninstalls only what is ours', (t) => {
  const dir = tmp(t, 'cf-oc-global-');
  const run = 'skills/flow-run/SKILL.md';
  const plan = 'skills/flow-plan/SKILL.md';
  const first = installGlobalCommands([{ rel: run, content: 'v1 run' }, { rel: plan, content: 'v1 plan' }], { dir });
  assert.deepEqual(first.written.sort(), [plan, run]);

  fs.writeFileSync(path.join(dir, plan), 'my edit');
  const second = installGlobalCommands([{ rel: run, content: 'v2 run' }, { rel: plan, content: 'v2 plan' }], { dir });
  assert.deepEqual(second.written, [run]);
  assert.deepEqual(second.skipped, [plan]);
  assert.equal(fs.readFileSync(path.join(dir, run), 'utf8'), 'v2 run');

  const gone = uninstallGlobalCommands({ dir });
  assert.deepEqual(gone.removed, [run]);
  assert.deepEqual(gone.modified, [plan]);
  assert.equal(fs.existsSync(path.join(dir, 'skills', 'flow-run')), false, 'an emptied skill directory goes too');
  assert.equal(fs.readFileSync(path.join(dir, plan), 'utf8'), 'my edit');
});

test('global: the commands an earlier version wrote are retired, an edited one is kept', (t) => {
  const dir = tmp(t, 'cf-oc-global-');
  fs.mkdirSync(path.join(dir, 'command'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'command', 'flow-run.md'), 'old run');
  fs.writeFileSync(path.join(dir, 'command', 'flow-plan.md'), 'my edit');
  const sha = (text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
  fs.writeFileSync(
    path.join(dir, 'coding-flow-global.json'),
    JSON.stringify({ version: '0.11.1', files: { 'flow-run.md': sha('old run'), 'flow-plan.md': sha('old plan') } }),
  );

  const result = installGlobalCommands([{ rel: 'skills/flow-run/SKILL.md', content: 'skill' }], { dir });
  assert.deepEqual(result.retired, ['command/flow-run.md']);
  assert.equal(fs.existsSync(path.join(dir, 'command', 'flow-run.md')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'command', 'flow-plan.md'), 'utf8'), 'my edit');
  assert.deepEqual(uninstallGlobalCommands({ dir }).modified, ['flow-plan.md']);
});

test('global: --dry-run writes nothing', (t) => {
  const dir = tmp(t, 'cf-oc-global-');
  const result = installGlobalCommands([{ rel: 'skills/flow-run/SKILL.md', content: 'x' }], { dir, dryRun: true });
  assert.deepEqual(result.written, ['skills/flow-run/SKILL.md']);
  assert.equal(fs.existsSync(path.join(dir, 'skills')), false);
});

test('global: the directory follows XDG_CONFIG_HOME, else ~/.config', () => {
  assert.equal(globalOpenCodeDir({ env: { XDG_CONFIG_HOME: '/x' }, home: '/h' }), path.join('/x', 'opencode'));
  assert.equal(globalOpenCodeDir({ env: {}, home: '/h' }), path.join('/h', '.config', 'opencode'));
});

test('cli: `init --global` writes the seven skills to the user dir and nothing in the project', (t) => {
  const home = tmp(t, 'cf-oc-home-');
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv({ HOME: home, XDG_CONFIG_HOME: '' });
  const out = execFileSync(process.execPath, [CLI, 'init', '--global'], { cwd: project, env, encoding: 'utf8' });
  assert.match(out, /Skills: 7 written/);
  assert.equal(fs.readdirSync(path.join(home, '.config', 'opencode', 'skills')).length, 7);
  assert.ok(fs.existsSync(path.join(home, '.config', 'opencode', 'skills', 'flow-run', 'SKILL.md')));
  assert.deepEqual(fs.readdirSync(project), []);
  assert.throws(() => execFileSync(process.execPath, [CLI, 'init', '--global', '--target', 'codex'], { cwd: project, env, stdio: 'pipe' }));
});

test('cli: init for OpenCode wires RULES.md into opencode.json; doctor warns when it is missing', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv();
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  assert.match(run(['init', '--target', 'opencode']), /Rules \(OpenCode\): opencode.json created/);
  fs.rmSync(path.join(project, 'opencode.json'));
  assert.match(run(['doctor']), /does not load RULES\.md/);
  run(['upgrade']);
  assert.doesNotMatch(run(['doctor']), /does not load RULES\.md/);
});

test('cli: OPENCODE=1 alone is enough to pick OpenCode, no --target needed', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  const out = execFileSync(process.execPath, [CLI, 'init'], { cwd: project, env: cleanEnv({ OPENCODE: '1' }), encoding: 'utf8' });
  assert.match(out, /Skills \(opencode\): 7 written — \.opencode\/skills/);
});

test('cli: adding OpenCode to a minimal install does not promote it to full', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv();
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  run(['init', '--minimal']);
  const out = run(['init', '--target', 'opencode']);
  assert.doesNotMatch(out, /promoted from minimal/);
  assert.equal(fs.existsSync(path.join(project, 'RULES.md')), false);
  assert.equal(fs.existsSync(path.join(project, 'package.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, '.coding-flow', 'config.json'), 'utf8')).install, 'minimal');
  assert.match(run(['doctor']), /minimal/);
});

test('cli: a project whose guard plugin is wired is never told "none yet"', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv();
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  run(['init', '--target', 'opencode', '--opencode']);
  assert.doesNotMatch(run(['init', '--target', 'opencode']), /Guard: none yet/);
});

test('cli: the generated COMMANDS.md never contains a literal "undefined"', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  execFileSync(process.execPath, [CLI, 'init', '--target', 'opencode'], { cwd: project, env: cleanEnv(), stdio: 'pipe' });
  assert.doesNotMatch(fs.readFileSync(path.join(project, '.coding-flow', 'COMMANDS.md'), 'utf8'), /undefined/);
});

test('cli: `init --global` wires the guard plugin in the user dir by default; --no-guard skips it; uninstall removes it, and only if ours', (t) => {
  const home = tmp(t, 'cf-oc-home-');
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv({ HOME: home, XDG_CONFIG_HOME: '' });
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  const plugin = path.join(home, '.config', 'opencode', 'plugins', 'coding-flow-guard.js');

  assert.match(run(['init', '--global', '--no-guard']), /Guard: skipped \(--no-guard\)/);
  assert.equal(fs.existsSync(plugin), false);
  assert.match(run(['init', '--global']), /Guard plugin \(OpenCode, all projects\): created/);
  // --guard is still accepted; it is the default now.
  assert.match(run(['init', '--global', '--guard']), /Guard plugin \(OpenCode, all projects\): unchanged/);
  assert.match(fs.readFileSync(plugin, 'utf8'), /^\/\/ coding-flow:guard-plugin/);
  assert.match(run(['uninstall', '--global']), /Removed the global guard plugin|Removed 7/);
  assert.equal(fs.existsSync(plugin), false);

  fs.mkdirSync(path.dirname(plugin), { recursive: true });
  fs.writeFileSync(plugin, '// mine\n');
  run(['uninstall', '--global']);
  assert.equal(fs.readFileSync(plugin, 'utf8'), '// mine\n');
});

// "7 written (0 kept)" then "0 written (7 kept)" read as seven files the user had
// edited. Only an edited file is "kept", and it is named.
test('cli: upgrade says up to date for untouched skills and names an edited one', (t) => {
  const project = tmp(t, 'cf-oc-proj-');
  const env = cleanEnv();
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  run(['init', '--target', 'opencode']);
  fs.appendFileSync(path.join(project, '.opencode', 'skills', 'flow-run', 'SKILL.md'), '\nmine\n');
  const out = run(['upgrade']);
  assert.match(out, /Skills \(opencode\): 0 written, 6 up to date, 1 kept because you edited it: \.opencode\/skills\/flow-run\/SKILL\.md — \.opencode\/skills/);
});
