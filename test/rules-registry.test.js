'use strict';

// Story 26-06: one registry of the rules a user can see and change, printed by
// `ai-flow rules` with the value in force and where it came from, and kept
// equal to docs/rules-and-limits.md by a test rather than by memory.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'ai-flow.js');
const registry = require('../bin/lib/rules-registry');

function project(t, { config, harness } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-rules-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  if (config) fs.writeFileSync(path.join(dir, '.coding-flow', 'config.json'), JSON.stringify(config));
  if (harness) fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify(harness));
  return dir;
}

function cli(cwd, args) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
  return { code: res.status, out: `${res.stdout}${res.stderr}`, stdout: res.stdout };
}

function rulesJson(cwd) {
  const res = cli(cwd, ['rules', '--json']);
  assert.equal(res.code, 0, res.out);
  return JSON.parse(res.stdout);
}

// Criterion 1.
test('with no config every registry key is listed with source default; a project value says project', (t) => {
  const bare = rulesJson(project(t));
  const keys = registry.RULES.map((rule) => rule.key);

  assert.deepEqual(bare.rules.map((rule) => rule.key), keys);
  for (const rule of bare.rules.filter((r) => r.scope === 'project')) {
    assert.equal(rule.source, 'default', `${rule.key} has no project value`);
    assert.deepEqual(rule.value, registry.defaultOf(rule.key), `${rule.key} shows its default`);
  }

  const set = rulesJson(project(t, { config: { autoMergeEpic: true }, harness: { mode: 'strict', minPatchCoverage: 90 } }));
  const byKey = Object.fromEntries(set.rules.map((rule) => [rule.key, rule]));
  assert.deepEqual([byKey.autoMergeEpic.value, byKey.autoMergeEpic.source], [true, 'project']);
  assert.deepEqual([byKey.mode.value, byKey.mode.source], ['strict', 'project']);
  assert.deepEqual([byKey.minPatchCoverage.value, byKey.minPatchCoverage.source], [90, 'project']);
  assert.equal(byKey.branchPerEpic.source, 'default');
});

test('a project value the reader refuses is reported as ignored, and the default shown', (t) => {
  const byKey = Object.fromEntries(rulesJson(project(t, { config: { storage: 'ftp' } })).rules.map((r) => [r.key, r]));

  assert.equal(byKey.storage.value, 'local');
  assert.match(byKey.storage.source, /^default \(project value ignored\)/);
});

// Criterion 2, the part that ships today: an `auto` rule names its reason.
// `run.maxAgents` itself is 24-02's (see plan.md, D2).
test('an auto rule prints its reason and follows what it reads', (t) => {
  const standard = rulesJson(project(t)).rules.find((r) => r.key === 'coverageFloor.high');
  assert.equal(standard.value, 'evidence');
  assert.equal(standard.source, 'auto: mode standard → evidence');

  const strict = rulesJson(project(t, { harness: { mode: 'strict' } })).rules.find((r) => r.key === 'coverageFloor.high');
  assert.equal(strict.source, 'auto: mode strict → verified');

  const pinned = rulesJson(project(t, { harness: { mode: 'strict', coverageFloor: { high: 'evidence' } } }))
    .rules.find((r) => r.key === 'coverageFloor.high');
  assert.deepEqual([pinned.value, pinned.source], ['evidence', 'project']);
});

test('the plain output prints value, source and cap, and one key on request', (t) => {
  const dir = project(t, { harness: { mode: 'strict' } });
  const all = cli(dir, ['rules']);

  assert.equal(all.code, 0, all.out);
  assert.match(all.stdout, /^mode\s+strict\s+project\b/m);
  assert.match(all.stdout, /^validation\.timeoutMs\s+600000 ms\s+default\b/m);

  const one = cli(dir, ['rules', 'minPatchCoverage']);
  assert.equal(one.code, 0, one.out);
  assert.match(one.stdout, /minPatchCoverage/);
  assert.match(one.stdout, /80/);
  assert.doesNotMatch(one.stdout, /^mode\b/m, 'only the key asked for');

  const unknown = cli(dir, ['rules', 'noSuchRule']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.out, /unknown rule "noSuchRule"/);
});

