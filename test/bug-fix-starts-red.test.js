'use strict';

// Story 16-02: the "negative evidence" rule for a bug fix sat under STRICT, while
// most bug fixes run QUICK/FAST. It becomes a loop every mode reads: reproduce
// the symptom with something that can go red, see it fail, fix, see the same
// loop go green — and a bug that cannot be reproduced is never fixed blind.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILL = path.join(__dirname, '..', 'templates', '.claude', 'skills', 'flow-run', 'SKILL.md');

const flat = (text) => text.replace(/\s+/g, ' ');
const skill = () => fs.readFileSync(SKILL, 'utf8');

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notStrictEqual(start, -1, `missing section ${heading}`);
  const level = heading.match(/^#+/)[0].length;
  const rest = text.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return flat(next === -1 ? rest : rest.slice(0, next));
}

test('the bug-fix loop is its own section, outside STRICT, with its four steps in order', () => {
  const text = skill();
  const bugFix = section(text, '## A Bug Fix Starts Red');
  const steps = [
    /reproduce the symptom with a loop that can go red/i,
    /see it fail/i,
    /\b3\. Fix\b/,
    /see the same loop go green/i,
  ];
  let from = 0;
  for (const step of steps) {
    const at = bugFix.slice(from).search(step);
    assert.notStrictEqual(at, -1, `step ${step} missing or out of order`);
    from += at + 1;
  }
  assert.match(bugFix, /every mode/i);
  assert.match(bugFix, /before any hypothesis/i);
  assert.match(bugFix, /a test first, otherwise a command/i);
  assert.doesNotMatch(section(text, '### STRICT'), /negative evidence/i,
    'the rule must not stay under STRICT only');
});

test('QUICK / FAST points a bug fix at the loop', () => {
  assert.match(section(skill(), '### QUICK / FAST'), /A Bug Fix Starts Red/);
});

test('red-at-base is asked when redAtBase.command is declared; otherwise the red output is quoted in ## Result', () => {
  const bugFix = section(skill(), '## A Bug Fix Starts Red');
  assert.match(bugFix, /redAtBase\.command/);
  assert.match(bugFix, /Under STRICT, a Node project without `redAtBase\.command` declares it first/);
  assert.match(bugFix, /Jest, Vitest, Go or pytest fix is proven by the ordinary verify/);
  assert.match(bugFix, /ai-flow verify --story <dir> --red-at-base/);
  assert.match(bugFix, /without (that|it)[^.]*, quote the red output in `## Result`/i);
});

test('a bug that cannot be reproduced stops the story instead of being fixed blind', () => {
  const text = skill();
  assert.match(section(text, '## A Bug Fix Starts Red'), /cannot be reproduced[^.]*stop[^.]*`## Status: blocked`[^.]*not reproduced[^.]*`## Result`[^.]*never fix it blind/i);
  assert.match(section(text, '## Stop Conditions'), /bug that cannot be reproduced/i);
});
