'use strict';

// Tests de contrat de `ai-flow ship`.
// On monte un vrai depot git + un remote "origin" bare local. Comme l'origin
// n'est pas github.com, la branche gh (creation de PR) est volontairement
// court-circuitee : les tests restent hermetiques, que `gh` soit installe ou
// non sur la machine. On verifie les garde-fous et le push reel.

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
    const output = execFileSync(process.execPath, [CLI, 'ship', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (err) {
    return { code: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

// Depot avec un remote bare local nomme origin, un commit initial sur main
// pousse, et (par defaut) une branche de feature checkoutee avec un commit.
function repoWithOrigin(t, { withFeature = true } = {}) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ship-'));
  const originDir = path.join(baseDir, 'origin.git');
  const repo = path.join(baseDir, 'repo');
  fs.mkdirSync(repo);

  sh(baseDir, 'git', ['init', '--bare', 'origin.git']);
  sh(repo, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(repo, 'git', ['config', 'user.email', 'test@example.com']);
  sh(repo, 'git', ['config', 'user.name', 'Test']);
  sh(repo, 'git', ['remote', 'add', 'origin', originDir]);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  sh(repo, 'git', ['add', '.']);
  sh(repo, 'git', ['commit', '-m', 'init']);
  sh(repo, 'git', ['push', '-u', 'origin', 'main']);

  if (withFeature) {
    sh(repo, 'git', ['checkout', '-b', 'feat/payments']);
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');
    sh(repo, 'git', ['add', '.']);
    sh(repo, 'git', ['commit', '-m', 'add feature']);
  }

  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }));
  return { baseDir, originDir, repo };
}

function originHasBranch(originDir, branch) {
  const refs = sh(originDir, 'git', ['branch', '--list', branch]);
  return refs.includes(branch);
}

test('ship refuse quand on est sur la base', (t) => {
  const { repo } = repoWithOrigin(t, { withFeature: false });
  const { code, output } = run(repo, []);
  assert.notEqual(code, 0, 'ship doit refuser depuis main');
  assert.match(output, /base/i, 'le message doit expliquer qu\'on est sur la base');
});

test('ship refuse sans remote origin', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-ship-noorigin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  sh(dir, 'git', ['-c', 'init.defaultBranch=main', 'init']);
  sh(dir, 'git', ['config', 'user.email', 't@e.com']);
  sh(dir, 'git', ['config', 'user.name', 'T']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-m', 'init']);
  sh(dir, 'git', ['checkout', '-b', 'feat/x']);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'y\n');
  sh(dir, 'git', ['add', '.']);
  sh(dir, 'git', ['commit', '-m', 'work']);

  const { code, output } = run(dir, []);
  assert.notEqual(code, 0, 'ship doit refuser sans origin');
  assert.match(output, /origin/i, 'le message doit mentionner origin');
});

test('ship refuse quand il n\'y a aucun commit au-dessus de la base', (t) => {
  const { repo } = repoWithOrigin(t, { withFeature: false });
  // Branche sans commit supplementaire.
  sh(repo, 'git', ['checkout', '-b', 'feat/empty']);
  const { code, output } = run(repo, []);
  assert.notEqual(code, 0, 'ship doit refuser une branche sans commit a shipper');
  assert.match(output, /commit/i, 'le message doit parler de commits');
});

test('ship --dry-run ne pousse rien', (t) => {
  const { originDir, repo } = repoWithOrigin(t);
  const { code } = run(repo, ['--dry-run']);
  assert.equal(code, 0, 'ship --dry-run doit sortir en 0');
  assert.ok(!originHasBranch(originDir, 'feat/payments'), '--dry-run ne doit pousser aucune branche');
});

test('ship pousse la branche de feature vers origin', (t) => {
  const { originDir, repo } = repoWithOrigin(t);
  const { code, output } = run(repo, []);
  assert.equal(code, 0, `ship doit reussir (${output})`);
  assert.ok(originHasBranch(originDir, 'feat/payments'), 'la branche doit exister sur origin apres ship');
});

test('ship sur un remote non-GitHub pousse sans gerer de PR', (t) => {
  const { repo } = repoWithOrigin(t);
  const { code, output } = run(repo, []);
  assert.equal(code, 0);
  assert.match(output, /non-GitHub|PR non geree/i, 'sur un remote non-GitHub, aucune PR n\'est tentee');
});
