'use strict';

// OpenCode's TUI lists no skill in its `/` autocomplete (only under `/skills`):
// a user with only OpenCode typed `/flow` and saw "No matching items". Each skill
// now gets a short command of the same name that shows there and hands over to
// the skill. These pin where they land, that they stay short (a command template
// is expanded: `!`…`` runs a shell command, `@path` attaches a file), and that
// doctor, the global install and uninstall know about them.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const NAMES = ['flow-next', 'flow-plan', 'flow-review', 'flow-run', 'flow-setup', 'flow-ship', 'flow-status'];

function setup(t, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-slash-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(dir, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '', ...extraEnv };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  const run = (args) => execFileSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  return { dir, project, env, run };
}

function commandFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

test('init --target opencode adds one /flow-* command per skill, handing over to the skill', (t) => {
  const { project, run } = setup(t);
  const out = run(['init', '--target', 'opencode']);
  assert.match(out, /Slash commands \(opencode\): 7 written — \.opencode\/commands/);
  assert.deepEqual(commandFiles(path.join(project, '.opencode', 'commands')), NAMES.map((n) => `${n}.md`));

  const run_ = fs.readFileSync(path.join(project, '.opencode', 'commands', 'flow-run.md'), 'utf8');
  assert.match(run_, /^---\ndescription: "Implement one story/);
  assert.match(run_, /Load the flow-run skill with your skill tool/);
  assert.match(run_, /\$ARGUMENTS/);
  for (const name of NAMES) {
    const body = fs.readFileSync(path.join(project, '.opencode', 'commands', `${name}.md`), 'utf8').split('---\n')[2];
    assert.doesNotMatch(body, /!`|@/, `${name}: nothing OpenCode would expand in a command template`);
  }
});

test('the commands are written even when the skills come from .claude/skills', (t) => {
  const { project, run } = setup(t);
  run(['init', '--target', 'claude', '--with-skills']);
  const out = run(['init', '--target', 'opencode']);
  assert.match(out, /served from \.claude\/skills/);
  assert.equal(fs.existsSync(path.join(project, '.opencode', 'skills')), false);
  assert.equal(commandFiles(path.join(project, '.opencode', 'commands')).length, 7);
});

test('doctor flags a missing /flow-* command and upgrade restores it', (t) => {
  const { project, run } = setup(t);
  run(['init', '--target', 'opencode']);
  fs.unlinkSync(path.join(project, '.opencode', 'commands', 'flow-run.md'));
  const res = spawnSync(process.execPath, [CLI, 'doctor'], { cwd: project, encoding: 'utf8' });
  assert.match(`${res.stdout}${res.stderr}`, /\.opencode\/commands\/flow-run\.md/);
  run(['upgrade']);
  assert.ok(fs.existsSync(path.join(project, '.opencode', 'commands', 'flow-run.md')));
});

test('the global install adds the commands beside the skills, and uninstall --global takes them back', (t) => {
  const { dir, project } = setup(t);
  const xdg = path.join(dir, 'xdg');
  const runGlobal = (args) =>
    execFileSync(process.execPath, [CLI, ...args], {
      cwd: project,
      env: { ...process.env, CLAUDECODE: '', OPENCODE: '', XDG_CONFIG_HOME: xdg },
      encoding: 'utf8',
    });
  const out = runGlobal(['init', '--global', '--target', 'opencode']);
  assert.match(out, /Skills: 7 written/);
  assert.match(out, /Slash commands: 7 written/);
  assert.deepEqual(commandFiles(path.join(xdg, 'opencode', 'commands')), NAMES.map((n) => `${n}.md`));
  runGlobal(['uninstall', '--global']);
  assert.deepEqual(commandFiles(path.join(xdg, 'opencode', 'commands')), []);
});

// 0.12.0 wrote the global skills but no `commands/`, so its users see no /flow-*
// and nothing told them why. doctor in an OpenCode project now says it, with
// the one command that fixes it — which /flow-setup runs on a doctor warning.
test('doctor points an older global OpenCode install at upgrade --global', (t) => {
  const { dir, project } = setup(t);
  const xdg = path.join(dir, 'xdg');
  const env = { ...process.env, CLAUDECODE: '', OPENCODE: '', XDG_CONFIG_HOME: xdg };
  const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: project, env, encoding: 'utf8' });
  cli(['init', '--global', '--target', 'opencode']);
  cli(['init', '--target', 'opencode']);
  assert.doesNotMatch(cli(['doctor']).stdout, /opencode_global_stale|behind this version/);

  fs.rmSync(path.join(xdg, 'opencode', 'commands'), { recursive: true });
  const out = cli(['doctor']).stdout;
  assert.match(out, /OpenCode install for every project .* is behind this version \(7 file\(s\) missing, e\.g\. commands\/flow-next\.md\) — run `ai-flow upgrade --global`/);

  cli(['upgrade', '--global']);
  assert.doesNotMatch(cli(['doctor']).stdout, /behind this version/);
});
