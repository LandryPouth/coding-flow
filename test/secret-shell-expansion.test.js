'use strict';

// A command substitution is not a credential (story 13-02). The "Long assigned
// credential" heuristic reported `password="$(aws secretsmanager …)"`: the
// secret is fetched at run time, not written in the file. The exemption is for
// heuristic matches only; an exact key format inside a `$(…)` line still counts.

const { test } = require('node:test');
const assert = require('node:assert');

const { getSecretPatterns, findSecretsInContent } = require('../bin/lib/security-policy');

const scan = (line) => findSecretsInContent(line, getSecretPatterns());

// Built at run time so this file holds no key-shaped literal for the guard to refuse.
const AWS_KEY = ['AKIA', 'QYLPMN5HHHFPZAM2'].join('');

test('a command substitution assigned to password is not a finding', () => {
  assert.deepEqual(scan('password="$(aws secretsmanager get-random-password --query X)"'), []);
});

test('parameter expansions, bare variables and backtick substitutions are not findings', () => {
  assert.deepEqual(scan('password="${DB_PASSWORD:-changeme-placeholder-x}"'), []);
  assert.deepEqual(scan('token="$DB_PASSWORD_FROM_THE_VAULT_X"'), []);
  assert.deepEqual(scan('secret="`vault read -field=value secret/app/prod`"'), []);
});

test('a literal twenty-character password is still a finding', () => {
  const found = scan('password="hunter2-but-twenty-chars-long"');

  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'Long assigned credential');
});

test('an exact key format inside a $(…) line is still a finding', () => {
  const found = scan(`export K="$(echo ${AWS_KEY})"`);

  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'AWS access key');
});

test('the exemption never applies to an exact pattern, whatever it captures', () => {
  const exact = [{ name: 'custom', regex: /token\s*=\s*"[^"]+"/, precision: 'exact' }];

  assert.equal(findSecretsInContent('token="$(vault read x)"', exact).length, 1);
});
