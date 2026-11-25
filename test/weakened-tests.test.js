'use strict';

// The `evidence` rung is earned when a behaviour file and a test file both appear
// in the diff. The direction of the test change used to go unread, so the cheapest
// way past the gate was to touch a test — and deleting an assertion, adding
// `.skip`, or removing the file outright all count as touching one.
//
// These tests pin both halves of the fix: a diff whose test changes are only
// weakening does not earn the rung, and a diff that genuinely strengthens a test
// still does. The false-positive cases matter as much as the firing ones — a gate
// that fires on a legitimate refactor is a gate people switch off.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function run(cwd, args) {
  try {
    return { code: 0, output: execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'ignore', 'ignore'] });

function write(dir, files) {
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

const BASELINE_TEST = `test('adds', () => {
  expect(add(1, 2)).toBe(3);
  expect(add(0, 0)).toBe(0);
  expect(add(-1, 1)).toBe(0);
});
`;

// A repository whose feature branch starts from a main that ALREADY has a test
// file — the only shape in which "the test got weaker" is a thing the diff can
// show at all.
function repo(t, prefix, onMain = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(run(dir, ['init']).code, 0);

  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, { 'src/math.test.js': BASELINE_TEST, 'src/math.js': 'const add = (a, b) => a + b;\n', ...onMain });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['checkout', '-b', 'feat/story']);

  return dir;
}

function story(dir) {
  const rel = 'epics/epic-01/story-01-01-demo';
  fs.mkdirSync(path.join(dir, rel), { recursive: true });
  write(dir, {
    [`${rel}/spec.md`]: '# Demo\n\nChange who is allowed through: this story alters an authorization decision.\n',
    [`${rel}/plan.md`]: '# Plan\n',
  });
  return rel;
}

function commit(dir, files, message) {
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', message]);
}

const BEHAVIOR = { 'src/auth.js': 'module.exports = () => true;\n' };

// --- weakening withholds the rung -------------------------------------------

test('deleting a test file does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-delete');
  const rel = story(dir);
  write(dir, BEHAVIOR);
  fs.rmSync(path.join(dir, 'src', 'math.test.js'));
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'auth change, test removed']);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, 'removing the test must not earn the rung');
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /Tests weakened in this diff/);
  assert.match(res.output, /src\/math\.test\.js: the test file was removed/);
});

test('adding .skip does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-skip');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /skip\/only marker\(s\) added/);
});

test('.only counts as weakening, because it silences every other test', (t) => {
  const dir = repo(t, 'weak-only');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.only(') }, 'only it');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /skip\/only marker\(s\) added/);
});

test('removing assertions does not count as covering the change', (t) => {
  const dir = repo(t, 'weak-assertions');
  const rel = story(dir);
  const gutted = "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n";
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': gutted }, 'gut the test');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1);
  assert.match(res.output, /more assertion\(s\) removed than added/);
});

// --- and it must not fire on honest work ------------------------------------

test('a strengthened test still earns the rung', (t) => {
  const dir = repo(t, 'weak-strong');
  const rel = story(dir);
  const stronger = `${BASELINE_TEST}\ntest('rejects', () => {\n  expect(add(1, 1)).toBe(2);\n});\n`;
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': stronger }, 'add a case');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /test file\(s\) strengthened/);
  assert.doesNotMatch(res.output, /Tests weakened/);
});

test('a neutral edit is not a weakening', (t) => {
  const dir = repo(t, 'weak-neutral');
  const rel = story(dir);
  // Same assertions, renamed test: not a weakening. Since story 19-08 not a
  // strengthening either — a title is a string, and renaming one is not a test.
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace("'adds'", "'adds two numbers'") }, 'rename');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /Tests weakened/);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

test('one weakened file does not cancel a genuinely strengthened one — but it is still reported', (t) => {
  const dir = repo(t, 'weak-mixed');
  const rel = story(dir);
  commit(dir, {
    ...BEHAVIOR,
    'src/math.test.js': "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n",
    'src/auth.test.js': "test('denies anonymous', () => {\n  expect(auth()).toBe(true);\n});\n",
  }, 'new auth test, trimmed math test');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /strengthened/, 'the real test still earns the rung');
  assert.match(res.output, /Tests weakened in this diff/, 'and the trimmed one is still surfaced');
});

test('the weakening is recorded in the evidence, not only printed', (t) => {
  const dir = repo(t, 'weak-evidence');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  run(dir, ['verify', '--story', rel]);

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const file = fs.readdirSync(runsDir).filter((name) => name.endsWith('-verify.json')).sort().pop();
  const evidence = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));

  assert.ok(Array.isArray(evidence.coverage.weakenedTests), 'the findings travel with the proof');
  assert.equal(evidence.coverage.weakenedTests[0].signal, 'skipped');
});

