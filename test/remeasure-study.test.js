'use strict';

// scripts/remeasure-study.js re-takes the Uncle Bob study's measures from a
// runs directory (story 15-06). A throwaway repository holds the epic index,
// the story folders, a DOGFOODING log and a runs directory written by hand.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'remeasure-study.js');
const EPIC = 'epics/epic-01-sample';
const STRICT_STORY = `${EPIC}/story-01-01-strict-one`;
const QUICK_STORY = `${EPIC}/story-01-02-quick-one`;
const UNREVIEWED_STORY = `${EPIC}/story-01-03-strict-unreviewed`;

function write(root, file, body) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof body === 'string' ? body : JSON.stringify(body));
}

function verifyRun(story, { ok = true, commandsOk = ok, tier, survived, failed = [] } = {}) {
  const run = { story, ok, commandsOk, ...(tier ? { coverage: { tier, ok: true } } : {}), ...(survived ? { mutation: { survived } } : {}) };
  for (const gate of failed) run[gate] = { ...(run[gate] || {}), ok: false };
  return run;
}

function reviewRun(story, p1, acceptedRisk) {
  return { story, verdict: 'pass', reviewer: 'subagent', findingCounts: { p0: 0, p1, p2: 0, p3: 0 }, ...(acceptedRisk ? { acceptedRisk } : {}) };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-remeasure-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, `${EPIC}/index.md`, [
    '# Epic 01', '', '## Stories', '',
    '1. **story-01-01-strict-one** — a long entry that wraps', '   onto a second line. *(STRICT)*',
    '2. **story-01-02-quick-one** *(QUICK)*',
    '3. **story-01-03-strict-unreviewed** *(STRICT)*', '',
  ].join('\n'));
  write(root, `${STRICT_STORY}/story.md`, '# Story\n');
  write(root, `${QUICK_STORY}/story.md`, '# Story\n');
  write(root, `${UNREVIEWED_STORY}/story.md`, '# Story\n');
  const runs = path.join(root, 'runs');
  const run = (stamp, kind, body) => write(runs, `${stamp}-${kind}.json`, body);
  run('2026-09-01T00-00-00-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'verified' }));
  run('2026-09-01T00-00-00-000Z', 'review', reviewRun(STRICT_STORY, 9));
  run('2026-10-20T00-00-00-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'verified', survived: [{}, {}] }));
  run('2026-10-20T00-00-01-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'evidence' }));
  run('2026-10-20T00-00-02-000Z', 'verify', verifyRun(STRICT_STORY, { ok: false, commandsOk: true, tier: 'evidence', failed: ['complexity'] }));
  run('2026-10-20T00-00-02-500Z', 'verify', verifyRun(STRICT_STORY, { ok: false, commandsOk: true, tier: 'evidence', failed: ['complexity'] }));
  run('2026-10-20T00-00-02-700Z', 'verify', verifyRun(QUICK_STORY, { ok: false, commandsOk: true, failed: ['claim'] }));
  run('2026-10-20T00-00-02-800Z', 'verify', verifyRun(UNREVIEWED_STORY, { tier: 'verified' }));
  run('2026-10-20T00-00-03-000Z', 'verify', verifyRun(QUICK_STORY, { ok: false, commandsOk: false }));
  run('2026-10-20T00-00-04-000Z', 'review', reviewRun(STRICT_STORY, 2, 'Four independent reviews + 1 alignment review.'));
  run('2026-10-20T00-00-05-000Z', 'review', reviewRun(STRICT_STORY, 2, 'Four independent reviews + 1 alignment review.'));
  run('2026-10-20T00-00-06-000Z', 'review', reviewRun(QUICK_STORY, 1, '3 STRICT reviews'));
  run('2026-10-20T00-00-07-000Z', 'review', reviewRun(QUICK_STORY, 0));
  run('2026-10-20T00-00-08-000Z', 'review', reviewRun(QUICK_STORY, 0));
  write(runs, 'not-a-run.txt', 'ignored');
  write(root, 'docs/DOGFOODING.md', [
    '| Date | Repository | Surface | Problem | Severity | Workaround | Resolution |',
    '|---|---|---|---|---|---|---|',
    '| 2026-11-01 | coding-flow | worktree land | it failed | high | none | open — not yet |',
    '| 2026-10-25 | coding-flow | worktree lock | it failed | low | none | fixed — done |',
    '| 2026-10-22 | coding-flow | verify | the proof went with its worktree | high | none | open |',
    '| 2026-09-01 | coding-flow | worktree place | too old | low | none | open |',
  ].join('\n'));
  return root;
}

function remeasure(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

test('runs before --since are not read, and verifies are counted by coverage tier', (t) => {
  const root = fixture(t);
  const result = remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);

  assert.equal(report.verifies.total, 7);
  assert.equal(report.verifies.green, 3);
  assert.deepStrictEqual(report.verifies.tiers, { verified: 2, evidence: 3, 'no tier': 2 });
  assert.equal(report.verifies.verifiedShare, 28.6);
  assert.equal(report.verifies.verifiedShareOfGreen, 66.7);
});

test('review passes: files and stated passes; only an identical non-empty re-record counts once', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  assert.equal(report.reviews.files, 5);
  assert.equal(report.reviews.counted, 4);
  const row = (name) => report.reviews.stories.find((entry) => entry.story === name);
  assert.deepStrictEqual(row('story-01-01-strict-one'), { story: 'story-01-01-strict-one', intensity: 'STRICT', reviewFiles: 1, statedPasses: 5, p1: 2 });
  // Two reviews with no text, at different moments, are two reviews.
  assert.deepStrictEqual(row('story-01-02-quick-one'), { story: 'story-01-02-quick-one', intensity: 'QUICK', reviewFiles: 3, statedPasses: 3, p1: 1 });
  assert.deepStrictEqual(row('story-01-03-strict-unreviewed'), { story: 'story-01-03-strict-unreviewed', intensity: 'STRICT', reviewFiles: 0, statedPasses: 0, p1: 0 });
});

test('gate reds are classified by gate, a repeat of the same story and gate counted once', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  assert.equal(report.gates.redRuns, 3);
  assert.deepStrictEqual(report.gates.byGate, { complexity: 1, claim: 1 });
  assert.deepStrictEqual(report.gates.stories, [
    { story: 'story-01-01-strict-one', gates: ['complexity'], runs: 2 },
    { story: 'story-01-02-quick-one', gates: ['claim'], runs: 1 },
  ]);
  assert.equal(report.gates.commandReds, 1);
  assert.equal(report.gates.reviewP1, 3);
  assert.equal('verifyShare' in report.gates, false);
  assert.deepStrictEqual(report.mutation, [{ story: 'story-01-01-strict-one', survivors: 2 }]);
});

