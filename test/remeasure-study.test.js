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

function write(root, file, body) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), typeof body === 'string' ? body : JSON.stringify(body));
}

function verifyRun(story, { ok = true, commandsOk = ok, tier, survived } = {}) {
  return { story, ok, commandsOk, ...(tier ? { coverage: { tier } } : {}), ...(survived ? { mutation: { survived } } : {}) };
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
    '2. **story-01-02-quick-one** *(QUICK)*', '',
  ].join('\n'));
  write(root, `${STRICT_STORY}/story.md`, '# Story\n');
  write(root, `${QUICK_STORY}/story.md`, '# Story\n');
  const runs = path.join(root, 'runs');
  const run = (stamp, kind, body) => write(runs, `${stamp}-${kind}.json`, body);
  run('2026-09-01T00-00-00-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'verified' }));
  run('2026-09-01T00-00-00-000Z', 'review', reviewRun(STRICT_STORY, 9));
  run('2026-10-20T00-00-00-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'verified', survived: [{}, {}] }));
  run('2026-10-20T00-00-01-000Z', 'verify', verifyRun(STRICT_STORY, { tier: 'evidence' }));
  run('2026-10-20T00-00-02-000Z', 'verify', verifyRun(STRICT_STORY, { ok: false, commandsOk: true, tier: 'evidence' }));
  run('2026-10-20T00-00-03-000Z', 'verify', verifyRun(QUICK_STORY, { ok: false, commandsOk: false }));
  run('2026-10-20T00-00-04-000Z', 'review', reviewRun(STRICT_STORY, 2, 'Four independent reviews + 1 alignment review.'));
  run('2026-10-20T00-00-05-000Z', 'review', reviewRun(STRICT_STORY, 2, 'Four independent reviews + 1 alignment review.'));
  run('2026-10-20T00-00-06-000Z', 'review', reviewRun(QUICK_STORY, 1, '3 STRICT reviews'));
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

  assert.equal(report.verifies.total, 4);
  assert.equal(report.verifies.green, 2);
  assert.deepStrictEqual(report.verifies.tiers, { verified: 1, evidence: 2, 'no tier': 1 });
  assert.equal(report.verifies.verifiedShare, 25);
  assert.equal(report.verifies.verifiedShareOfGreen, 50);
});

test('review passes: the files recorded and the passes their text states, a re-record counted once', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  const strict = report.reviews.stories.find((row) => row.story === 'story-01-01-strict-one');
  assert.deepStrictEqual(strict, { story: 'story-01-01-strict-one', intensity: 'STRICT', reviewFiles: 1, statedPasses: 5, p1: 2 });
  const quick = report.reviews.stories.find((row) => row.story === 'story-01-02-quick-one');
  assert.deepStrictEqual(quick, { story: 'story-01-02-quick-one', intensity: 'QUICK', reviewFiles: 1, statedPasses: 3, p1: 1 });
});

test('a gate red counts as caught by verify; a red on commands is counted apart', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  assert.deepStrictEqual(report.catches, { gateReds: 1, commandReds: 1, reviewP1: 3, verifyShare: 25 });
  assert.deepStrictEqual(report.mutation, [{ story: 'story-01-01-strict-one', survivors: 2 }]);
});

test('DOGFOODING rows since the date: worktree surfaces, their open ones, and other rows naming a worktree', (t) => {
  const root = fixture(t);
  const report = JSON.parse(remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root, '--json']).stdout);

  assert.equal(report.dogfooding.total, 3);
  assert.equal(report.dogfooding.worktree, 2);
  assert.equal(report.dogfooding.worktreeOpen, 1);
  assert.equal(report.dogfooding.mentionsWorktree, 1);
});

test('the text report prints each measure, and a missing --since is refused', (t) => {
  const root = fixture(t);
  const text = remeasure(['--runs', path.join(root, 'runs'), '--since', '2026-10-18', '--root', root]);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Verifies: 4 \(2 green\); at verified: 1 \(25 % of all, 50 % of green\)/);
  assert.match(text.stdout, /STRICT story-01-01-strict-one: 1 review file\(s\), 5 pass\(es\) stated, 2 P1/);
  assert.match(text.stdout, /Caught by a verify gate: 1; P1 recorded by review: 3; verify share 25 %/);
  assert.match(text.stdout, /Mutation survivors: story-01-01-strict-one 2/);
  assert.match(text.stdout, /DOGFOODING rows: 3; about worktrees: 2 \(1 open\); other rows naming a worktree: 1/);

  const refused = remeasure(['--runs', path.join(root, 'runs')]);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /usage: remeasure-study\.js/);
});