test('a declared exemption still carries the weakening it excused', (t) => {
  const dir = repo(t, 'weak-exempt');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('test(', 'test.skip(') }, 'skip it');

  const res = run(dir, ['verify', '--story', rel, '--test-exemption', 'flaky in CI, tracked in #12']);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /Tests weakened in this diff/, 'an exemption excuses the gate, it does not erase the fact');
});

// --- story 19-08: a neutral edit is not a strengthening ---------------------
//
// A test file whose diff adds no test case and no assertion — a reformat, a
// rename, an assertion moved between cases — is `neutral`: never weakened,
// never strengthened, and on its own it does not earn the test-file rung.

const evidenceOf = (dir) => {
  const runsDir = path.join(dir, '.coding-flow', 'runs');
  const file = fs.readdirSync(runsDir).filter((name) => name.endsWith('-verify.json')).sort().pop();
  return JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
};

// The baseline, as a formatter that puts one assertion per line and re-indents
// would leave it: same tests, same assertions.
const REFORMATTED_TEST = `test("adds", () => {
    expect(add(1, 2)).toBe(3);
    expect(add(0, 0)).toBe(0);
    expect(add(-1, 1)).toBe(0);
});
`;

test('19-08: a test file only reformatted does not earn the rung, and is named neutral', (t) => {
  const dir = repo(t, 'neutral-reformat');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': REFORMATTED_TEST }, 'auth change, test reformatted');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /NOT PROVEN/);
  assert.match(res.output, /Tests changed without a new test or assertion \(neutral\)/);
  assert.match(res.output, /src\/math\.test\.js/);
  assert.match(res.output, /add a test or an assertion that exercises the change, or produce a coverage report/);
  assert.doesNotMatch(res.output, /Tests weakened/);
  const { coverage } = evidenceOf(dir);
  assert.equal(coverage.ok, false);
  assert.deepEqual(coverage.neutralTests, ['src/math.test.js']);
  assert.equal(coverage.weakenedTests, undefined);
});

test('19-08: two assertions split from one line onto two by a formatter are still neutral', (t) => {
  const onOneLine = `test('adds', () => {\n  expect(add(1, 2)).toBe(3); expect(add(0, 0)).toBe(0);\n  expect(add(-1, 1)).toBe(0);\n});\n`;
  const dir = repo(t, 'neutral-split', { 'src/math.test.js': onOneLine });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST }, 'auth change, test split');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

test('19-08: an assertion moved from one test case to another is neutral', (t) => {
  const twoCases = `test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(0, 0)).toBe(0);\n});\n\ntest('adds negatives', () => {\n  expect(add(-1, 1)).toBe(0);\n});\n`;
  const moved = `test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n\ntest('adds negatives', () => {\n  expect(add(0, 0)).toBe(0);\n  expect(add(-1, 1)).toBe(0);\n});\n`;
  const dir = repo(t, 'neutral-moved', { 'src/math.test.js': twoCases });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': moved }, 'auth change, assertion moved');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

test('19-08: the same test file with one assertion added earns the rung', (t) => {
  const dir = repo(t, 'neutral-plus-one');
  const rel = story(dir);
  const plusOne = REFORMATTED_TEST.replace('});', '    expect(add(2, 2)).toBe(4);\n});');
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': plusOne }, 'auth change, one assertion more');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /test file\(s\) strengthened/);
  assert.equal(evidenceOf(dir).coverage.mode, 'test-file');
  assert.equal(evidenceOf(dir).coverage.neutralTests, undefined);
});

test('19-08: a new test case with no assertion marker earns the rung', (t) => {
  const dir = repo(t, 'neutral-new-case');
  const rel = story(dir);
  const withCase = `${BASELINE_TEST}\ntest('does not throw', () => {\n  add(1, 2);\n});\n`;
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': withCase }, 'auth change, one case more');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /test file\(s\) strengthened/);
});

test('19-08: a new test file counts as a test added, even with no assertion marker', (t) => {
  const dir = repo(t, 'neutral-new-file');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/auth.test.js': "require('./auth')();\n" }, 'auth change, new test file');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  assert.match(res.output, /test file\(s\) strengthened/);
});

test('19-08: a test file renamed without other change is neutral, not weakened', (t) => {
  const dir = repo(t, 'neutral-rename');
  const rel = story(dir);
  write(dir, BEHAVIOR);
  git(dir, ['mv', 'src/math.test.js', 'src/arithmetic.test.js']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-m', 'auth change, test renamed']);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /Tests weakened/);
  assert.doesNotMatch(res.output, /was removed/);
  const { coverage } = evidenceOf(dir);
  assert.equal(coverage.weakenedTests, undefined);
  assert.deepEqual(coverage.neutralTests, ['src/arithmetic.test.js']);
});

test('19-08: a measured coverage report decides as before, a neutral test file beside it', (t) => {
  const writer = [
    'const fs = require("fs"); const path = require("path");',
    'fs.mkdirSync("coverage", { recursive: true });',
    'fs.writeFileSync("coverage/lcov.info", ["TN:", "SF:" + path.resolve("src/auth.js"), "DA:1,1", "end_of_record", ""].join("\\n"));',
  ].join('\n');
  const dir = repo(t, 'neutral-measured', { 'gen-coverage.js': `${writer}\n` });
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node gen-coverage.js'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': REFORMATTED_TEST }, 'auth change measured, test reformatted');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 0, res.output);
  const { coverage } = evidenceOf(dir);
  assert.equal(coverage.mode, 'diff-lines');
  assert.equal(coverage.ok, true);
});