test('DOGFOODING rows since the date: worktree surfaces, their open ones, and other rows naming a worktree', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  assert.equal(report.dogfooding.total, 3);
  assert.equal(report.dogfooding.worktree, 2);
  assert.equal(report.dogfooding.worktreeOpen, 1);
  assert.equal(report.dogfooding.mentionsWorktree, 1);
  assert.deepStrictEqual(report.dogfooding.wholeLog, { total: 4, worktree: 3 });
});

test('the text report prints each measure, and a missing --since is refused', (t) => {
  const root = fixture(t);
  const text = remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Verifies: 7 \(3 green\); at verified: 2 \(28\.6 % of all, 66\.7 % of green\)/);
  assert.match(text.stdout, /Reviews: 5 file\(s\), 4 counted \(1 identical re-record\(s\)\)/);
  assert.match(text.stdout, /STRICT story-01-01-strict-one: 1 review file\(s\), 5 pass\(es\) stated, 2 P1/);
  assert.match(text.stdout, /STRICT story-01-03-strict-unreviewed: no review recorded/);
  assert.match(text.stdout, /Gate reds: 3 run\(s\), 2 story\(ies\) by gate: claim 1, complexity 1; P1 recorded by review: 3; red on commands \(incl\. flakes\): 1/);
  assert.match(text.stdout, /story-01-01-strict-one: complexity \(2 run\(s\)\)/);
  assert.match(text.stdout, /Mutation survivors: story-01-01-strict-one 2/);
  assert.match(text.stdout, /DOGFOODING rows: 3; about worktrees: 2 \(1 open\); other rows naming a worktree: 1; whole log: 3 \/ 4 about worktrees/);

  const refused = remeasure(['--runs', path.join(root, 'runs')]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /usage: remeasure-study\.js/);
});
