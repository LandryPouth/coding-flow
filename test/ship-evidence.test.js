'use strict';

// Tests des helpers d'évidence de `ship` : le bloc markdown est bien formé, son
// insertion dans un corps de PR est idempotente (remplace entre marqueurs, jamais
// le texte humain), et latestVerifyEvidence retient le run le plus récent.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildEvidenceBlock, upsertEvidenceBlock, latestVerifyEvidence } = require('../bin/lib/ship');

const START = '<!-- coding-flow:evidence:start -->';
const END = '<!-- coding-flow:evidence:end -->';

function sampleEvidence(ok = true) {
  return {
    generatedAt: '2026-07-21T10:00:00.000Z',
    story: 'epics/epic-01/story-01-01-demo',
    commandSource: 'config',
    commandsFound: 2,
    ok,
    provenance: {
      git: { shortCommit: 'abc1234', commit: 'abc1234def', dirty: false, author: { name: 'Ada Lovelace' } },
    },
    results: [
      { command: 'npm run typecheck', ok: true, exitCode: 0, timedOut: false, durationMs: 1200 },
      { command: 'npm test', ok, exitCode: ok ? 0 : 1, timedOut: false, durationMs: 3400 },
    ],
  };
}

test('buildEvidenceBlock enveloppe la preuve entre les marqueurs', () => {
  const block = buildEvidenceBlock(sampleEvidence(true));
  assert.ok(block.startsWith(START));
  assert.ok(block.trim().endsWith(END));
  assert.match(block, /✅ passed/);
  assert.match(block, /abc1234/);
  assert.match(block, /Ada Lovelace/);
  assert.match(block, /npm test/);
});

test('buildEvidenceBlock marque un échec', () => {
  const block = buildEvidenceBlock(sampleEvidence(false));
  assert.match(block, /❌ FAILED/);
  assert.match(block, /exit 1/);
});

test('upsertEvidenceBlock ajoute le bloc à un corps humain sans l’écraser', () => {
  const body = 'Résout #42.\n\nDétails de la PR écrits par un humain.';
  const block = buildEvidenceBlock(sampleEvidence(true));
  const next = upsertEvidenceBlock(body, block);
  assert.match(next, /Résout #42/);
  assert.match(next, /écrits par un humain/);
  assert.ok(next.includes(START) && next.includes(END));
});

test('upsertEvidenceBlock est idempotent (remplace, ne duplique pas)', () => {
  const body = 'Texte humain.';
  const first = upsertEvidenceBlock(body, buildEvidenceBlock(sampleEvidence(true)));
  const second = upsertEvidenceBlock(first, buildEvidenceBlock(sampleEvidence(false)));

  // Un seul bloc, et c'est le plus récent (FAILED) qui a remplacé l'ancien.
  assert.equal(second.match(new RegExp(START, 'g')).length, 1);
  assert.equal(second.match(new RegExp(END, 'g')).length, 1);
  assert.match(second, /❌ FAILED/);
  assert.doesNotMatch(second, /✅ passed/);
  assert.match(second, /Texte humain/);
});

test('latestVerifyEvidence retient le run le plus récent, null si aucun', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-shipev-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  assert.equal(latestVerifyEvidence(dir), null, 'aucun run → null');

  const runs = path.join(dir, '.coding-flow', 'runs');
  fs.mkdirSync(runs, { recursive: true });
  fs.writeFileSync(path.join(runs, '2026-07-21T09-00-00-000Z-verify.json'), JSON.stringify({ ok: true, tag: 'old' }));
  fs.writeFileSync(path.join(runs, '2026-07-21T10-00-00-000Z-verify.json'), JSON.stringify({ ok: false, tag: 'new' }));
  // Un fichier evidence ne doit pas être confondu avec un verify.
  fs.writeFileSync(path.join(runs, '2026-07-21T11-00-00-000Z-evidence.json'), JSON.stringify({ tag: 'evidence' }));

  const latest = latestVerifyEvidence(dir);
  assert.equal(latest.tag, 'new', 'le run verify le plus récent est retenu');
});