test('rules prints no environment value and registers no secret-looking key', (t) => {
  const dir = project(t);
  const res = spawnSync(process.execPath, [CLI, 'rules', '--json'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, CODING_FLOW_TEST_SECRET_VALUE: 'tok-9f8e7d6c5b4a' },
  });

  assert.equal(res.status, 0);
  assert.doesNotMatch(res.stdout, /tok-9f8e7d6c5b4a/);
  for (const rule of registry.RULES) {
    assert.doesNotMatch(rule.key, /secret|token|password|credential|api.?key/i, rule.key);
  }
});

// Criterion 3.
test('every registry key is in docs/rules-and-limits.md with the same default', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'rules-and-limits.md'), 'utf8');
  assert.deepEqual(registry.docMismatches(doc), []);
});

test('a registry default changed without the doc fails and names the key', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'rules-and-limits.md'), 'utf8');
  const changed = registry.RULES.map((rule) => (rule.key === 'minPatchCoverage' ? { ...rule, default: 85 } : rule));
  const mismatches = registry.docMismatches(doc, changed);

  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].key, 'minPatchCoverage');
  assert.match(mismatches[0].message, /minPatchCoverage/);
  assert.match(mismatches[0].message, /`85`/);
});

// Criterion 4.
test('the land lock and the command runner read the one timeout default', (t) => {
  const rule = registry.RULES.find((r) => r.key === 'validation.timeoutMs');
  const saved = rule.default;
  t.after(() => { rule.default = saved; });

  const { landLockTimeouts } = require('../bin/lib/worktree');
  const fiveMinutes = 5 * 60 * 1000;
  rule.default = 60 * 60 * 1000;
  assert.equal(landLockTimeouts(1).staleMs, 60 * 60 * 1000 + fiveMinutes, 'the land lock follows the registry');

  const { commandTimeoutDefault } = require('../bin/lib/validation-run');
  assert.equal(commandTimeoutDefault(), 60 * 60 * 1000, 'the runner follows the registry');
});

// Criterion 5.
test('harness init writes coverageFloor and failOnContrarySignals with their defaults', (t) => {
  const dir = project(t);
  fs.rmSync(path.join(dir, '.coding-flow'), { recursive: true, force: true });
  const res = cli(dir, ['harness', 'init']);
  assert.equal(res.code, 0, res.out);

  const written = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'harness.json'), 'utf8'));
  assert.deepEqual(written.coverageFloor, {
    high: registry.defaultOf('coverageFloor.high'),
    medium: registry.defaultOf('coverageFloor.medium'),
    low: registry.defaultOf('coverageFloor.low'),
  });
  assert.equal(written.failOnContrarySignals, registry.defaultOf('failOnContrarySignals'));
});

test('a written coverageFloor.high of auto still follows the mode', () => {
  const { resolveCoverageFloor } = require('../bin/lib/coverage');
  const floor = { high: 'auto', medium: 'evidence', low: 'not-required' };

  assert.equal(resolveCoverageFloor({ mode: 'standard', coverageFloor: floor }).high, 'evidence');
  assert.equal(resolveCoverageFloor({ mode: 'strict', coverageFloor: floor }).high, 'verified');
});

// Criterion 6.
test('templates/RULES.md and the flow-run skill state the same context budgets', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'templates', '.claude', 'skills', 'flow-run', 'SKILL.md'), 'utf8');
  const rules = fs.readFileSync(path.join(ROOT, 'templates', 'RULES.md'), 'utf8');
  const budgets = registry.contextBudgets();

  for (const budget of budgets) {
    assert.ok(skill.includes(budget.text), `flow-run states "${budget.text}" (${budget.key})`);
  }

  // RULES.md may only point at the skill, or state the very same numbers.
  const stated = registry.budgetNumbersIn(rules);
  const allowed = registry.budgetNumbersIn(budgets.map((b) => b.text).join('\n'));
  for (const number of stated) {
    assert.ok(allowed.includes(number), `RULES.md states "${number}", which flow-run does not`);
  }
});

