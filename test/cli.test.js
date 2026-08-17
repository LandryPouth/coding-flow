'use strict';

// Contract tests for the ai-flow CLI.
// We test observable behavior (what the CLI writes to disk and its exit code),
// not the internals — that is what actually protects the user's repo against a
// regression in init / upgrade / uninstall / doctor.
//
// Zero dependency: only the built-in `node:test` runner (Node >= 18).
//   node --test        (or `npm test`)

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

// Creates a throwaway project and schedules its cleanup at the end of the test.
function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A Claude Code config directory with no plugin in it. `init` reads the real
// one to decide whether to copy the skills, so without this the suite would
// pass or fail depending on whether the DEVELOPER has the plugin installed.
function claudeConfigWithoutPlugin(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-claude-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A Claude Code config directory with the plugin really installed — registry
// entry AND the skills on disk, because detection believes the artifact rather
// than the registry (see plugin-detect.test.js).
function claudeConfigWithPlugin(t) {
  const dir = claudeConfigWithoutPlugin(t);
  const installPath = path.join(dir, 'plugins', 'cache', 'coding-flow', 'coding-flow', '9.9.9');
  fs.mkdirSync(path.join(installPath, 'skills', 'flow-run'), { recursive: true });
  fs.writeFileSync(path.join(installPath, 'skills', 'flow-run', 'SKILL.md'), '---\nname: flow-run\n---\n');
  fs.mkdirSync(path.join(installPath, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(
    path.join(installPath, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'coding-flow', version: '9.9.9' }),
  );
  fs.writeFileSync(
    path.join(dir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: { 'coding-flow@coding-flow': [{ scope: 'user', installPath, version: '9.9.9' }] },
    }),
  );
  return dir;
}

// Runs the CLI in `cwd`. Never throws: returns { code, output }.
function run(cwd, args, { claudeConfigDir = null } = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Never inherit the developer's plugin install: these tests must give
        // the same answer on a laptop and in CI.
        CLAUDE_CONFIG_DIR: claudeConfigDir || path.join(cwd, '.no-claude-config'),
        CLAUDE_PLUGIN_ROOT: '',
      },
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const REQUIRED_FILES = ['RULES.md', 'CLAUDE.md', 'package.json'];
const REQUIRED_DIRS = ['.claude/skills', 'docs', 'epics', '.coding-flow'];

test('init installs the base structure and succeeds', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init']);
  assert.equal(code, 0, 'init must exit 0');

  for (const f of REQUIRED_FILES) {
    assert.ok(fs.existsSync(path.join(dir, f)), `missing file after init: ${f}`);
  }
  for (const d of REQUIRED_DIRS) {
    assert.ok(fs.existsSync(path.join(dir, d)), `missing directory after init: ${d}`);
  }
});

test('init creates a private package.json when there is none', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true, 'the generated package.json must be private:true');
});

test('init --dry-run writes no file', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init', '--dry-run']);
  assert.equal(code, 0);
  assert.equal(fs.readdirSync(dir).length, 0, '--dry-run must write nothing');
});

test('doctor succeeds on a healthy install', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  assert.equal(run(dir, ['doctor']).code, 0, 'doctor must pass after a clean init');
});

test('doctor fails when a required file is missing', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  fs.unlinkSync(path.join(dir, 'RULES.md'));
  assert.notEqual(run(dir, ['doctor']).code, 0, 'doctor must detect a missing file');
});

test('doctor --fix restores a missing required file', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const target = path.join(dir, 'RULES.md');
  fs.unlinkSync(target);
  run(dir, ['doctor', '--fix']);
  assert.ok(fs.existsSync(target), 'doctor --fix must recreate the file');
});

test('upgrade is idempotent and preserves local edits', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'RULES.md');
  fs.appendFileSync(rules, '\n<!-- LOCAL-MARKER -->\n');

  const { code } = run(dir, ['upgrade']);
  assert.equal(code, 0, 'upgrade must exit 0');
  assert.ok(
    fs.readFileSync(rules, 'utf8').includes('LOCAL-MARKER'),
    'upgrade must never overwrite a local edit',
  );
});

test('init --force reinstalls and overwrites local edits', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'RULES.md');
  fs.appendFileSync(rules, '\n<!-- LOCAL-MARKER -->\n');

  run(dir, ['init', '--force']);
  assert.ok(
    !fs.readFileSync(rules, 'utf8').includes('LOCAL-MARKER'),
    '--force must reinstall the template over it',
  );
});

test('uninstall removes the managed files but keeps epics/', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);

  const story = path.join(dir, 'epics', 'epic-99-test', 'story.md');
  fs.mkdirSync(path.dirname(story), { recursive: true });
  fs.writeFileSync(story, 'my story');

  assert.equal(run(dir, ['uninstall']).code, 0, 'uninstall must exit 0');
  assert.ok(fs.existsSync(story), 'uninstall must never touch epics/');
  assert.ok(
    !fs.existsSync(path.join(dir, 'RULES.md')),
    'uninstall must remove the managed files',
  );
});

