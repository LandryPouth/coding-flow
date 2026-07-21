'use strict';

// Tests de contrat de l'installation / mise a jour des templates.
// init/upgrade/uninstall ecrivent et suppriment des fichiers dans le repo de
// l'utilisateur : ce sont les operations les plus destructrices du CLI. On
// verifie le manifeste, les scripts npm, le respect d'un package.json existant
// et l'innocuite de --dry-run. Zero dependance : node:test.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-tpl-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
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

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('init ecrit le manifeste et la cheat sheet', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'manifest.json')), 'manifest.json doit exister');
  assert.ok(fs.existsSync(path.join(dir, '.coding-flow', 'COMMANDS.md')), 'COMMANDS.md doit exister');

  const manifest = readJson(path.join(dir, '.coding-flow', 'manifest.json'));
  assert.ok(manifest.files && Object.keys(manifest.files).length > 0, 'le manifeste doit indexer des fichiers');
});

test('init ajoute les scripts flow:* dans package.json', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const pkg = readJson(path.join(dir, 'package.json'));
  assert.ok(pkg.scripts, 'package.json doit avoir des scripts');
  assert.ok(pkg.scripts['flow:doctor'], 'flow:doctor doit etre ajoute');
  assert.ok(pkg.scripts['flow:status'], 'flow:status doit etre ajoute');
});

test('init preserve un package.json existant et ses scripts', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'mon-app', scripts: { dev: 'vite' } }, null, 2),
  );

  run(dir, ['init']);
  const pkg = readJson(path.join(dir, 'package.json'));
  assert.equal(pkg.name, 'mon-app', 'le nom existant doit etre preserve');
  assert.equal(pkg.scripts.dev, 'vite', 'un script existant ne doit jamais etre ecrase');
  assert.ok(pkg.scripts['flow:doctor'], 'les scripts flow:* doivent quand meme etre ajoutes');
});

test('upgrade --json renvoie un rapport exploitable', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const { code, output } = run(dir, ['upgrade', '--json']);
  assert.equal(code, 0, 'upgrade doit sortir en 0');

  const report = JSON.parse(output);
  for (const key of ['copied', 'updated', 'skippedModified', 'unchanged']) {
    assert.ok(Array.isArray(report[key]), `le rapport upgrade doit exposer ${key} comme tableau`);
  }
});

test('upgrade restaure un fichier gere supprime', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const target = path.join(dir, 'AGENT_RULES.md');
  fs.unlinkSync(target);

  run(dir, ['upgrade']);
  assert.ok(fs.existsSync(target), 'upgrade doit recopier un fichier gere manquant');
});

test('uninstall --dry-run ne supprime aucun fichier', (t) => {
  const dir = freshProject(t);
  run(dir, ['init']);
  const marker = path.join(dir, 'AGENT_RULES.md');
  assert.ok(fs.existsSync(marker), 'pre-condition : le fichier existe apres init');

  const { code } = run(dir, ['uninstall', '--dry-run']);
  assert.equal(code, 0, 'uninstall --dry-run doit sortir en 0');
  assert.ok(fs.existsSync(marker), '--dry-run ne doit rien supprimer');
});