// --- 19-08 review round 1 --------------------------------------------------

test('19-08: a test file moved with an unstaged mv is neutral, not a new test', (t) => {
  const dir = repo(t, 'neutral-unstaged-mv');
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');
  fs.renameSync(path.join(dir, 'src', 'math.test.js'), path.join(dir, 'src', 'arith.test.js'));

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  // The old name is reported removed, as before this story (re-scope).
  assert.match(res.output, /was removed/);
  assert.doesNotMatch(res.output, /strengthened/);
  assert.ok(evidenceOf(dir).coverage.neutralTests.includes('src/arith.test.js'), JSON.stringify(evidenceOf(dir).coverage));
});

// Re-scope (new series, round 1): this test first asserted the move earned the
// rung, which was looser than before this story. A test file moved without
// staging is reported removed and the gate refuses, exactly as before.
test('19-08: a test file moved with an unstaged mv and given one more assertion is still reported removed, as before', (t) => {
  const dir = repo(t, 'neutral-unstaged-mv-plus');
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');
  fs.rmSync(path.join(dir, 'src', 'math.test.js'));
  write(dir, { 'src/arith.test.js': BASELINE_TEST.replace('});', '  expect(add(2, 2)).toBe(4);\n});') });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /the test file was removed/);
  assert.doesNotMatch(res.output, /test file\(s\) strengthened/);
});

const FRAMEWORKS = [
  ['pytest bare assert', 'tests/test_math.py', 'def test_add():\n    assert add(1, 2) == 3\n', 'def test_add():\n    assert add(1, 2) == 3\n    assert add(0, 0) == 0\n'],
  ['pytest.raises', 'tests/test_math.py', 'def test_add():\n    assert add(1, 2) == 3\n', 'def test_add():\n    assert add(1, 2) == 3\n    with pytest.raises(TypeError):\n        add(None, 1)\n'],
  ['Go t.Fatalf', 'math_test.go', 'func TestAdd(t *testing.T) {\n\tif add(1, 2) != 3 {\n\t\tt.Errorf("bad")\n\t}\n}\n', 'func TestAdd(t *testing.T) {\n\tif add(1, 2) != 3 {\n\t\tt.Errorf("bad")\n\t}\n\tif add(0, 0) != 0 {\n\t\tt.Fatalf("bad zero")\n\t}\n}\n'],
  ['RSpec expect block', 'spec/math_spec.rb', "it 'adds' do\n  expect(add(1, 2)).to eq 3\nend\n", "it 'adds' do\n  expect(add(1, 2)).to eq 3\n  expect { add(nil, 1) }.to raise_error(TypeError)\nend\n"],
  ['RSpec new case', 'spec/math_spec.rb', "it 'adds' do\n  expect(add(1, 2)).to eq 3\nend\n", "it 'adds' do\n  expect(add(1, 2)).to eq 3\nend\n\nit 'adds zero' do\n  add(0, 0)\nend\n"],
  ['Rust assert!', 'tests/math.rs', '#[test]\nfn adds() {\n    assert_eq!(add(1, 2), 3);\n}\n', '#[test]\nfn adds() {\n    assert_eq!(add(1, 2), 3);\n    assert!(add(0, 0) == 0);\n}\n'],
  ['xUnit Assert', 'MathTests.cs', '[Fact]\npublic void Adds() {\n    Assert.Equal(3, Add(1, 2));\n}\n', '[Fact]\npublic void Adds() {\n    Assert.Equal(3, Add(1, 2));\n    Assert.True(Add(0, 0) == 0);\n}\n'],
  ['xUnit new case', 'MathTests.cs', '[Fact]\npublic void Adds() {\n    Assert.Equal(3, Add(1, 2));\n}\n', '[Fact]\npublic void Adds() {\n    Assert.Equal(3, Add(1, 2));\n}\n\n[Fact]\npublic void AddsZero() {\n    Add(0, 0);\n}\n'],
  ['Gherkin scenario', 'features/math.feature', 'Scenario: adds\n  Then 1 + 2 is 3\n', 'Scenario: adds\n  Then 1 + 2 is 3\n\nScenario: adds zero\n  Then 0 + 0 is 0\n'],
];

