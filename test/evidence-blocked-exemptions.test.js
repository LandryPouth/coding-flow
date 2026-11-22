'use strict';

// The evidence entries in `blockedPaths` are the guard's, not the commit check's
// or the Codex probe's: `ship` commits run files on purpose, and a probe that
// denied `.coding-flow/runs` would stop `verify` from writing its own proof.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkSensitivePaths } = require('../bin/lib/security-policy');
const { probeDirectory } = require('../bin/lib/codex-probe');
const { EVIDENCE_BLOCKED_PATHS } = require('../bin/lib/harness-config');

test('a committed run file or ledger is not a blocked_path_present; a real blocked path still is', () => {
  const config = { blockedPaths: [...EVIDENCE_BLOCKED_PATHS, '.env'], sensitiveGlobs: [] };
  const report = { errors: [], warnings: [] };
  const files = ['.coding-flow/runs/x-verify.json', '.coding-flow/ledger.jsonl', '.env'].map((f) => path.join(process.cwd(), f));

  checkSensitivePaths(files, config, report);

  assert.deepEqual(report.errors.map((e) => e.file), ['.env']);
});

test('the Codex probe never picks an evidence directory as the denied one', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-flow-probedir-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.coding-flow'), { recursive: true });
  const policy = (blockedPaths) => fs.writeFileSync(path.join(dir, '.coding-flow', 'harness.json'), JSON.stringify({ version: 1, blockedPaths }));

  policy([...EVIDENCE_BLOCKED_PATHS]);
  assert.equal(probeDirectory(dir), null);

  policy([...EVIDENCE_BLOCKED_PATHS, 'secrets/**']);
  assert.equal(probeDirectory(dir), 'secrets');
});
