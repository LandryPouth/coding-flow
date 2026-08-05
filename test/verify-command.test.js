'use strict';

// `verify` was promoted from a skill to a top-level command, so it is now typed
// by hand — by people who make typos. These tests pin the failure modes: a scope
// that misses must refuse, never silently widen to a project-wide run that then
// writes an evidence claiming it proved a story that does not exist.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const ROOT = path.join(__dirname, '..');

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function project(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `coding-flow-${prefix}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function initProject(t, prefix) {
  const dir = project(t, prefix);
  assert.equal(run(dir, ['init']).code, 0);
  return dir;
}

function setValidationCommands(dir, commands) {
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands };
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function makeStory(dir, commands) {
  const storyDir = path.join(dir, 'epics', 'epic-01', 'story-01-01-demo');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Demo\n');
  fs.writeFileSync(
    path.join(storyDir, 'plan.md'),
    ['# Plan', '', '## Commands', '', '```bash', ...commands, '```', ''].join('\n'),
  );
  return 'epics/epic-01/story-01-01-demo';
}

function evidenceFiles(dir) {
  const runs = path.join(dir, '.coding-flow', 'runs');
  return fs.existsSync(runs) ? fs.readdirSync(runs).filter((f) => f.endsWith('-verify.json')) : [];
}

// --- the alias itself -------------------------------------------------------

test('verify is a true alias of harness verify on the passing path', (t) => {
  const dir = initProject(t, 'verify-alias');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  const short = run(dir, ['verify', '--json']);
  const long = run(dir, ['harness', 'verify', '--json']);

  assert.equal(short.code, 0, short.output);
  assert.equal(long.code, 0, long.output);

  const a = JSON.parse(short.output);
  const b = JSON.parse(long.output);
  assert.equal(a.ok, b.ok);
  assert.equal(a.commandSource, b.commandSource);
  assert.deepEqual(
    a.results.map((r) => r.command),
    b.results.map((r) => r.command),
  );
});

test('verify exits 1 on a red command and still writes the evidence', (t) => {
  const dir = initProject(t, 'verify-red');
  setValidationCommands(dir, ['node -e "process.exit(3)"']);

  const { code, output } = run(dir, ['verify']);
  assert.equal(code, 1, output);
  // A red proof is still a proof: audit --check reads it to block the merge.
  assert.equal(evidenceFiles(dir).length, 1, 'a failing verify must leave evidence behind');
});

test('verify --json stays parseable when it fails', (t) => {
  const dir = initProject(t, 'verify-json-red');
  setValidationCommands(dir, ['node -e "process.exit(2)"']);

  const { code, output } = run(dir, ['verify', '--json']);
  assert.equal(code, 1, output);

  // Machine consumers get JSON on the failure path too, or the exit code is the
  // only thing they can read.
  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.results[0].exitCode, 2);
});

// --- a scope that misses ----------------------------------------------------

test('verify refuses a --story that does not exist', (t) => {
  const dir = initProject(t, 'verify-story-missing');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  const { code, output } = run(dir, ['verify', '--story', 'epics/typo']);
  assert.equal(code, 1, 'a missing scope must fail, not widen to the whole project');
  assert.match(output, /is not a story directory inside the project/);
  assert.deepEqual(evidenceFiles(dir), [], 'nothing was proved, so nothing is recorded');
});

test('verify refuses a --story pointing outside the project', (t) => {
  const dir = initProject(t, 'verify-story-escape');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  const { code, output } = run(dir, ['verify', '--story', '../elsewhere']);
  assert.equal(code, 1, output);
  assert.match(output, /is not a story directory inside the project/);
  assert.deepEqual(evidenceFiles(dir), []);
});

test('verify refuses --story with no value', (t) => {
  const dir = initProject(t, 'verify-story-empty');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  // `--story --json` used to swallow the flag and verify the whole project.
  const { code, output } = run(dir, ['verify', '--story', '--json']);
  assert.equal(code, 1, output);
  assert.match(output, /--story requires a path/);
  assert.deepEqual(evidenceFiles(dir), []);
});

test('verify validates --story before honouring --dry-run', (t) => {
  const dir = initProject(t, 'verify-story-dry');

  const { code, output } = run(dir, ['verify', '--story', 'epics/typo', '--dry-run']);
  assert.equal(code, 1, 'a dry run of a nonexistent scope is still a typo');
  assert.match(output, /is not a story directory/);
});

test('verify refuses a real directory that is not a story', (t) => {
  const dir = initProject(t, 'verify-story-notastory');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);
  fs.mkdirSync(path.join(dir, 'src'));

  // `src` resolves — it is a directory inside the project — so a "does it exist"
  // guard lets it through and files the proof under a story named "src".
  const { code, output } = run(dir, ['verify', '--story', 'src']);
  assert.equal(code, 1, output);
  assert.match(output, /not under epics\//);
  assert.deepEqual(evidenceFiles(dir), []);
});

test('the valueless --story guard covers every harness subcommand', (t) => {
  const dir = initProject(t, 'verify-story-siblings');

  for (const subcommand of ['check', 'preflight', 'evidence', 'verify']) {
    const { code, output } = run(dir, ['harness', subcommand, '--story', '--json']);
    assert.equal(code, 1, `harness ${subcommand}: ${output}`);
    assert.match(output, /--story requires a path/);
  }
});

test('preflight keeps reporting a missing story instead of refusing it', (t) => {
  const dir = initProject(t, 'verify-preflight-missing');

  // Only verify is strict. preflight is designed to answer "how risky is this
  // story?" before the story directory exists, and says so in its output.
  const { code, output } = run(dir, ['harness', 'preflight', '--story', 'epics/not-yet']);
  assert.equal(code, 0, output);
  assert.match(output, /\(missing\)/);
});

test('check keeps its own story guard rather than inheriting verify\'s', (t) => {
  const dir = initProject(t, 'verify-check-scope');
  const story = makeStory(dir, ['node -e "process.exit(0)"']);

  const scoped = run(dir, ['harness', 'check', '--story', story]);
  assert.equal(scoped.code, 0, scoped.output);

  // check refuses a non-story for its own reason — no story content — and says
  // so. Layering verify's epics/ rule on top would only blur that message.
  fs.mkdirSync(path.join(dir, 'src'));
  const loose = run(dir, ['harness', 'check', '--story', 'src']);
  assert.equal(loose.code, 1, loose.output);
  assert.match(loose.output, /needs story content/);
});

test('verify accepts a --story given as a file inside the story directory', (t) => {
  const dir = initProject(t, 'verify-story-file');
  const story = makeStory(dir, ['node -e "process.exit(0)"']);

  // Pointing at spec.md is how a user refers to a story they have open; it
  // resolves to the containing directory rather than being refused.
  const { code, output } = run(dir, ['verify', '--story', `${story}/spec.md`, '--json']);
  assert.equal(code, 0, output);
  assert.equal(JSON.parse(output).commandSource, 'plan.md');
});

// --- nothing to run ---------------------------------------------------------

test('verify exits 1 when a real story declares no command', (t) => {
  const dir = initProject(t, 'verify-story-nocmd');
  const storyDir = path.join(dir, 'epics', 'epic-01', 'story-01-01-demo');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Demo\n');

  const { code, output } = run(dir, ['verify', '--story', 'epics/epic-01/story-01-01-demo']);
  assert.equal(code, 1, 'no command executed is not a pass');
  assert.match(output, /no validation commands/i);
  assert.match(output, /plan\.md/, 'the message says where to declare them');
});

test('verify exits 1 when the Commands block is empty', (t) => {
  const dir = initProject(t, 'verify-empty-block');
  const story = makeStory(dir, []);

  const { code, output } = run(dir, ['verify', '--story', story]);
  assert.equal(code, 1, output);
  assert.match(output, /no validation commands/i);
});

test('verify captures a command that does not exist instead of crashing', (t) => {
  const dir = initProject(t, 'verify-nobinary');
  setValidationCommands(dir, ['coding-flow-definitely-not-a-real-binary']);

  const { code, output } = run(dir, ['verify', '--json']);
  assert.equal(code, 1, output);

  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, false);
  assert.notEqual(evidence.results[0].exitCode, 0, 'a missing binary is a red command');
});

test('verify in an uninitialised directory fails cleanly', (t) => {
  const dir = project(t, 'verify-uninit');

  const { code, output } = run(dir, ['verify']);
  assert.equal(code, 1, output);
  assert.doesNotMatch(output, /at Object\.|node:internal/, 'no raw stack trace');
});

test('harness rejects an unknown subcommand', (t) => {
  const dir = initProject(t, 'verify-unknown');

  const { code, output } = run(dir, ['harness', 'bogus']);
  assert.equal(code, 1);
  assert.match(output, /unknown harness command/);
});

test('successive verifies never overwrite each other evidence', (t) => {
  const dir = initProject(t, 'verify-collision');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);

  run(dir, ['verify']);
  run(dir, ['verify']);
  run(dir, ['verify']);

  assert.equal(evidenceFiles(dir).length, 3, 'every run keeps its own proof');
});

// --- the front-door decision ------------------------------------------------

test('verify is documented as machinery: full reference yes, golden path no', (t) => {
  const dir = initProject(t, 'verify-help');

  const golden = run(dir, ['help']);
  assert.equal(golden.code, 0);
  // Putting verify on the 95% screen would contradict the claim that
  // verification is machinery the skills run for you.
  assert.doesNotMatch(golden.output, /ai-flow verify/);
  assert.doesNotMatch(golden.output, /flow-verify/);

  const full = run(dir, ['help', '--all']);
  assert.equal(full.code, 0);
  assert.match(full.output, /ai-flow verify --story/, 'the escape hatch stays discoverable');
});

test('no flow-verify skill survives anywhere in the shipped tree', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'skills', 'flow-verify')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'templates', '.claude', 'skills', 'flow-verify')), false);

  // A dangling /flow-verify in a template would send the user to a skill that no
  // longer exists — the one failure mode a deleted skill can still cause.
  const roots = [path.join(ROOT, 'templates'), path.join(ROOT, 'skills')];
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(md|json|js)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('flow-verify')) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };

  roots.forEach(walk);
  assert.deepEqual(offenders, [], 'templates still point at the removed skill');
});

test('the stale message points at the promoted command, not the long form', (t) => {
  const dir = initProject(t, 'verify-stale-message');
  fs.writeFileSync(path.join(dir, 'app.js'), 'const x = 1;\n');
  setValidationCommands(dir, ['node -e "process.exit(0)"']);
  makeStory(dir, ['node -e "process.exit(0)"']);

  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');

  assert.equal(run(dir, ['verify', '--story', 'epics/epic-01/story-01-01-demo']).code, 0);
  fs.appendFileSync(path.join(dir, 'app.js'), 'const y = 2;\n');

  const { code, output } = run(dir, ['audit', '--check']);
  assert.equal(code, 1, output);
  // This is the exact moment the promotion was for: a proof went stale after a
  // small edit. Telling the user to type the long form wastes the promotion.
  assert.match(output, /ai-flow verify --story/);
  assert.doesNotMatch(output, /ai-flow harness verify/);
});

test('a closed pipe ends the command instead of crashing it', (t) => {
  const dir = initProject(t, 'verify-epipe');

  // `ai-flow help --all | head -3` is ordinary use, and an unhandled EPIPE used
  // to print a Node stack trace over whatever the user was reading.
  const output = execFileSync('sh', ['-c', `node ${JSON.stringify(CLI)} help --all 2>&1 | head -3`], {
    cwd: dir,
    encoding: 'utf8',
  });

  assert.doesNotMatch(output, /EPIPE/);
  assert.doesNotMatch(output, /node:internal/);
});

test('list-skills reports the five remaining skills', (t) => {
  const dir = initProject(t, 'verify-skills');

  const { code, output } = run(dir, ['list-skills', '--json']);
  assert.equal(code, 0, output);

  const names = JSON.parse(output).map((skill) => skill.name);
  assert.deepEqual(names, ['flow-setup', 'flow-plan', 'flow-run', 'flow-review', 'flow-ship']);
});