for (const [name, file, before, after] of FRAMEWORKS) {
  test(`19-08: ${name} added to a test file earns the rung`, (t) => {
    const dir = repo(t, 'neutral-framework', { [file]: before });
    const rel = story(dir);
    commit(dir, { ...BEHAVIOR, [file]: after }, `auth change, ${name}`);

    const res = run(dir, ['verify', '--story', rel]);

    assert.equal(res.code, 0, res.output);
    assert.match(res.output, /test file\(s\) strengthened/);
  });
}

test('19-08: an assertion moved from a commit into the working tree is still neutral', (t) => {
  const twoCases = `test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n  expect(add(0, 0)).toBe(0);\n});\n\ntest('adds negatives', () => {\n  expect(add(-1, 1)).toBe(0);\n});\n`;
  const dir = repo(t, 'neutral-moved-across', { 'src/math.test.js': twoCases });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': twoCases.replace('  expect(add(0, 0)).toBe(0);\n', '') }, 'auth change, assertion taken out');
  write(dir, { 'src/math.test.js': twoCases.replace('  expect(add(0, 0)).toBe(0);\n', '').replace("  expect(add(-1, 1)).toBe(0);\n", "  expect(add(-1, 1)).toBe(0);\n  expect(add(0, 0)).toBe(0);\n") });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

test('19-08: a test title renamed to start with "should" is neutral', (t) => {
  const dir = repo(t, 'neutral-should');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace("'adds'", "'should add'") }, 'auth change, title');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /Tests weakened/);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

test('19-08: an untracked test file that is empty or only comments does not earn the rung', (t) => {
  const dir = repo(t, 'neutral-untracked-empty');
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');
  write(dir, { 'src/junk.test.js': '', 'src/notes.test.js': '// expect(auth()).toBe(true);\n' });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /strengthened/);
});

