'use strict';

// Story 16-01: benchmark task 5 (2026-10-17) went green on a reading nobody
// confirmed — "the proof proved the plan, not the request". /flow-plan asks in
// rounds with a recommendation per question, an unconfirmed behaviour-changing
// reading keeps the epic `not ready`, and /flow-run will not implement a story
// that still carries one.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'templates', '.claude', 'skills');

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing section ${heading}`);
  const level = heading.match(/^#+/)[0];
  const rest = text.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n${level} `));
  return flat(next === -1 ? rest : rest.slice(0, next));
}

test('Clarify First asks in rounds of at most 4, each question opening with its recommendation', () => {
  const clarify = section(read(SKILLS, 'flow-plan', 'SKILL.md'), '## Clarify First');
  assert.match(clarify, /rounds? of at most 4 questions/i);
  assert.match(clarify, /decision frontier/i);
  assert.match(clarify, /opens with its recommended answer/i);
  assert.match(clarify, /looked up, never asked/i);
  assert.match(clarify, /5–15 questions, 10–20 for auth, migration, billing, permissions or data model/);
});

test('an unconfirmed behaviour-changing reading keeps the epic not ready; a headless run stops with the question', () => {
  const gate = section(read(SKILLS, 'flow-plan', 'SKILL.md'), '### Readiness Gate');
  assert.match(gate, /Assumption \(unconfirmed\)/);
  assert.match(gate, /stays \*\*`not ready`\*\*/);
  assert.match(gate, /headless/i);
  assert.match(gate, /never picks the answer/i);
  assert.match(gate, /accept(ing|ed)? the recommendations? (counts as|is) confirm/i);
});

test('/flow-run stops on a story that carries an unconfirmed assumption', () => {
  const stops = section(read(SKILLS, 'flow-run', 'SKILL.md'), '## Stop Conditions');
  assert.match(stops, /`Assumption \(unconfirmed\)`/);
  assert.match(stops, /until the user confirms it/);
});

test('the plan verification checks no criterion rests on an unconfirmed reading', () => {
  const verification = section(read(SKILLS, 'flow-plan', 'SKILL.md'), '## Verification');
  assert.match(verification, /Assumption \(unconfirmed\)/);
});

test('design decision 16 records what was taken from mattpocock/skills, what was refused, and the unverified Codex claim', () => {
  const decisions = read(ROOT, 'docs', 'design-decisions.md');
  const entry = section(decisions, '## 16. ');
  assert.match(entry, /mattpocock\/skills/);
  assert.match(entry, /\*\*Taken:\*\*/);
  assert.match(entry, /\*\*Not taken:\*\*/);
  assert.match(entry, /git-guardrails/);
  assert.match(entry, /grilling/);
  assert.match(entry, /Codex/);
  assert.match(entry, /unverified/i);
});

test('the benchmark task-5 row points at epic 16', () => {
  const row = read(ROOT, 'docs', 'DOGFOODING.md')
    .split('\n')
    .find((line) => line.includes('benchmark (story 11-03)'));
  assert.ok(row, 'task-5 benchmark row missing');
  assert.match(row, /epic 16/i);
});
