'use strict';

// Tests de contrat du harnais de securite (`ai-flow harness`).
// C'est la logique la plus sensible du CLI : elle decide si un secret ou un
// fichier dangereux passe. On teste le comportement observable — code de sortie
// et JSON — sur des projets jetables. Zero dependance : node:test.

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'ai-flow.js');

function freshProject(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-harness-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# projet\n');
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

test('harness init cree la config de politique', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'init']);
  assert.equal(code, 0, 'harness init doit sortir en 0');
  assert.ok(
    fs.existsSync(path.join(dir, '.coding-flow', 'harness.json')),
    'harness init doit ecrire .coding-flow/harness.json',
  );
});

test('harness check passe sur un projet propre', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'check']);
  assert.equal(code, 0, 'un projet sans secret ni fichier sensible doit passer');
});

test('harness check detecte un secret et echoue', (t) => {
  const dir = freshProject(t);
  // Cle Stripe live factice : le pattern doit la reperer.
  fs.writeFileSync(path.join(dir, 'config.js'), 'const k = "sk_live_51H8xYzABCDEFGHIJKLMNOP";\n');
  const { code, output } = run(dir, ['harness', 'check']);
  assert.notEqual(code, 0, 'un secret detecte doit faire echouer le check');
  assert.match(output, /secret|Stripe/i, 'la sortie doit mentionner le secret');
});

test('harness check refuse un fichier .env non exemple', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(path.join(dir, '.env'), 'API_KEY=abc\n');
  const { code } = run(dir, ['harness', 'check']);
  assert.notEqual(code, 0, '.env est un chemin bloque et doit faire echouer le check');
});

test('harness check tolere .env.example', (t) => {
  const dir = freshProject(t);
  fs.writeFileSync(path.join(dir, '.env.example'), 'API_KEY=\n');
  const { code } = run(dir, ['harness', 'check']);
  assert.equal(code, 0, '.env.example est un exemple sur et ne doit pas bloquer');
});

test('harness preflight classe une story de paiement en risque high', (t) => {
  const dir = freshProject(t);
  const storyDir = path.join(dir, 'epics', 'epic-01-pay', 'story-01-01-stripe');
  fs.mkdirSync(storyDir, { recursive: true });
  fs.writeFileSync(path.join(storyDir, 'story.md'), '# Paiement\n\nIntegration Stripe payment et webhook.\n');

  const { code, output } = run(dir, [
    'harness', 'preflight',
    '--story', 'epics/epic-01-pay/story-01-01-stripe',
    '--json',
  ]);
  assert.equal(code, 0, 'preflight doit sortir en 0');
  const contract = JSON.parse(output);
  assert.equal(contract.risk.level, 'high', 'une story Stripe/payment doit etre high risk');
});

test('harness evidence ecrit un fichier de run', (t) => {
  const dir = freshProject(t);
  const { code } = run(dir, ['harness', 'evidence']);
  assert.equal(code, 0, 'evidence doit sortir en 0 sur un projet propre');

  const runsDir = path.join(dir, '.coding-flow', 'runs');
  assert.ok(fs.existsSync(runsDir), 'le dossier runs doit exister');
  const files = fs.readdirSync(runsDir).filter((name) => name.endsWith('-evidence.json'));
  assert.ok(files.length >= 1, 'un fichier evidence doit etre ecrit');
});