test('19-08: an assertion added inside a comment is neutral', (t) => {
  const dir = repo(t, 'neutral-comment');
  const rel = story(dir);
  const commented = BASELINE_TEST.replace('});', '  // expect(add(2, 2)).toBe(4);\n  /* expect(add(3, 3)).toBe(6); */\n});');
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': commented }, 'auth change, commented assertion');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

// --- 19-08 review round 2: the rule is inverted --------------------------
//
// A test edit strengthens unless it is provably neutral: every token of test
// code it adds is found in the test code the diff removed, across all test
// files. No framework marker decides it any more.

const ANY_FRAMEWORK = [
  ['RSpec one-liner should', 'spec/model_spec.rb', "it { is_expected.to be_valid }\n", "it { is_expected.to be_valid }\nit { should be_persisted }\n"],
  ['Minitest refute', 'test/math_test.rb', "def test_add\n  assert_equal 3, add(1, 2)\nend\n", "def test_add\n  assert_equal 3, add(1, 2)\n  refute_nil add(0, 0)\nend\n"],
  ['Minitest spec must_equal', 'test/math_test.rb', "it 'adds' do\n  _(add(1, 2)).must_equal 3\nend\n", "it 'adds' do\n  _(add(1, 2)).must_equal 3\n  _(add(0, 0)).must_equal 0\nend\n"],
  ['ExUnit refute', 'test/math_test.exs', "test \"adds\" do\n  assert add(1, 2) == 3\nend\n", "test \"adds\" do\n  assert add(1, 2) == 3\n  refute add(0, 0) == 1\nend\n"],
  ['Go table row', 'math_test.go', "var cases = []struct{ a, b, want int }{\n\t{1, 2, 3},\n}\n", "var cases = []struct{ a, b, want int }{\n\t{1, 2, 3},\n\t{0, 0, 0},\n}\n"],
  ['Go t.Run', 'math_test.go', "func TestAdd(t *testing.T) {\n}\n", "func TestAdd(t *testing.T) {\n\tt.Run(\"zero\", func(t *testing.T) { check(t, add(0, 0), 0) })\n}\n"],
  ['test.each row', 'src/math.test.js', "test.each([\n  [1, 2, 3],\n])('adds %i + %i', (a, b, sum) => {\n  expect(add(a, b)).toBe(sum);\n});\n", "test.each([\n  [1, 2, 3],\n  [5, 5, 10],\n])('adds %i + %i', (a, b, sum) => {\n  expect(add(a, b)).toBe(sum);\n});\n"],
  ['pytest parametrize row', 'tests/test_math.py', "@pytest.mark.parametrize('a,b,s', [\n    (1, 2, 3),\n])\ndef test_add(a, b, s):\n    assert add(a, b) == s\n", "@pytest.mark.parametrize('a,b,s', [\n    (1, 2, 3),\n    (7, 8, 15),\n])\ndef test_add(a, b, s):\n    assert add(a, b) == s\n"],
  ['JUnit @ValueSource', 'src/MathTest.java', "@ParameterizedTest\n@ValueSource(ints = {1})\nvoid positive(int n) { check(n); }\n", "@ParameterizedTest\n@ValueSource(ints = {1, 42})\nvoid positive(int n) { check(n); }\n"],
  ['gtest TEST', 'math_test.cc', "TEST(Math, Adds) { EXPECT_EQ(3, add(1, 2)); }\n", "TEST(Math, Adds) { EXPECT_EQ(3, add(1, 2)); }\nTEST(Math, AddsZero) { check(add(0, 0)); }\n"],
  ['#[tokio::test]', 'tests/math.rs', "#[test]\nfn adds() { check(add(1, 2)); }\n", "#[test]\nfn adds() { check(add(1, 2)); }\n\n#[tokio::test]\nasync fn adds_async() { check(add_async(1, 2).await); }\n"],
  ['PHPUnit @test docblock', 'tests/MathTest.php', "/** @test */\npublic function adds() { $this->check(add(1, 2)); }\n", "/** @test */\npublic function adds() { $this->check(add(1, 2)); }\n\n/** @test */\npublic function addsZero() { $this->check(add(0, 0)); }\n"],
  ['FluentAssertions Should()', 'MathTests.cs', "[Fact]\npublic void Adds() { Add(1, 2).Should().Be(3); }\n", "[Fact]\npublic void Adds() { Add(1, 2).Should().Be(3); Add(0, 0).Should().Be(0); }\n"],
  ['destructured strictEqual', 'src/math.test.js', "const { strictEqual } = require('node:assert');\ntest('adds', () => {\n  strictEqual(add(1, 2), 3);\n});\n", "const { strictEqual } = require('node:assert');\ntest('adds', () => {\n  strictEqual(add(1, 2), 3);\n  strictEqual(add(0, 0), 0);\n});\n"],
  ['// inside a string', 'src/path.test.js', "test('norm', () => {\n  expect(norm('a/b')).toBe('a/b');\n});\n", "test('norm', () => {\n  expect(norm('a/b')).toBe('a/b');\n  const p = 'a//b'; expect(norm(p)).toBe('a/b');\n});\n"],
];

for (const [name, file, before, after] of ANY_FRAMEWORK) {
  test(`19-08: new test code strengthens in any framework — ${name}`, (t) => {
    const dir = repo(t, 'neutral-any', { [file]: before });
    const rel = story(dir);
    commit(dir, { ...BEHAVIOR, [file]: after }, `auth change, ${name}`);

    const res = run(dir, ['verify', '--story', rel]);

    assert.equal(res.code, 0, res.output);
    assert.match(res.output, /test file\(s\) strengthened/);
  });
}

const TWO_CASES = "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n\ntest('adds zero', () => {\n  expect(add(0, 0)).toBe(0);\n});\n";
const ONE_CASE = "test('adds', () => {\n  expect(add(1, 2)).toBe(3);\n});\n";
const OTHER = "test('subtracts', () => {\n  expect(sub(3, 2)).toBe(1);\n});\n";
const MOVED_CASE = "\ntest('adds zero', () => {\n  expect(add(0, 0)).toBe(0);\n});\n";

test('19-08: a test case moved from one test file into another is neutral', (t) => {
  const dir = repo(t, 'neutral-cross-file', { 'src/a.test.js': TWO_CASES, 'src/b.test.js': OTHER });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/a.test.js': ONE_CASE, 'src/b.test.js': OTHER + MOVED_CASE }, 'auth change, case moved');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /strengthened/);
  assert.ok(evidenceOf(dir).coverage.neutralTests.includes('src/b.test.js'), JSON.stringify(evidenceOf(dir).coverage));
  // The source reads as it did before this story: its assertions were removed.
  assert.deepEqual(evidenceOf(dir).coverage.weakenedTests.map((f) => [f.file, f.signal]), [['src/a.test.js', 'assertions-removed']]);
});

test('19-08: a test case moved into a new test file is neutral', (t) => {
  const dir = repo(t, 'neutral-cross-new', { 'src/a.test.js': TWO_CASES });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/a.test.js': ONE_CASE, 'src/c.test.js': MOVED_CASE.trimStart() }, 'auth change, case moved out');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /strengthened/);
  assert.ok(evidenceOf(dir).coverage.neutralTests.includes('src/c.test.js'), JSON.stringify(evidenceOf(dir).coverage));
});

test('19-08: a file moved with an unstaged mv is named once', (t) => {
  const dir = repo(t, 'neutral-named-once');
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');
  fs.renameSync(path.join(dir, 'src', 'math.test.js'), path.join(dir, 'src', 'arith.test.js'));

  run(dir, ['verify', '--story', rel]);

  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/arith.test.js']);
});

// --- 19-08 review round 3: real formatter output, comments, strings --------
//
// The "after" sides of the prettier and gofmt cases are REAL formatter output:
// prettier 3.10.1 and `gofmt -s` run on the "before" sides on 2026-11-24,
// pasted verbatim.

const PRETTIER_BEFORE = `var assert=require('assert')
test('adds',function(){
  var x=-1,y=.5,z=0XAB,w=1E5,big=1.50
  var obj={'a':1,"b":'it\\'s'}
  assert.equal(add(x,y),'sum: '+x+y)
  assert.ok([1,2,3].map(function(n){return !n}))
  expect( add( 1 , 2 ) ).toBe( 3 ); expect(add(0,0)).toBe(0)
})
`;
const PRETTIER_AFTER = `var assert = require("assert");
test("adds", function () {
  var x = -1,
    y = 0.5,
    z = 0xab,
    w = 1e5,
    big = 1.5;
  var obj = { a: 1, b: "it's" };
  assert.equal(add(x, y), "sum: " + x + y);
  assert.ok(
    [1, 2, 3].map(function (n) {
      return !n;
    }),
  );
  expect(add(1, 2)).toBe(3);
  expect(add(0, 0)).toBe(0);
});
`;

const GOFMT_BEFORE = `package m
import "testing"
func TestAdd(t *testing.T){
  x:=-1
  if (add(x,1)!=0){ t.Errorf("bad %d",x) }
  cases:=[]struct{a,b,want int}{{1,2,3},{0XAB,0,0xab}}
  for _,c:=range cases{ if add(c.a,c.b)!=c.want {t.Fatalf("x")} }
}
`;
const GOFMT_AFTER = `package m

import "testing"

func TestAdd(t *testing.T) {
\tx := -1
\tif add(x, 1) != 0 {
\t\tt.Errorf("bad %d", x)
\t}
\tcases := []struct{ a, b, want int }{{1, 2, 3}, {0xAB, 0, 0xab}}
\tfor _, c := range cases {
\t\tif add(c.a, c.b) != c.want {
\t\t\tt.Fatalf("x")
\t\t}
\t}
}
`;

const ESLINT_BEFORE = "var add = require('./add');\ntest('adds', function () {\n  var label = 'sum ' + add(1, 2);\n  expect(label).toBe('sum 3');\n  [1, 2].forEach(function (n) { return expect(add(n, 0)).toBe(n); });\n});\n";
const ESLINT_AFTER = "const add = require('./add');\ntest('adds', () => {\n  const label = `sum ${add(1, 2)}`;\n  expect(label).toBe('sum 3');\n  [1, 2].forEach((n) => expect(add(n, 0)).toBe(n));\n});\n";

const BLACK_BEFORE = "def test_add():\n    assert add(0XFF, 1J) == 'x'\n    assert add(.5, 1E5) == {'a': 1}\n";
const BLACK_AFTER = 'def test_add():\n    """Adds numbers."""\n    assert add(0xFF, 1j) == "x"\n    assert add(0.5, 1e5) == {"a": 1}\n';

const REFORMATS = [
  ['prettier 3 (real output)', 'src/math.test.js', PRETTIER_BEFORE, PRETTIER_AFTER],
  ['gofmt -s (real output)', 'math_test.go', GOFMT_BEFORE, GOFMT_AFTER],
  ['eslint --fix style (var, arrows, template literal)', 'src/add.test.js', ESLINT_BEFORE, ESLINT_AFTER],
  ['black style (numbers, quotes, a docstring)', 'tests/test_add.py', BLACK_BEFORE, BLACK_AFTER],
  ['a JSDoc block added', 'src/math.test.js', BASELINE_TEST, `/**\n * Covers add.\n * @see add\n */\n${BASELINE_TEST}`],
  ['a block comment without stars added', 'src/math.test.js', BASELINE_TEST, `/*\n  expect(add(9, 9)).toBe(18);\n  more notes\n*/\n${BASELINE_TEST}`],
  ['a Python docstring added', 'tests/test_add.py', 'def test_add():\n    assert add(1, 2) == 3\n', 'def test_add():\n    """\n    assert add(9, 9) == 18\n    """\n    assert add(1, 2) == 3\n'],
  ['only an expected string changed (accepted false red)', 'src/math.test.js', "test('says', () => {\n  expect(say()).toBe('hi');\n});\n", "test('says', () => {\n  expect(say()).toBe('hello');\n});\n"],
];

for (const [name, file, before, after] of REFORMATS) {
  test(`19-08: neutral — ${name}`, (t) => {
    const dir = repo(t, 'neutral-format', { [file]: before });
    const rel = story(dir);
    commit(dir, { ...BEHAVIOR, [file]: after }, `auth change, ${name}`);

    const res = run(dir, ['verify', '--story', rel]);

    assert.equal(res.code, 1, res.output);
    assert.doesNotMatch(res.output, /strengthened/);
    assert.deepEqual(evidenceOf(dir).coverage.neutralTests, [file]);
  });
}

test('19-08: a fixer writing real prettier output is neutral like the hand reformat', (t) => {
  const dir = repo(t, 'neutral-fixer-prettier', { 'src/math.test.js': PRETTIER_BEFORE });
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { fix: ['node fix.js'], commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'fix.js'), `require('fs').writeFileSync('src/math.test.js', ${JSON.stringify(PRETTIER_AFTER)});\n`);
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/math.test.js']);
});

// Follow-up, not this story (re-scoped after review round 4): weakening markers
// are counted on raw lines, as before 19-08, so a title losing its "should"
// still reads as an assertion removed. Kept as a todo for the epic-19 follow-up.
test('19-08: a "should" inside a title does not count as an assertion removed', { todo: 'follow-up: count markers outside strings and comments (epic 19 index)' }, (t) => {
  const dir = repo(t, 'neutral-should-weak', { 'src/math.test.js': BASELINE_TEST.replace("'adds'", "'should add'") });
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST }, 'auth change, title');

  const res = run(dir, ['verify', '--story', rel]);

  assert.doesNotMatch(res.output, /Tests weakened/);
  assert.equal(evidenceOf(dir).coverage.weakenedTests, undefined);
});

