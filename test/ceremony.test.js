'use strict';

// What the tool obliges an agent to read and write. `RULES.md` is imported by
// `CLAUDE.md`, so every word in it is paid on every turn of every session — and
// 61% of it was a second copy of policy the skills already carry. A rule written
// twice is a rule that will eventually disagree with itself, and the
// always-loaded copy is the one that wins by default.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES = path.join(__dirname, '..', 'templates');
const SKILLS = path.join(TEMPLATES, '.claude', 'skills');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');

function skillFiles() {
  return fs
    .readdirSync(SKILLS)
    .map((name) => path.join(SKILLS, name, 'SKILL.md'))
    .filter((file) => fs.existsSync(file));
}

test('RULES.md carries the rulebook, not a second copy of the workflow', () => {
  const rules = read(TEMPLATES, 'RULES.md');

  // Owned by /flow-run and /flow-review, which load only when they are used.
  for (const duplicated of [
    '### Intensity Modes',
    '### Context Ladder',
    '### Quality Gates',
    '### Choosing depth',
    '### Required Stop Conditions',
  ]) {
    assert.doesNotMatch(rules, new RegExp(duplicated), `${duplicated} belongs to the skills`);
  }

  // The constraints themselves are what this file is for, and none may be lost.
  for (const kept of [
    '### Architecture',
    '### Code Quality',
    '### Validation',
    '### Testing',
    '### Security',
    '### Core Behavior',
    '### Execution Flow',
    '### Context Boundaries',
  ]) {
    assert.match(rules, new RegExp(kept), `${kept} is a project constraint and must stay`);
  }
});

test('RULES.md stays small enough to pay for on every turn', () => {
  const words = read(TEMPLATES, 'RULES.md').split(/\s+/).filter(Boolean).length;
  // Was 1780. The budget exists so the next addition is a decision, not a drift.
  assert.ok(words < 900, `RULES.md is ${words} words; it is re-read on every turn`);
});

test('no template teaches a command the front door replaced', () => {
  // 0.5.2 promoted `ai-flow verify --story <dir>`; RULES.md and two skills still
  // taught `ai-flow harness verify`. That is the drift a second copy produces.
  for (const file of [...skillFiles(), path.join(TEMPLATES, 'RULES.md'), path.join(TEMPLATES, 'docs', 'conventions.md')]) {
    assert.doesNotMatch(
      fs.readFileSync(file, 'utf8'),
      /ai-flow harness verify/,
      `${path.relative(TEMPLATES, file)} teaches the superseded form`,
    );
  }
});

test('the STRICT trigger is about blast radius, not subject matter', () => {
  const run = read(SKILLS, 'flow-run', 'SKILL.md');

  // "touches user input" caught every form on every page; "touches persistence"
  // caught every feature that reads a row. STRICT then costs TDD and E2E on a
  // heading change.
  const trigger = run.slice(run.indexOf('## Choosing Intensity'), run.indexOf('### QUICK'));
  assert.doesNotMatch(trigger, /touches auth, permissions, admin surfaces, user input/);
  assert.match(trigger, /authorization decision/);
  assert.match(trigger, /trust boundary/);
});

test('the security constraints survive the ceremony cut', () => {
  const rules = read(TEMPLATES, 'RULES.md');

  // Part B trades ceremony for speed. It must not trade away the constraints:
  // these apply at every intensity, STRICT or not.
  for (const rule of [
    'Never expose secrets',
    'Check permissions server-side',
    'Validate server-side before persistence',
  ]) {
    assert.match(rules, new RegExp(rule, 'i'), `"${rule}" must survive`);
  }
});

test('verify stays non-skippable at every intensity', () => {
  const run = read(SKILLS, 'flow-run', 'SKILL.md');
  // Ceremony is negotiable; proof is not.
  assert.match(run, /Required at every intensity, non-skippable/);
  assert.match(run, /ai-flow verify --story/);
});