test('list-skills lists the available skills under their flow- names', (t) => {
  const dir = freshProject(t);
  const { code, output } = run(dir, ['list-skills']);
  assert.equal(code, 0);
  // The prefix is the whole point: a bare `run` would collide with Claude Code's
  // own built-in skill of that name.
  assert.ok(output.includes('flow-run'), 'the output must list flow-run');
  assert.ok(output.includes('flow-review'), 'the output must list flow-review');
  assert.ok(!/^- run:/m.test(output), 'no skill may keep the bare, colliding name');
});

// --- Skills channel: plugin vs project -------------------------------------
// The project must never carry a second copy of a skill the plugin already
// serves: two names for the same thing is the confusion this whole seam exists
// to remove.

const SKILL_DIRS = [
  'flow-setup',
  'flow-plan',
  'flow-run',
  'flow-review',
  'flow-ship',
  'flow-status',
  'flow-next',
];

function readConfigSkills(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8')).skills;
}

test('init copies the skills when no plugin is installed', (t) => {
  const dir = freshProject(t);
  assert.equal(run(dir, ['init'], { claudeConfigDir: claudeConfigWithoutPlugin(t) }).code, 0);

  for (const name of SKILL_DIRS) {
    assert.ok(
      fs.existsSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md')),
      `missing skill after init: ${name}`,
    );
  }
  assert.equal(readConfigSkills(dir), 'project');
});

