'use strict';

// Tests de contrat de `ai-flow worktree`.
// On monte un vrai depot git jetable, on lance la CLI, et on verifie le
// comportement observable : dossiers crees, symlinks poses, branches
// conservees, codes de sortie. Zero dependance : node:test + git.

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

// Depot git jetable, avec un premier commit sur main. Le repo vit dans un
// sous-dossier `repo/` pour que le layout groupe (../repo-worktrees) ait un
// parent inscriptible.
function freshRepo(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-wt-'));
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, repo };
}

function run(cwd, args) {
  try {
    const output = execFileSync(process.execPath, [CLI, 'worktree', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function worktreePath(base, name) {
  return path.join(base, 'repo-worktrees', name);
}

test('worktree add cree le dossier et une nouvelle branche', (t) => {
  const { base, repo } = freshRepo(t);
  const { code } = run(repo, ['add', 'feat-x']);
  assert.equal(code, 0, 'add doit sortir en 0');

  const dest = worktreePath(base, 'feat-x');
  assert.ok(fs.existsSync(dest), 'le dossier worktree doit exister');

  const list = sh(repo, 'git', ['worktree', 'list', '--porcelain']);
  assert.ok(list.includes('refs/heads/feat-x'), 'la branche feat-x doit etre checkoutee dans un worktree');
});

test('worktree add symlink les fichiers .env presents a la racine', (t) => {
  const { base, repo } = freshRepo(t);
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');

  run(repo, ['add', 'feat-env']);
  const link = path.join(worktreePath(base, 'feat-env'), '.env');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), '.env doit etre un symlink dans le worktree');
  assert.equal(fs.readFileSync(link, 'utf8'), 'SECRET=1\n', 'le symlink doit pointer vers le .env racine');
});

test('worktree add --deps link symlink node_modules', (t) => {
  const { base, repo } = freshRepo(t);
  fs.mkdirSync(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'left-pad', 'index.js'), '');

  run(repo, ['add', 'feat-deps', '--deps', 'link']);
  const link = path.join(worktreePath(base, 'feat-deps'), 'node_modules');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'node_modules doit etre un symlink avec --deps link');
  assert.ok(
    fs.existsSync(path.join(link, 'left-pad', 'index.js')),
    'le symlink node_modules doit exposer le contenu de la racine',
  );
});

test('worktree add --dry-run n ecrit rien', (t) => {
  const { base, repo } = freshRepo(t);
  const { code } = run(repo, ['add', 'feat-dry', '--dry-run']);
  assert.equal(code, 0);
  assert.ok(!fs.existsSync(worktreePath(base, 'feat-dry')), '--dry-run ne doit creer aucun worktree');
});

test('worktree list montre le worktree ajoute', (t) => {
  const { repo } = freshRepo(t);
  run(repo, ['add', 'feat-list']);
  const { code, output } = run(repo, ['list']);
  assert.equal(code, 0);
  assert.ok(output.includes('feat-list'), 'list doit mentionner le worktree ajoute');
});

test('worktree remove retire le worktree mais conserve la branche', (t) => {
  const { base, repo } = freshRepo(t);
  run(repo, ['add', 'feat-rm']);
  const dest = worktreePath(base, 'feat-rm');
  assert.ok(fs.existsSync(dest));

  const { code } = run(repo, ['remove', 'feat-rm']);
  assert.equal(code, 0, 'remove doit sortir en 0');
  assert.ok(!fs.existsSync(dest), 'le dossier worktree doit etre supprime');

  const branches = sh(repo, 'git', ['branch', '--list', 'feat-rm']);
  assert.ok(branches.includes('feat-rm'), 'remove ne doit PAS supprimer la branche');
});

test('worktree remove reussit malgre nos propres symlinks .env', (t) => {
  const { base, repo } = freshRepo(t);
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  run(repo, ['add', 'feat-envrm']);
  // Le .env n'est PAS gitignore ici : sans traitement, le symlink pose par add
  // apparaitrait comme fichier non suivi et bloquerait remove.
  const { code } = run(repo, ['remove', 'feat-envrm']);
  assert.equal(code, 0, 'nos propres liens ne doivent pas bloquer remove');
  assert.ok(!fs.existsSync(worktreePath(base, 'feat-envrm')), 'le worktree doit etre supprime');
});

test('worktree remove refuse un worktree sale sans --force', (t) => {
  const { base, repo } = freshRepo(t);
  run(repo, ['add', 'feat-dirty']);
  fs.writeFileSync(path.join(worktreePath(base, 'feat-dirty'), 'wip.txt'), 'travail non commite');

  const { code } = run(repo, ['remove', 'feat-dirty']);
  assert.notEqual(code, 0, 'remove doit refuser tant que le worktree est sale');
  assert.ok(fs.existsSync(worktreePath(base, 'feat-dirty')), 'le worktree sale doit rester intact');
});