test('19-08: an unstaged move that also reformats is neutral, and the old name reported removed as before', (t) => {
  const dir = repo(t, 'neutral-mv-reformat', { 'src/math.test.js': PRETTIER_BEFORE });
  const rel = story(dir);
  commit(dir, BEHAVIOR, 'auth change');
  fs.rmSync(path.join(dir, 'src', 'math.test.js'));
  write(dir, { 'src/arith.test.js': PRETTIER_AFTER });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /was removed/);
  assert.deepEqual(evidenceOf(dir).coverage.neutralTests, ['src/arith.test.js']);
});

test('19-08: in a project below the repository top, the test files are named in one form, from the top', (t) => {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-neutral-sub-')));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const dir = path.join(top, 'pkg');
  fs.mkdirSync(dir);
  assert.equal(run(dir, ['init']).code, 0);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  git(top, ['init', '-b', 'main']);
  git(top, ['config', 'user.email', 'test@example.com']);
  git(top, ['config', 'user.name', 'Test']);
  write(dir, { 'src/math.js': 'module.exports = 1;\n', 'src/math.test.js': BASELINE_TEST, 'src/other.test.js': PRETTIER_BEFORE });
  git(top, ['add', '-A']);
  git(top, ['commit', '-m', 'init']);
  git(top, ['checkout', '-b', 'feat/story']);
  const rel = story(dir);
  write(dir, BEHAVIOR);
  git(top, ['add', '-A']);
  git(top, ['commit', '-m', 'auth change']);
  // An unstaged move (the new name is untracked) and a staged reformat.
  fs.renameSync(path.join(dir, 'src', 'math.test.js'), path.join(dir, 'src', 'arith.test.js'));
  write(dir, { 'src/other.test.js': PRETTIER_AFTER });
  git(top, ['add', 'pkg/src/other.test.js']);

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.deepEqual([...evidenceOf(dir).coverage.neutralTests].sort(), ['pkg/src/arith.test.js', 'pkg/src/other.test.js']);
});

