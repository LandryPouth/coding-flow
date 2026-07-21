'use strict';

// Tests de contrat de la CLI ai-flow.
// On teste le comportement observable (ce que la CLI écrit sur le disque et son
// code de sortie), pas les internes — c'est ce qui protège vraiment le repo de
// l'utilisateur contre une régression de init / upgrade / uninstall / doctor.
//
// Zéro dépendance : uniquement le runner intégré `node:test` (Node >= 18).
//   node --test        (ou `npm test`)

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

// Crée un projet jetable et programme son nettoyage à la fin du test.
function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Lance la CLI dans `cwd`. Ne jette jamais : renvoie { code, output }.
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

const REQUIRED_FILES = ['PROJECT_RULES.md', 'AGENT_RULES.md', 'CLAUDE.md', 'AGENTS.md', 'package.json'];
const REQUIRED_DIRS = ['.claude/skills', '.agents/skills', 'docs', 'epics', '.coding-flow'];

test('init installe la structure de base et réussit', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init']);
  assert.equal(code, 0, 'init doit sortir en 0');

  for (const f of REQUIRED_FILES) {
    assert.ok(fs.existsSync(path.join(dir, f)), `fichier manquant après init : ${f}`);
  }
  for (const d of REQUIRED_DIRS) {
    assert.ok(fs.existsSync(path.join(dir, d)), `dossier manquant après init : ${d}`);
  }
});

test('init crée un package.json privé quand il n\'y en a pas', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.private, true, 'le package.json généré doit être private:true');
});

test('init --dry-run n\'écrit aucun fichier', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['init', '--dry-run']);
  assert.equal(code, 0);
  assert.equal(fs.readdirSync(dir).length, 0, '--dry-run ne doit rien écrire');
});

test('doctor réussit sur une installation saine', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  assert.equal(run(dir, ['doctor']).code, 0, 'doctor doit passer après un init propre');
});

test('doctor échoue quand un fichier requis manque', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  fs.unlinkSync(path.join(dir, 'PROJECT_RULES.md'));
  assert.notEqual(run(dir, ['doctor']).code, 0, 'doctor doit détecter un fichier manquant');
});

test('doctor --fix restaure un fichier requis manquant', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const target = path.join(dir, 'PROJECT_RULES.md');
  fs.unlinkSync(target);
  run(dir, ['doctor', '--fix']);
  assert.ok(fs.existsSync(target), 'doctor --fix doit recréer le fichier');
});

test('upgrade est idempotent et préserve les modifications locales', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'PROJECT_RULES.md');
  fs.appendFileSync(rules, '\n<!-- MARQUEUR-LOCAL -->\n');

  const { code } = run(dir, ['upgrade']);
  assert.equal(code, 0, 'upgrade doit sortir en 0');
  assert.ok(
    fs.readFileSync(rules, 'utf8').includes('MARQUEUR-LOCAL'),
    'upgrade ne doit jamais écraser une modification locale',
  );
});

test('init --force réinstalle et écrase les modifications locales', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const rules = path.join(dir, 'PROJECT_RULES.md');
  fs.appendFileSync(rules, '\n<!-- MARQUEUR-LOCAL -->\n');

  run(dir, ['init', '--force']);
  assert.ok(
    !fs.readFileSync(rules, 'utf8').includes('MARQUEUR-LOCAL'),
    '--force doit réinstaller le template par-dessus',
  );
});

test('uninstall retire les fichiers gérés mais conserve epics/', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);

  const story = path.join(dir, 'epics', 'epic-99-test', 'story.md');
  fs.mkdirSync(path.dirname(story), { recursive: true });
  fs.writeFileSync(story, 'ma story');

  assert.equal(run(dir, ['uninstall']).code, 0, 'uninstall doit sortir en 0');
  assert.ok(fs.existsSync(story), 'uninstall ne doit jamais toucher à epics/');
  assert.ok(
    !fs.existsSync(path.join(dir, 'AGENT_RULES.md')),
    'uninstall doit retirer les fichiers gérés',
  );
});

test('list-skills liste les skills disponibles', (t) => {
  const dir = freshProject(t);
  const { code, output } = run(dir, ['list-skills']);
  assert.equal(code, 0);
  assert.ok(output.includes('run-story'), 'la sortie doit contenir au moins un skill connu');
});