test('init skips the skills when the plugin is already installed', (t) => {
  const dir = freshProject(t);
  const { code, output } = run(dir, ['init'], { claudeConfigDir: claudeConfigWithPlugin(t) });

  assert.equal(code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills')), 'no project copy of the skills');
  assert.equal(readConfigSkills(dir), 'plugin');
  assert.match(output, /served by the plugin/i, 'init must say which channel serves the skills');
});

test('a plugin-served install is healthy for doctor', (t) => {
  const dir = freshProject(t);
  const claude = claudeConfigWithPlugin(t);
  run(dir, ['init'], { claudeConfigDir: claude });

  // doctor judges the project against the recorded decision, so missing project
  // skills must not read as a broken install.
  assert.equal(run(dir, ['doctor'], { claudeConfigDir: claude }).code, 0);
});

test('--with-skills and --no-skills override the detection', (t) => {
  const forced = freshProject(t);
  run(forced, ['init', '--with-skills'], { claudeConfigDir: claudeConfigWithPlugin(t) });
  assert.ok(fs.existsSync(path.join(forced, '.claude', 'skills', 'flow-run')), '--with-skills wins');
  assert.equal(readConfigSkills(forced), 'project');

  const skipped = freshProject(t);
  run(skipped, ['init', '--no-skills'], { claudeConfigDir: claudeConfigWithoutPlugin(t) });
  assert.ok(!fs.existsSync(path.join(skipped, '.claude', 'skills')), '--no-skills wins');
  assert.equal(readConfigSkills(skipped), 'plugin');
});

test('a re-init keeps the channel recorded at install time', (t) => {
  const dir = freshProject(t);
  run(dir, ['init'], { claudeConfigDir: claudeConfigWithoutPlugin(t) });

  // Same project, but now on a machine that HAS the plugin: the recorded choice
  // must win, or the install would differ between teammates.
  run(dir, ['init'], { claudeConfigDir: claudeConfigWithPlugin(t) });

  assert.equal(readConfigSkills(dir), 'project');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md')));
});

test('upgrade removes skills left over under their old names', (t) => {
  const dir = freshProject(t);
  const claude = claudeConfigWithoutPlugin(t);
  run(dir, ['init'], { claudeConfigDir: claude });

  // Simulate an install made before the flow- rename: an old name on disk AND
  // in the manifest, one untouched and one edited by the user.
  const skills = path.join(dir, '.claude', 'skills');
  const manifestPath = path.join(dir, '.coding-flow', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');

  for (const [old, current] of [['run', 'flow-run'], ['review', 'flow-review']]) {
    fs.mkdirSync(path.join(skills, old), { recursive: true });
    fs.copyFileSync(path.join(skills, current, 'SKILL.md'), path.join(skills, old, 'SKILL.md'));
    manifest.files[`.claude/skills/${old}/SKILL.md`] = {
      source: `.claude/skills/${old}/SKILL.md`,
      hash: sha(path.join(skills, old, 'SKILL.md')),
      kind: 'template',
    };
  }
  fs.appendFileSync(path.join(skills, 'review', 'SKILL.md'), '\nlocal edit\n');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const { code, output } = run(dir, ['upgrade'], { claudeConfigDir: claude });

  assert.equal(code, 0);
  assert.ok(!fs.existsSync(path.join(skills, 'run')), 'the stale old name must be removed');
  assert.ok(fs.existsSync(path.join(skills, 'review', 'SKILL.md')), 'a locally edited file is never deleted');
  assert.match(output, /locally edited/i, 'upgrade must report what it kept and why');
  assert.ok(fs.existsSync(path.join(skills, 'flow-run', 'SKILL.md')), 'the current skills stay');
});

// Turns a fresh install into what a project installed BEFORE this release looks
// like: skills under their old bare names, and a config with no skills field.
function makeLegacyInstall(dir) {
  const skills = path.join(dir, '.claude', 'skills');
  const manifestPath = path.join(dir, '.coding-flow', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const record = (name, content) => {
    manifest.files[`.claude/skills/${name}/SKILL.md`] = {
      source: `.claude/skills/${name}/SKILL.md`,
      hash: createHash('sha256').update(content).digest('hex'),
      kind: 'template',
    };
  };

  for (const name of ['setup', 'plan', 'run', 'review', 'ship']) {
    fs.renameSync(path.join(skills, `flow-${name}`), path.join(skills, name));
    delete manifest.files[`.claude/skills/flow-${name}/SKILL.md`];
    record(name, fs.readFileSync(path.join(skills, name, 'SKILL.md')));
  }

  // A legacy install also carried a `verify` skill, which this release drops:
  // verification is machinery, not a command you reach for. It has no current
  // counterpart to rename, so the fixture synthesizes it — upgrade must prove it
  // removes the file rather than leaving a skill nothing serves.
  const legacyVerify = '---\nname: verify\ndescription: Legacy verify skill.\n---\n\n# Verify\n';
  fs.mkdirSync(path.join(skills, 'verify'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'verify', 'SKILL.md'), legacyVerify);
  record('verify', legacyVerify);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  delete config.skills;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

test('upgrading a legacy project adopts the plugin channel without re-running init', (t) => {
  const dir = freshProject(t);
  run(dir, ['init'], { claudeConfigDir: claudeConfigWithoutPlugin(t) });
  makeLegacyInstall(dir);

  // The user has since installed the plugin. A plain `upgrade` — no flag, no
  // second `init` — must be enough to stop having two names for one skill.
  const { code, output } = run(dir, ['upgrade'], { claudeConfigDir: claudeConfigWithPlugin(t) });

  assert.equal(code, 0);
  assert.equal(readConfigSkills(dir), 'plugin', 'the choice is recorded, so teammates share it');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills')), 'the duplicated copies are gone');
  assert.match(output, /served by the plugin/i, 'upgrade says which channel won and why');
  assert.equal(run(dir, ['doctor'], { claudeConfigDir: claudeConfigWithPlugin(t) }).code, 0);
});

test('upgrading a legacy project without the plugin keeps the skills, renamed', (t) => {
  const dir = freshProject(t);
  const claude = claudeConfigWithoutPlugin(t);
  run(dir, ['init'], { claudeConfigDir: claude });
  makeLegacyInstall(dir);

  assert.equal(run(dir, ['upgrade'], { claudeConfigDir: claude }).code, 0);

  assert.equal(readConfigSkills(dir), 'project');
  for (const name of SKILL_DIRS) {
    assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', name)), `${name} must be installed`);
  }
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills', 'run')), 'the old name is gone');
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills', 'verify')), 'the dropped skill is gone');
  assert.ok(
    !fs.existsSync(path.join(dir, '.claude', 'skills', 'flow-verify')),
    'and it is not reinstalled under the new name',
  );
});

test('a recorded choice survives an upgrade run on a machine that would detect otherwise', (t) => {
  const dir = freshProject(t);
  run(dir, ['init'], { claudeConfigDir: claudeConfigWithoutPlugin(t) });
  assert.equal(readConfigSkills(dir), 'project');

  // A teammate WITH the plugin upgrades the same repo. Deleting the committed
  // skills here would break every teammate who does not have the plugin.
  const { output } = run(dir, ['upgrade'], { claudeConfigDir: claudeConfigWithPlugin(t) });

  assert.equal(readConfigSkills(dir), 'project');
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'flow-run', 'SKILL.md')));
  assert.match(output, /recorded in \.coding-flow\/config\.json/i);
});

test('upgrade --no-skills hands the channel over to the plugin', (t) => {
  const dir = freshProject(t);
  const claude = claudeConfigWithoutPlugin(t);
  run(dir, ['init'], { claudeConfigDir: claude });
  assert.equal(readConfigSkills(dir), 'project');

  const { code } = run(dir, ['upgrade', '--no-skills'], { claudeConfigDir: claude });

  assert.equal(code, 0);
  assert.equal(readConfigSkills(dir), 'plugin');
  for (const name of SKILL_DIRS) {
    assert.ok(!fs.existsSync(path.join(dir, '.claude', 'skills', name)), `${name} must be gone`);
  }
  assert.equal(run(dir, ['doctor'], { claudeConfigDir: claude }).code, 0, 'doctor stays green');
});

test('version prints the package version and matches package.json', (t) => {
  const dir = freshProject(t);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const { code, output } = run(dir, ['version']);
  assert.equal(code, 0);
  assert.equal(output.trim(), pkg.version);
});