// --- 19-08 re-scope: the weakening signal is exactly what it was ------------
//
// Review round 4 found the lexer, fed diff-hunk fragments, left a template or a
// block comment open when its closer was unchanged context, so later removed
// assertions read as text and a weakening read as a strengthening.

const S1_BEFORE = "test('adds', () => {\n  const label = `sum\n  of two`;\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n  expect(add(3, 2)).toBe(5);\n});\n";
const S1_AFTER = "test('adds', () => {\n  const label = `total\n  of two`;\n  expect(add(1, 2)).toBe(3);\n  const extra = 1;\n});\n";
const S2_BEFORE = "test('adds', () => {\n  /* sums\n     two numbers */\n  expect(add(1, 2)).toBe(3);\n  expect(add(2, 2)).toBe(4);\n  expect(add(3, 2)).toBe(5);\n});\n";
const S2_AFTER = "test('adds', () => {\n  /* adds\n     two numbers */\n  expect(add(1, 2)).toBe(3);\n  const extra = 1;\n});\n";

for (const [name, before, after] of [
  ['a template literal whose first line is edited', S1_BEFORE, S1_AFTER],
  ['a two-line block comment whose first line is edited', S2_BEFORE, S2_AFTER],
]) {
  test(`19-08: assertions removed after ${name} are still caught`, (t) => {
    const dir = repo(t, 'weak-fragment', { 'src/math.test.js': before });
    const rel = story(dir);
    commit(dir, { ...BEHAVIOR, 'src/math.test.js': after }, 'auth change, assertions removed');

    const res = run(dir, ['verify', '--story', rel]);

    assert.equal(res.code, 1, res.output);
    assert.match(res.output, /2 more assertion\(s\) removed/);
    assert.doesNotMatch(res.output, /strengthened/);
  });
}

