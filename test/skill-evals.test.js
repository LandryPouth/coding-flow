'use strict';

// The engine has hundreds of tests; until this file the seven skills had none.
// A skill that never triggers is a skill that does not exist, and nothing proved
// that `flow-status` wins "show me every epic" while losing "what should I do
// next" to `flow-next`.
//
// Two tiers, both deterministic, both free — see evals/README.md. This wrapper
// exists so they ride the repo's existing `node --test` into CI rather than
// needing a second command someone has to remember.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  loadSkills,
  loadCases,
  lintSkills,
  lintCases,
  tokenize,
  buildIndex,
  rank,
  runTriggerEvals,
} = require('../scripts/skill-evals.js');

// The floor CI enforces, deliberately below the checked-in baseline (86.4%) so
// an unrelated description edit does not turn CI red the moment it moves one
// prompt. Raise it as routing improves; never lower it to make a regression pass.
const MIN_RANK1 = 80;

test('every skill is well-formed: frontmatter, naming, size, exit criteria', () => {
  const problems = lintSkills();
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('every skill ships an eval case file with enough prompts', () => {
  const problems = lintCases();
  assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
});

test('every realistic prompt routes to the skill that owns it', () => {
  const { failures } = runTriggerEvals();
  assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
});

test('no two skill descriptions collide', () => {
  const { collisions } = runTriggerEvals();
  const blocking = collisions.filter((c) => c.level === 'error');
  assert.deepEqual(
    blocking.map((c) => `${c.a} <-> ${c.b} at ${(c.similarity * 100).toFixed(0)}%`),
    [],
    'two descriptions this similar make the router coin-flip between them',
  );
});

test('the rank-1 rate stays above the floor', () => {
  const { rank1Rate, positives } = runTriggerEvals();
  assert.ok(positives >= 20, `only ${positives} prompts — the rate would not mean much`);
  assert.ok(
    rank1Rate >= MIN_RANK1,
    `rank-1 fell to ${rank1Rate}%, under the ${MIN_RANK1}% floor. Fix the description, not the floor.`,
  );
});

// --- the eval machinery itself ------------------------------------------------
//
// Without these, a bug that made every score zero would still let the suite pass
// on some prompts by alphabetical tie-break, and the tier would quietly measure
// nothing.

test('tokenizing drops stopwords and filler, and folds plurals to one stem', () => {
  assert.deepEqual(tokenize('What are the stories?'), ['story']);
  assert.deepEqual(tokenize('make sure the tests actually pass'), ['make', 'test', 'pass']);
  assert.deepEqual(tokenize('story'), tokenize('stories'));
});

test('scoring separates a matched prompt from an unmatched one', () => {
  const index = buildIndex(loadSkills());
  const matched = rank('open a pull request for this branch', index);
  const unmatched = rank('zzzz qqqq wwww', index);

  assert.ok(matched[0].score > 0, 'a prompt that matches must score above zero');
  assert.equal(unmatched[0].score, 0, 'a prompt matching nothing must score zero everywhere');
  assert.ok(
    matched[0].score > matched[matched.length - 1].score,
    'the ranking must actually discriminate, not return a flat list',
  );
});

test('ties break deterministically, so a run is reproducible', () => {
  const index = buildIndex(loadSkills());
  const first = rank('zzzz qqqq wwww', index).map((row) => row.skill);
  const again = rank('zzzz qqqq wwww', index).map((row) => row.skill);

  assert.deepEqual(first, again);
  assert.deepEqual(first, [...first].sort(), 'an all-zero ranking falls back to alphabetical order');
});

test('the catalog and its cases actually loaded — an empty run proves nothing', () => {
  assert.equal(loadSkills().length, 7, 'seven skills are expected on disk');
  assert.equal(loadCases().length, 7, 'one eval case file per skill');
});