test('the flow-plan skill says epic size is warned above the doctor limit', () => {
  const plan = fs.readFileSync(path.join(ROOT, 'templates', '.claude', 'skills', 'flow-plan', 'SKILL.md'), 'utf8');
  assert.ok(plan.includes(`warned above ${registry.defaultOf('epic.maxStories')}`), 'flow-plan names the doctor limit');
});

test('doctor points to ai-flow rules', (t) => {
  const dir = project(t);
  const res = cli(dir, ['doctor']);
  assert.match(res.out, /ai-flow rules/);
});

// The rules 29-03 added are read the way the guard reads them.
test('the destructive-command rules show what the guard applies', (t) => {
  const byKey = (dir) => Object.fromEntries(rulesJson(dir).rules.map((r) => [r.key, r]));

  const bare = byKey(project(t));
  assert.deepEqual([bare.destructiveCommands.value, bare.destructiveCommands.source], ['deny', 'default']);
  assert.deepEqual([bare['worktrees.primaryLocked'].value, bare['worktrees.primaryLocked'].source], [false, 'default']);

  const set = byKey(project(t, { harness: { destructiveCommands: 'deny', allowDestructive: ['rm -rf node_modules', 'rm *'], worktrees: { primaryLocked: true } } }));
  assert.deepEqual([set.destructiveCommands.value, set.destructiveCommands.source], ['deny', 'project']);
  assert.deepEqual(set.allowDestructive.value, ['rm -rf node_modules'], 'a too-broad entry is not applied');
  assert.equal(set.allowDestructive.source, 'project (cleaned by the reader)');
  assert.deepEqual([set['worktrees.primaryLocked'].value, set['worktrees.primaryLocked'].source], [true, 'project']);

  const typo = byKey(project(t, { harness: { destructiveCommands: 'of' } }));
  assert.deepEqual([typo.destructiveCommands.value, typo.destructiveCommands.source], ['deny', 'default (project value ignored)']);
});

// Review round 1: every value is the one the consumer applies, read through
// the consumer's own normalisation — never the raw merged file.
function ruleIn(dir, key) {
  return rulesJson(dir).rules.find((r) => r.key === key);
}

test('init then rules: the fresh coverageFloor.high of auto is an auto rule, not an ignored value', (t) => {
  const dir = project(t);
  fs.rmSync(path.join(dir, '.coding-flow'), { recursive: true, force: true });
  const res = cli(dir, ['init', '--minimal']);
  assert.equal(res.code, 0, res.out);

  const high = ruleIn(dir, 'coverageFloor.high');
  assert.deepEqual([high.value, high.source], ['evidence', 'auto: mode standard → evidence']);
  assert.doesNotMatch(cli(dir, ['rules']).out, /project value ignored/, 'a fresh project ignores nothing');
});

test('a mode typo is shown ignored, and the auto floor names the mode it read', (t) => {
  const typo = project(t, { harness: { mode: 'Strict' } });
  const mode = ruleIn(typo, 'mode');
  assert.deepEqual([mode.value, mode.source], ['standard', 'default (project value ignored)']);
  assert.equal(ruleIn(typo, 'coverageFloor.high').source, 'auto: mode Strict → evidence');

  const fast = ruleIn(project(t, { harness: { mode: 'fast' } }), 'coverageFloor.high');
  assert.deepEqual([fast.value, fast.source], ['evidence', 'auto: mode fast → evidence']);
});