test('19-08: an assertion added in a commit and turned into plain code in the working tree is still an assertion removed', (t) => {
  const dir = repo(t, 'weak-three-diffs');
  const rel = story(dir);
  commit(dir, { ...BEHAVIOR, 'src/math.test.js': BASELINE_TEST.replace('});', '  expect(add(2, 2)).toBe(4);\n});') }, 'auth change, one more assertion');
  write(dir, { 'src/math.test.js': BASELINE_TEST.replace('});', '  const z = add(2, 2);\n});') });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.match(res.output, /1 more assertion\(s\) removed/);
  assert.doesNotMatch(res.output, /test file\(s\) strengthened/);
});

test('19-08: in a project inside an e2e/ folder, a new untracked behaviour file is not a test that strengthens', (t) => {
  // Series 2 round 2: the strength scan named untracked files from the top
  // (`e2e/src/auth/login.js`), which matched `**/e2e/**`; the gate names it
  // from the project, a behaviour file. Before 19-08 this was red.
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-e2e-sub-')));
  t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const dir = path.join(top, 'e2e');
  fs.mkdirSync(dir);
  assert.equal(run(dir, ['init']).code, 0);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: ['node -e "process.exit(0)"'], quality: [] };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  git(top, ['init', '-b', 'main']);
  git(top, ['config', 'user.email', 'test@example.com']);
  git(top, ['config', 'user.name', 'Test']);
  write(dir, { 'src/x.js': 'module.exports = 1;\n' });
  git(top, ['add', '-A']);
  git(top, ['commit', '-m', 'init']);
  git(top, ['checkout', '-b', 'feat/story']);
  const rel = story(dir);
  write(dir, { 'src/auth/login.js': 'module.exports = function allow(u) { return u.admin === true; };\n' });

  const res = run(dir, ['verify', '--story', rel]);

  assert.equal(res.code, 1, res.output);
  assert.doesNotMatch(res.output, /strengthened/);
  assert.match(res.output, /no test file did|no test file adds/);
});

test('19-08: a hostile 100 KB line of escaped quotes is read in linear time', () => {
  // Series 2 round 3: each unpartnered quote rescanned to the line's end, so
  // `'` followed by `\'` x 40000 took 7.5 s. The lexer reads the test files of
  // every verify; a line like this in a fixture must not stall the gate.
  const { tokensOf } = require('../bin/lib/test-tokens');
  const line = `'${"\\'".repeat(50000)}`;
  assert.equal(line.length, 100001);

  const started = process.hrtime.bigint();
  tokensOf([line, `"${'\\"'.repeat(50000)}`]);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;

  assert.ok(ms < 1000, `took ${ms} ms`);
});
