'use strict';

// Story 14-07: per-function CRAP and length read from an lcov report. These drive
// the measuring module on hand-written reports and sources, so each number below
// can be checked by hand: `crap = c² × (1 − cov)³ + c`, c = distinct BRDA lines + 1.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { crapScore, parseLcovFunctions, measureFile } = require('../bin/lib/complexity');

const FIXTURES = path.join(__dirname, 'fixtures', 'complexity');

function dir(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-complexity-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// A function of `branches` one-line `if`s, plus its lcov record: every line is a
// DA line, hit or not, and every `if` line a BRDA line.
function branchy(name, branches, { hit }) {
  const body = Array.from({ length: branches }, (_, i) => `  if (x === ${i}) return ${i};`);
  const source = [`function ${name}(x) {`, ...body, '  return -1;', '}', ''].join('\n');
  const last = branches + 3;
  const lcov = [
    'SF:src/branchy.js',
    `FN:1,${name}`,
    ...Array.from({ length: last }, (_, i) => `DA:${i + 1},${hit ? 1 : 0}`),
    ...body.map((_, i) => `BRDA:${i + 2},0,0,${hit ? 1 : 0}`),
    'end_of_record',
    '',
  ].join('\n');

  return { source, lcov };
}

function measure(t, file, source, lcov) {
  const root = dir(t);
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), source);

  return measureFile(root, file, parseLcovFunctions(lcov).get(file));
}

test('a function of 10 branch lines at 0% coverage has CRAP 132 (11² + 11)', (t) => {
  const { source, lcov } = branchy('route', 10, { hit: false });
  const [fn] = measure(t, 'src/branchy.js', source, lcov);

  assert.equal(fn.decisions, 11);
  assert.equal(fn.coverage, 0);
  assert.equal(fn.crap, 132);
  assert.equal(fn.length, 13);
});

test('the same function fully covered has CRAP 11', (t) => {
  const { source, lcov } = branchy('route', 10, { hit: true });
  const [fn] = measure(t, 'src/branchy.js', source, lcov);

  assert.equal(fn.coverage, 1);
  assert.equal(fn.crap, 11);
});

test('the formula, with partial coverage', () => {
  assert.equal(crapScore(1, 1), 1);
  assert.equal(crapScore(4, 0.5), 6);
  assert.equal(crapScore(11, 0), 132);
});

test('a coverage.py lcov for a .py file: functions found, bounded by the next FN', () => {
  const lcov = parseLcovFunctions(fs.readFileSync(path.join(FIXTURES, 'coverage-py.lcov'), 'utf8'));
  const fns = measureFile(FIXTURES, 'app.py', lcov.get('app.py'));

  assert.deepStrictEqual(fns.map(({ name, line, end }) => ({ name, line, end })), [
    { name: 'parse', line: 4, end: 9 },
    { name: 'Runner.run', line: 13, end: 17 },
    { name: 'main', line: 20, end: 21 },
  ]);
  assert.deepStrictEqual(fns.map((fn) => fn.decisions), [3, 2, 1]);
  assert.equal(fns[0].coverage, 5 / 6);
  assert.equal(fns[2].crap, 1);
});

test('an lcov 2 FN record carrying its end line is taken as written', (t) => {
  const source = 'def a():\n    return 1\n\n\ndef b():\n    return 2\n';
  const [a] = measure(t, 'm.py', source, 'SF:m.py\nFN:1,2,a\nFN:5,6,b\nDA:1,1\nDA:2,1\nend_of_record\n');

  assert.equal(a.end, 2);
});

// The brace cases story 13-06's ratchet measured, kept now that it is retired.
test('an inline callback that starts mid-line is measured whole', (t) => {
  const source = [
    'module.exports = items.map(function (item) {',
    '  const a = 1;',
    '  return item + a;',
    '});',
    '',
  ].join('\n');
  const [fn] = measure(t, 'src/cb.js', source, 'SF:src/cb.js\nFN:1,(anonymous_0)\nend_of_record\n');

  assert.equal(fn.length, 4);
});

test('braces inside strings, templates, comments and regexes do not end a function', (t) => {
  const source = [
    'function tricky() {',
    "  const s = '}';",
    '  const t = `${"}"} }`;',
    '  // }',
    '  /* } */',
    '  const r = /[}]/;',
    '  return s + t + r;',
    '}',
    '',
    'function after() {}',
    '',
  ].join('\n');
  const [fn] = measure(t, 'src/t.js', source, 'SF:src/t.js\nFN:1,tricky\nFN:10,after\nend_of_record\n');

  assert.equal(fn.end, 8);
});

test('a nested function does not cut its parent short in a brace source', (t) => {
  const source = ['function outer() {', '  function inner() {', '    return 1;', '  }', '  return inner();', '}', ''].join('\n');
  const [outer, inner] = measure(t, 'src/n.js', source, 'SF:src/n.js\nFN:1,outer\nFN:2,inner\nend_of_record\n');

  assert.equal(outer.length, 6);
  assert.equal(inner.length, 3);
});
