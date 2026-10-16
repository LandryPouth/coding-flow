'use strict';

// Contract tests for who may run what `verify` finds: commands an agent wrote
// into plan.md need a human watching (or --allow-plan-commands), and --clean-env
// keeps credential-looking variables away from the child.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');
const STORY = 'epics/epic-01/story-01-01-demo';

function run(cwd, args, env = {}) {
  try {
    const output = execFileSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '', AI_FLOW_FORCE_TTY: '', NODE_ENV: 'test', ...env },
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// A project whose only command source is the story's plan.md; the command writes
// `marker.txt` so a test can tell whether it ran.
function planProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-plancmd-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const storyDir = path.join(dir, STORY);
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'spec.md'), '# Demo\n');
  fs.writeFileSync(
    path.join(storyDir, 'plan.md'),
    ['# Plan', '', '## Commands', '', '```bash', `node -e "require('fs').writeFileSync('marker.txt','ran')"`, '```', ''].join('\n'),
  );
  return dir;
}

const verify = (dir, extra = [], env = {}) => run(dir, ['verify', '--story', STORY, '--json', ...extra], env);
const marker = (dir) => fs.existsSync(path.join(dir, 'marker.txt'));

test('plan.md commands are refused under CI=true and nothing executes', (t) => {
  const dir = planProject(t);
  const { code, output } = verify(dir, [], { CI: 'true' });
  assert.notEqual(code, 0);
  const evidence = JSON.parse(output);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.unattended, true);
  assert.match(evidence.refused, /not run unattended.*--allow-plan-commands/);
  assert.equal(marker(dir), false);
});

test('plan.md commands are refused without a TTY, and run with --allow-plan-commands', (t) => {
  const dir = planProject(t);
  assert.notEqual(verify(dir).code, 0);
  assert.equal(marker(dir), false);

  const allowed = verify(dir, ['--allow-plan-commands', '--no-cache']);
  assert.equal(allowed.code, 0, allowed.output);
  assert.equal(marker(dir), true);
  assert.equal(JSON.parse(allowed.output).unattended, true);
});

test('in a terminal plan.md commands run, after announcing where they come from', (t) => {
  const dir = planProject(t);
  const { code, output } = run(dir, ['verify', '--story', STORY], { AI_FLOW_FORCE_TTY: '1' });
  assert.equal(code, 0, output);
  assert.match(output, /Running commands from plan\.md \(not from \.coding-flow\/config\.json\):/);
  assert.equal(marker(dir), true);
});

test('config commands still run under CI=true', (t) => {
  const dir = planProject(t);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: [`node -e "require('fs').writeFileSync('marker.txt','ran')"`] };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const { code, output } = verify(dir, [], { CI: 'true' });
  assert.equal(code, 0, output);
  assert.equal(JSON.parse(output).commandSource, 'config');
  assert.equal(marker(dir), true);
});

test('--clean-env hides credential-looking variables from the command, and records names only', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-cleanenv-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = {
    commands: [`node -e "console.log('key=' + (process.env.MY_API_KEY || 'none') + ' keep=' + process.env.KEEP_ME)"`],
  };
  fs.writeFileSync(configPath, JSON.stringify(config));

  const env = { MY_API_KEY: 'sekret-value', KEEP_ME: 'yes' };
  const plain = run(dir, ['verify', '--json'], env);
  assert.match(JSON.parse(plain.output).results[0].stdoutTail, /key=sekret-value/);

  const cleaned = run(dir, ['verify', '--json', '--clean-env', '--no-cache'], env);
  assert.equal(cleaned.code, 0, cleaned.output);
  const evidence = JSON.parse(cleaned.output);
  assert.match(evidence.results[0].stdoutTail, /key=none keep=yes/);
  assert.equal(evidence.environment.cleaned, true);
  assert.ok(evidence.environment.dropped.includes('MY_API_KEY'));
  assert.ok(!cleaned.output.includes('sekret-value'), 'values are never recorded');
});

test('a refusal does not overwrite an earlier green proof', (t) => {
  const dir = planProject(t);
  const attended = run(dir, ['verify', '--story', STORY, '--json'], { AI_FLOW_FORCE_TTY: '1' });
  assert.equal(attended.code, 0, attended.output);
  const status = () => run(dir, ['status'], { AI_FLOW_FORCE_TTY: '' }).output;
  assert.match(status(), /story-01-01-demo\s+verified/);

  const refused = verify(dir, ['--no-cache']);
  assert.notEqual(refused.code, 0);
  assert.match(JSON.parse(refused.output).refused, /not run unattended/);
  assert.match(status(), /story-01-01-demo\s+verified/, 'a refusal is not a failed verify');
});

test('run reports a refused story as skipped, not failed', (t) => {
  const dir = planProject(t);
  const { output } = run(dir, ['run', '--story', STORY]);
  assert.match(output, /\[skip\].*refused: commands from plan\.md/);
  assert.doesNotMatch(output, /\[FAIL\]/);
  assert.equal(marker(dir), false);
});

test('--clean-env is not answered from a cached proof made with the full environment', (t) => {
  const dir = planProject(t);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = { commands: [`node -e "console.log('key=' + (process.env.MY_API_KEY || 'none'))"`] };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const env = { MY_API_KEY: 'sekret-value' };

  assert.match(JSON.parse(run(dir, ['verify', '--json'], env).output).results[0].stdoutTail, /key=sekret-value/);
  const cleaned = JSON.parse(run(dir, ['verify', '--json', '--clean-env'], env).output);
  assert.notEqual(cleaned.reused, true);
  assert.match(cleaned.results[0].stdoutTail, /key=none/);
});

test('CI=1 counts as unattended too', (t) => {
  const dir = planProject(t);
  assert.notEqual(verify(dir, [], { CI: '1', AI_FLOW_FORCE_TTY: '1' }).code, 0);
  assert.equal(marker(dir), false);
});

test('AI_FLOW_FORCE_TTY alone does not skip the refusal outside NODE_ENV=test', (t) => {
  const dir = planProject(t);
  assert.notEqual(verify(dir, [], { AI_FLOW_FORCE_TTY: '1', NODE_ENV: 'production' }).code, 0);
  assert.equal(marker(dir), false);
});

test('--clean-env keeps PATH, HOME and CI for the command', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-cleanenv-keep-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  run(dir, ['init']);
  const configPath = path.join(dir, '.coding-flow', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.validation = {
    commands: [`node -e "console.log('keep=' + [process.env.PATH, process.env.HOME, process.env.CI].map(Boolean).join())"`],
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const { code, output } = run(dir, ['verify', '--json', '--clean-env'], { CI: 'true' });
  assert.equal(code, 0, output);
  assert.match(JSON.parse(output).results[0].stdoutTail, /keep=true,true,true/);
});
