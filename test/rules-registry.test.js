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

// Story 26-08 (moved from 26-06's criterion 5).
test('harness init writes coverageFloor and failOnContrarySignals with their defaults', { todo: 'story 26-08: init does not write these keys yet (moved out of 26-06)' }, (t) => {
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

// Story 26-08 (moved from 26-06's criterion 5), with the literal values and the real `init`.
test('init writes coverageFloor and failOnContrarySignals with the spec values', { todo: 'story 26-08: init does not write these keys yet (moved out of 26-06)' }, (t) => {
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

// Review round 2: a file that exists but cannot be read is not a missing file.
function writeRaw(dir, name, text) {
  fs.writeFileSync(path.join(dir, '.coding-flow', name), text);
}

test('an unreadable harness.json is named, and each rule shows what its consumer does without it', (t) => {
  const dir = project(t);
  writeRaw(dir, 'harness.json', '{"mode":"strict",');
  const json = rulesJson(dir);
  assert.deepEqual(json.unreadable, ['.coding-flow/harness.json']);
  const byKey = Object.fromEntries(json.rules.map((r) => [r.key, r]));

  // The guard keeps the primary lock and its destructive defaults (guard.js loadPolicy).
  assert.deepEqual([byKey['worktrees.primaryLocked'].value, byKey['worktrees.primaryLocked'].source], [true, 'fixed: harness.json unreadable']);
  assert.deepEqual([byKey.destructiveCommands.value, byKey.destructiveCommands.source], ['deny', 'fixed: harness.json unreadable']);
  for (const rule of json.rules.filter((r) => r.file === '.coding-flow/harness.json')) {
    assert.equal(rule.source, 'fixed: harness.json unreadable', rule.key);
  }
  assert.equal(byKey.mode.value, 'standard', 'the readers fall back to the default posture');
  assert.equal(byKey.storage.source, 'default', 'config.json is not affected');

  const plain = cli(dir, ['rules']);
  assert.equal(plain.code, 0, plain.out);
  assert.match(plain.out.split('\n')[0], /\.coding-flow\/harness\.json cannot be read/);
});

test('an unreadable config.json is named, and its rules show the defaults readConfig applies', (t) => {
  const dir = project(t);
  writeRaw(dir, 'config.json', '{"storage":');
  const json = rulesJson(dir);
  assert.deepEqual(json.unreadable, ['.coding-flow/config.json']);
  for (const rule of json.rules.filter((r) => r.file === '.coding-flow/config.json')) {
    assert.equal(rule.source, 'fixed: config.json unreadable', rule.key);
    assert.deepEqual(rule.value, registry.defaultOf(rule.key), rule.key);
  }
  assert.equal(json.rules.find((r) => r.key === 'mode').source, 'default');
  assert.match(cli(dir, ['rules']).out.split('\n')[0], /\.coding-flow\/config\.json cannot be read/);
  assert.deepEqual(rulesJson(project(t)).unreadable, []);
});

test('init on a project that already has proofs writes no key that would make them stale', (t) => {
  const { policyFingerprint } = require('../bin/lib/policy-fingerprint');
  const dir = project(t, { config: { storage: 'local' } });
  fs.mkdirSync(path.join(dir, '.coding-flow', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.coding-flow', 'runs', '2026-11-01T00-00-00-000Z-verify.json'), '{}');
  const before = policyFingerprint(dir);

  const res = cli(dir, ['init', '--minimal']);
  assert.equal(res.code, 0, res.out);
  const written = JSON.parse(fs.readFileSync(path.join(dir, '.coding-flow', 'harness.json'), 'utf8'));
  assert.equal(written.coverageFloor, undefined);
  assert.equal(policyFingerprint(dir), before, 'existing proofs stay valid');
});

test('ensureConfig writes the registry defaults', (t) => {
  const { ensureConfig } = require('../bin/lib/config');
  const rule = registry.ruleFor('storage');
  const original = rule.default;
  rule.default = 'github';
  t.after(() => { rule.default = original; });

  const dir = project(t);
  const { config } = ensureConfig(dir, { dryRun: true });
  for (const key of ['storage', 'branchPerEpic', 'skills', 'install', 'target']) {
    assert.deepEqual(config[key], registry.defaultOf(key), key);
  }
});

test('an explicit empty list is the project value; a null target says how the reader records it', (t) => {
  const dir = project(t, { config: { target: null, validation: { commands: ['npm test'], security: [], fix: [] } } });
  const byKey = Object.fromEntries(rulesJson(dir).rules.map((r) => [r.key, r]));
  assert.deepEqual([byKey['validation.security'].value, byKey['validation.security'].source], [[], 'project']);
  assert.deepEqual([byKey['validation.fix'].value, byKey['validation.fix'].source], [[], 'project']);
  assert.deepEqual([byKey.target.value, byKey.target.source], ['unrecognized', 'project (not a known target: recorded as "unrecognized")']);
});


// Review round 3: `rules` prints what the consumers' own resolvers return, and a
// file is unreadable only when its consumer says so.
const { decide } = require('../bin/lib/guard');

function committed(t, harnessText = null) {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], { cwd: dir });
  if (harnessText !== null) writeRaw(dir, 'harness.json', harnessText);
  return dir;
}

const switchDenied = (root, command, cwd = root) =>
  decide({ tool_name: 'Bash', cwd, tool_input: { command } }, root).decision === 'deny';

test('primaryLocked and unreadable agree with the guard for every shape of harness.json', (t) => {
  const cases = ['null', '[]', '"x"', '42', '{}', '{"mode":"strict",', '{"worktrees":{"primaryLocked":true}}'];
  for (const text of cases) {
    const dir = committed(t, text);
    const json = rulesJson(dir);
    const locked = json.rules.find((r) => r.key === 'worktrees.primaryLocked');
    assert.equal(locked.value, switchDenied(dir, 'git switch other'), text);
    const parses = (() => { try { JSON.parse(text); return true; } catch { return false; } })();
    assert.deepEqual(json.unreadable, parses ? [] : ['.coding-flow/harness.json'], text);
    if (parses && text !== '{"worktrees":{"primaryLocked":true}}') assert.equal(locked.source, 'default', text);
  }
});

test('config.json is unreadable only when readConfig cannot parse it', (t) => {
  for (const text of ['null', '[]', '"x"', '{"storage":']) {
    const dir = project(t);
    writeRaw(dir, 'config.json', text);
    const json = rulesJson(dir);
    const parses = text !== '{"storage":';
    assert.deepEqual(json.unreadable, parses ? [] : ['.coding-flow/config.json'], text);
    const storage = json.rules.find((r) => r.key === 'storage');
    assert.deepEqual([storage.value, storage.source], ['local', parses ? 'default' : 'fixed: config.json unreadable'], text);
  }
});

function linkedWorktree(t, primary) {
  const linked = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-rules-wt-'))), 'wt');
  t.after(() => fs.rmSync(path.dirname(linked), { recursive: true, force: true }));
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'side', linked], { cwd: primary });
  return linked;
}

test('from a linked worktree, primaryLocked follows the primary checkout as the guard does', (t) => {
  for (const [text, source] of [
    ['{"worktrees":{"primaryLocked":true}}', "project (the primary checkout's harness.json)"],
    ['{"mode":', "fixed: the primary checkout's harness.json unreadable"],
  ]) {
    const primary = committed(t, text);
    const linked = linkedWorktree(t, primary);
    const locked = rulesJson(linked).rules.find((r) => r.key === 'worktrees.primaryLocked');
    assert.equal(switchDenied(linked, `git -C ${primary} switch main`), true, text);
    assert.deepEqual([locked.value, locked.source], [true, source], text);
  }

  const open = committed(t);
  const linked = linkedWorktree(t, open);
  assert.equal(rulesJson(linked).rules.find((r) => r.key === 'worktrees.primaryLocked').value, false);
  assert.equal(switchDenied(linked, `git -C ${open} switch main`), false);
});

test('init in a linked worktree sees the proofs recorded in the primary checkout', (t) => {
  const primary = committed(t);
  fs.mkdirSync(path.join(primary, '.coding-flow', 'runs'), { recursive: true });
  fs.writeFileSync(path.join(primary, '.coding-flow', 'runs', '2026-11-01T00-00-00-000Z-verify.json'), '{}');
  const linked = linkedWorktree(t, primary);

  const res = cli(linked, ['harness', 'init']);
  assert.equal(res.code, 0, res.out);
  const written = JSON.parse(fs.readFileSync(path.join(linked, '.coding-flow', 'harness.json'), 'utf8'));
  assert.equal(written.coverageFloor, undefined, 'the plain defaults keep the recorded proofs valid');
});

// Review round 4: what the gates read at the diff base is part of the value in
// force (coverage-gate.js contraryPolicyInForce, baseRiskConfig;
// policy-drift.js policyGlobsAtBase).
test("a base commit's stricter contrary policy and risk lists are shown with the tree's", (t) => {
  const dir = committed(t, JSON.stringify({ mode: 'strict', failOnContrarySignals: true, highRiskPaths: ['pay/**'], policyGlobs: ['ci/**'] }));
  execFileSync('git', ['add', '-f', '.coding-flow/harness.json'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base policy'], { cwd: dir });
  writeRaw(dir, 'harness.json', JSON.stringify({ mode: 'standard', failOnContrarySignals: false, highRiskPaths: ['auth/**'], policyGlobs: ['ci/**'] }));

  const byKey = Object.fromEntries(rulesJson(dir).rules.map((r) => [r.key, r]));
  assert.deepEqual([byKey.failOnContrarySignals.value, byKey.failOnContrarySignals.source], [true, "project (base's true still applies)"]);
  assert.deepEqual([byKey.mode.value, byKey.mode.source], ['standard', "project (base's strict still applies to contrary signals)"]);
  assert.deepEqual(byKey.highRiskPaths.value, ['auth/**']);
  assert.equal(byKey.highRiskPaths.source, "project (the base's 1 globs also score risk)");
  assert.equal(byKey.policyGlobs.source, 'project', 'the same list at the base adds nothing');

  writeRaw(dir, 'harness.json', JSON.stringify({ mode: 'strict', failOnContrarySignals: true, highRiskPaths: ['pay/**'], policyGlobs: [] }));
  const same = Object.fromEntries(rulesJson(dir).rules.map((r) => [r.key, r]));
  assert.equal(same.failOnContrarySignals.source, 'project');
  assert.equal(same.mode.source, 'project');
  assert.equal(same.highRiskPaths.source, 'project');
  assert.equal(same.policyGlobs.source, "project (policy changes are found with the base's 1 globs)");
});

test('mode fast is shown as treated as standard', (t) => {
  const rule = ruleIn(project(t, { harness: { mode: 'fast' } }), 'mode');
  assert.deepEqual([rule.value, rule.source], ['fast', 'project (treated as standard)']);
});

// New series, round 1: a key other consumers extend is printed with what they
// add (claim.js claimPolicyGlobs, policy-drift.js OWN_POLICY_FILES,
// guard.js shellBlockedPaths, validation-run.js resolveCheckCommands).
test('policyGlobs says what readPolicyChanged and --claim refactor add to it', (t) => {
  const { claimPolicyGlobs } = require('../bin/lib/claim');
  const { OWN_POLICY_FILES } = require('../bin/lib/policy-drift');
  const dir = committed(t, JSON.stringify({ policyGlobs: [] }));
  const rule = ruleIn(dir, 'policyGlobs');
  assert.deepEqual(rule.value, []);
  for (const file of OWN_POLICY_FILES) assert.ok(rule.note.includes(file), rule.note);
  assert.ok(claimPolicyGlobs({ policyGlobs: [] }).length >= 15);
  assert.match(rule.note, new RegExp(`under --claim refactor, ${claimPolicyGlobs({ policyGlobs: [] }).length} globs`));
  assert.match(cli(dir, ['rules']).out, /policyGlobs .*also: .*--claim refactor/);
});

test('blockedPaths and validation.commands say what the guard and verify add', (t) => {
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e 0' } }));
  const byKey = Object.fromEntries(rulesJson(dir).rules.map((r) => [r.key, r]));
  assert.match(byKey.blockedPaths.note, /shell writes to \.coding-flow\/harness\.json/);
  assert.match(byKey['validation.commands'].note, /here 1 from package\.json/);

  // The note is what the guard does: with no blocked path at all, a shell
  // write to harness.json is still refused.
  const open = committed(t, JSON.stringify({ blockedPaths: [] }));
  assert.match(ruleIn(open, 'blockedPaths').note, /shell writes to \.coding-flow\/harness\.json/);
  assert.equal(switchDenied(open, 'echo {} > .coding-flow/harness.json'), true, 'the guard refuses the shell write');

  const declared = ruleIn(project(t, { config: { validation: { commands: ['npm test'] } } }), 'validation.commands');
  assert.equal(declared.note, null);
});

// New series, round 2: a story at a freshTestsFor risk runs freshCommands.
test('validation.commands names the freshCommands a fresh run uses instead', (t) => {
  const dir = project(t, { config: { validation: { freshCommands: ['npm run test:fresh'] } }, harness: { freshTestsFor: ['high'] } });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node -e 0' } }));
  const note = ruleIn(dir, 'validation.commands').note;
  assert.match(note, /here 1 from package\.json/);
  assert.match(note, /at a freshTestsFor risk level, verify runs 1 command\(s\) from config instead/);

  const both = ruleIn(project(t, { config: { validation: { commands: ['npm test'], freshCommands: ['npm run test:fresh'] } } }), 'validation.commands');
  assert.match(both.note, /at a freshTestsFor risk level, verify runs 1 command\(s\) from config instead/);
});

test('requiredChecks is described as the names the contract lists', () => {
  assert.match(registry.ruleFor('requiredChecks').doc, /lists/);
  assert.match(registry.ruleFor('requiredChecks').doc, /nothing runs them/);
});
