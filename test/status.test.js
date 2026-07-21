'use strict';

// Tests de contrat de l'integration worktree <-> story.
// `worktree add --story <dir>` nomme la branche d'apres le dossier de la story ;
// `status` relie alors la story a son worktree (correspondance sans etat). On
// verifie ce couplage de bout en bout sur un vrai depot git jetable.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

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

// Depot git jetable dans un sous-dossier repo/ (pour que ../repo-worktrees ait
// un parent inscriptible), avec une story prete a etre liee.
function repoWithStory(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-status-'));
  const repo = path.join(base, 'repo');
  const storyRel = 'epics/epic-03-kyc/story-03-01-kyc-upload';
  fs.mkdirSync(path.join(repo, storyRel), { recursive: true });
  fs.writeFileSync(path.join(repo, storyRel, 'story.md'), '# Story 03.01 - KYC upload\n');
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo, storyRel, storyName: 'story-03-01-kyc-upload' };
}

function statusJson(cwd) {
  const { code, output } = run(cwd, ['status', '--json']);
  assert.equal(code, 0, `status --json doit sortir en 0 (${output})`);
  return JSON.parse(output);
}

test('worktree add --story nomme la branche d\'apres le dossier de la story', (t) => {
  const { base, repo, storyRel, storyName } = repoWithStory(t);
  const { code } = run(repo, ['worktree', 'add', '--story', storyRel]);
  assert.equal(code, 0, 'add --story doit reussir');

  assert.ok(
    fs.existsSync(path.join(base, 'repo-worktrees', storyName)),
    'le worktree doit prendre le nom du dossier de la story',
  );
  const branches = sh(repo, 'git', ['branch', '--list', storyName]);
  assert.ok(branches.includes(storyName), 'la branche doit porter le nom de la story');
});

test('status relie la story a son worktree', (t) => {
  const { repo, storyRel } = repoWithStory(t);
  run(repo, ['worktree', 'add', '--story', storyRel]);

  const data = statusJson(repo);
  const story = data.epics[0].stories[0];
  assert.ok(story.worktree, 'la story doit exposer le chemin de son worktree');
  assert.ok(story.worktree.includes('story-03-01-kyc-upload'), 'le worktree pointe vers le bon dossier');
});

test('status liste les worktrees sans story dans la section "hors story"', (t) => {
  const { repo } = repoWithStory(t);
  run(repo, ['worktree', 'add', 'feat-libre']);

  const data = statusJson(repo);
  const loose = data.worktrees.loose.map((entry) => entry.branch);
  assert.ok(loose.includes('feat-libre'), 'une branche libre doit apparaitre en worktree hors story');
});

test('status ne plante pas hors d\'un depot git', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-status-nogit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'epics', 'epic-01-x', 'story-01-01-y'), { recursive: true });

  const data = statusJson(dir);
  assert.equal(data.epics[0].stories[0].worktree, null, 'sans git, aucune story n\'est liee a un worktree');
  assert.equal(data.worktrees.active, false, 'le bloc worktrees doit indiquer active:false hors depot');
});

test('worktree add --story refuse un dossier de story inexistant', (t) => {
  const { repo } = repoWithStory(t);
  const { code } = run(repo, ['worktree', 'add', '--story', 'epics/epic-99/story-99-99-ghost']);
  assert.notEqual(code, 0, 'une story inexistante doit faire echouer add');
});