test('the auto floor matches what the coverage reader resolves', (t) => {
  const { defaultCoverageFloor } = require('../bin/lib/coverage');
  for (const mode of ['standard', 'strict', 'fast', 'Strict']) {
    assert.equal(ruleIn(project(t, { harness: { mode } }), 'coverageFloor.high').value, defaultCoverageFloor(mode).high, mode);
  }
});

test('functionSize is shown as the complexity gate reads it', (t) => {
  const dir = project(t, { harness: { functionSize: { enforce: 'true', max: '40' } } });
  const enforce = ruleIn(dir, 'functionSize.enforce');
  assert.deepEqual([enforce.value, enforce.source], [false, 'default (project value ignored)']);
  const max = ruleIn(dir, 'functionSize.max');
  assert.deepEqual([max.value, max.source], [40, 'project (cleaned by the reader)']);
});

test('redAtBase is shown as the red-at-base run reads it', (t) => {
  const dir = project(t, { harness: { redAtBase: { timeoutMs: 'x', command: '  npm test -- {files}  ' } } });
  const timeout = ruleIn(dir, 'redAtBase.timeoutMs');
  assert.deepEqual([timeout.value, timeout.source], [null, 'default (project value ignored)']);
  const command = ruleIn(dir, 'redAtBase.command');
  assert.deepEqual([command.value, command.source], ['npm test -- {files}', 'project (cleaned by the reader)']);
});

test('failOnContrarySignals is shown as the coverage gate reads it', (t) => {
  const rule = ruleIn(project(t, { harness: { failOnContrarySignals: 'yes' } }), 'failOnContrarySignals');
  assert.deepEqual([rule.value, rule.source], [false, 'default (project value ignored)']);
});

test('a malformed value read by readHarnessConfig or readConfig is shown ignored', (t) => {
  const dir = project(t, {
    config: { branchPerEpic: 'no', validation: { timeoutMs: -1 } },
    harness: { requireTestChange: 'false', minPatchCoverage: '90', testGlobs: 'test/**' },
  });
  for (const key of ['branchPerEpic', 'validation.timeoutMs', 'requireTestChange', 'minPatchCoverage', 'testGlobs']) {
    const rule = ruleIn(dir, key);
    assert.equal(rule.source, 'default (project value ignored)', key);
    assert.deepEqual(rule.value, registry.defaultOf(key), key);
  }
});

test('harness init --force on an existing file keeps every proof valid and writes what it prints', (t) => {
  const { policyFingerprint } = require('../bin/lib/policy-fingerprint');
  const dir = project(t, { harness: { mode: 'standard', minPatchCoverage: 85 } });
  const before = policyFingerprint(dir);

  const dry = cli(dir, ['harness', 'init', '--force', '--dry-run']);
  assert.equal(dry.code, 0, dry.out);
  assert.doesNotMatch(dry.stdout, /coverageFloor|failOnContrarySignals/, 'a dry run prints only what would be written');

  const res = cli(dir, ['harness', 'init', '--force']);
  assert.equal(res.code, 0, res.out);
  const written = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'harness.json'), 'utf8'));
  assert.equal(written.coverageFloor, undefined);
  assert.equal(written.failOnContrarySignals, undefined);
  assert.equal(policyFingerprint(dir), before, 'the fingerprint is unchanged');
});

// Criterion 5, with the spec's literal values and the real `init`.
test('init writes coverageFloor and failOnContrarySignals with the spec values', (t) => {
  for (const args of [['init', '--minimal'], ['harness', 'init']]) {
    const dir = project(t);
    fs.rmSync(path.join(dir, '.coding-flow'), { recursive: true, force: true });
    const res = cli(dir, args);
    assert.equal(res.code, 0, res.out);
    const written = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'harness.json'), 'utf8'));
    assert.deepEqual(written.coverageFloor, { high: 'auto', medium: 'evidence', low: 'not-required' }, args.join(' '));
    assert.equal(written.failOnContrarySignals, false, args.join(' '));
  }
});
