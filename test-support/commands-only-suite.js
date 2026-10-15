'use strict';

// The same contract for every platform whose skills are rendered as host commands
// (Gemini, OpenCode, Antigravity): init renders valid files and a hostile
// description survives the renderer's escaping. The guard tests split on whether
// the platform has a verified guard: without one (Gemini, Antigravity), doctor
// states the gap as a note and report shows commands-only; with one (OpenCode),
// it is wired by default. Each platform's test file calls `defineSuite` with its
// own location and strict parser.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const SKILLS = ['flow-next', 'flow-plan', 'flow-review', 'flow-run', 'flow-setup', 'flow-ship', 'flow-status'];

function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-cmdonly-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(cwd, args) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: path.join(cwd, '.no-claude-config'), CLAUDE_PLUGIN_ROOT: '' };
  delete env.CLAUDECODE;
  delete env.OPENCODE;
  return execFileSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Without python the strict parse cannot run, so fall back to a structural check
// of the one line that breaks: a double-quoted description whose inner quotes are
// all escaped. Weaker than a parser, but a skip must not mean no evidence.
function structuralCheck(kind, file) {
  const text = fs.readFileSync(file, 'utf8');
  const key = kind === 'toml' ? /^description = "((?:[^"\\]|\\.)*)"$/m : /^description: "((?:[^"\\]|\\.)*)"$/m;
  assert.match(text, key, `${file}: description is not a well-formed quoted string`);
}

// A real parser, run through python3 (tomllib / PyYAML). Null when it is absent,
// so the caller falls back to the structural check.
function pythonParse(kind, file) {
  const code = kind === 'toml'
    ? 'import sys,tomllib,json;print(json.dumps(tomllib.load(open(sys.argv[1],"rb"))))'
    : 'import sys,yaml,json;t=open(sys.argv[1]).read().split("---",2);print(json.dumps(yaml.safe_load(t[1])))';
  const res = spawnSync('python3', ['-c', code, file], { encoding: 'utf8' });
  if (res.error || /No module named/.test(res.stderr)) return null;
  assert.equal(res.status, 0, `${file} did not parse:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

function defineSuite({ target, files, parser, describe }) {
  // `files(name)` is the project-relative path of one rendered command.
  const read = (dir, name) => fs.readFileSync(path.join(dir, files(name)), 'utf8');
  const guarded = Boolean(require('../bin/lib/platforms/registry').COMMAND_PLATFORMS[target].guard);
  // The gap tests describe a platform with no guard: not declared at all for one
  // that has it (its own test file covers the guard), rather than shown as skipped.
  const gapTest = guarded ? () => {} : test;

  test(`${target}: init writes one command per skill and records the target`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'config.json'), 'utf8')).target, target);
    for (const name of SKILLS) assert.ok(fs.existsSync(path.join(dir, files(name))), files(name));
    assert.equal(fs.existsSync(path.join(dir, '.claude')), false);
    assert.equal(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  });

  test(`${target}: every rendered file parses with a strict ${parser} parser`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    for (const name of SKILLS) {
      const parsed = pythonParse(parser, path.join(dir, files(name)));
      if (parsed === null) { structuralCheck(parser, path.join(dir, files(name))); continue; }
      assert.ok(describe(parsed), `${name} lost its description`);
      assert.ok(String(describe(parsed)).length > 10);
    }
  });

  test(`${target}: a description with ":", quotes and backslashes survives a round trip`, (t) => {
    const hostile = 'Run it: say "go" \\ then `stop`';
    const { render } = require('../bin/lib/platforms/registry').COMMAND_PLATFORMS[target];
    const { relPath, content } = render(`---\nname: flow-x\ndescription: ${hostile}\n---\n\nBody with a \\ backslash and """ quotes and ''' too.\n`);
    const dir = project(t);
    const file = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    const parsed = pythonParse(parser, file);
    if (parsed === null) return structuralCheck(parser, file);
    assert.equal(describe(parsed), hostile);
    if (parser === 'toml') assert.match(parsed.prompt, /\\ backslash and """ quotes and ''' too/);
  });

  gapTest(`${target}: the guard gap is real — init wires no guard file or hook`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    const out = cli(dir, ['upgrade']);
    assert.doesNotMatch(out, /Guard plugin/);
    assert.equal(fs.existsSync(path.join(dir, '.opencode', 'plugins')), false);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
    const evidence = cli(dir, ['report']);
    assert.match(evidence, /enforcementTier: commands-only/);
  });

  gapTest(`${target}: an install added beside OpenCode's keeps its guard and adds none`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', 'opencode']);
    const plugin = path.join(dir, '.opencode', 'plugins', 'coding-flow-guard.js');
    const before = fs.readFileSync(plugin, 'utf8');
    cli(dir, ['init', '--target', target]);
    // OpenCode's own guard is kept as it was; this platform adds no hook of its own.
    assert.equal(fs.readFileSync(plugin, 'utf8'), before);
    assert.equal(fs.existsSync(path.join(dir, '.claude', 'settings.json')), false);
    assert.deepEqual(JSON.parse(cli(dir, ['doctor', '--json'])).errors, []);
  });

  gapTest(`${target}: doctor states the guard gap as a note, never as an error or warning`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    const report = JSON.parse(cli(dir, ['doctor', '--json']));
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.deepEqual(report.errors, []);
    assert.ok(report.notes.some((n) => /guard not available on this host/.test(n.message)));
    assert.equal(report.warnings.some((w) => /guard not available/.test(w.message)), false);
    assert.match(cli(dir, ['doctor']), /guard not available on this host/);
  });

  test(`${target}: doctor reports a deleted command as an error, and --fix restores it`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    fs.rmSync(path.join(dir, files('flow-run')));
    const broken = JSON.parse(spawnSync(process.execPath, [CLI, 'doctor', '--json'], { cwd: dir, encoding: 'utf8' }).stdout);
    assert.equal(broken.ok, false);
    cli(dir, ['doctor', '--fix']);
    assert.ok(fs.existsSync(path.join(dir, files('flow-run'))));
  });

  gapTest(`${target}: report shows enforcementTier commands-only and no probe result`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    const out = cli(dir, ['report']);
    const section = out.split('## Platform coverage')[1].split('## Guard denials')[0];
    assert.match(section, new RegExp(`\\| ${target} \\|`));
    assert.match(section, /enforcementTier: commands-only/);
    assert.doesNotMatch(section, /probe/i);
  });

  test(`${target}: a second init keeps a locally edited command`, (t) => {
    const dir = project(t);
    cli(dir, ['init', '--target', target]);
    fs.appendFileSync(path.join(dir, files('flow-run')), '\nlocal edit\n');
    const before = read(dir, 'flow-run');
    cli(dir, ['init', '--target', target]);
    assert.equal(read(dir, 'flow-run'), before);
  });
}

module.exports = { defineSuite, SKILLS };
