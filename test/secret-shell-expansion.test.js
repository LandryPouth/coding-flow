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

// The exemption is for a value that is ONE expansion, not for any value that
// merely starts with `$` (independent review of 13-02).
test('a literal that merely starts with $ or follows an expansion is still a finding', () => {
  for (const line of [
    'password="$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"',
    'secret="${HOME}realliteralsecret1234567890"',
    'password="$(a)realliteralsecret1234567890$(b)"',
    'password="`a`realliteralsecret1234567890"',
  ]) {
    assert.equal(scan(line).length, 1, line);
  }
});

test('a literal assignment after an expansion on the same line is still a finding', () => {
  const line = 'password="$(aws secretsmanager get-random-password --x)" token="realliteralsecret1234567890"';

  assert.equal(scan(line).length, 1);
});

test('nested expansions and a global-flag custom pattern behave the same', () => {
  assert.deepEqual(scan('password="$(aws ssm get-parameter --name $(printf %s x))"'), []);

  const custom = [{ name: 'c', regex: /token\s*=\s*"[^"]{20,}"/g, precision: 'heuristic' }];
  assert.equal(findSecretsInContent('token="$(vault read secret/app/prod-token)"', custom).length, 0);
  assert.equal(findSecretsInContent('token="literal-literal-literal-lit"', custom).length, 1);
});

test('single-quoted values are not expanded, so they are still findings', () => {
  assert.equal(scan("password='$(literal-literal-literal-lit)'").length, 1);
  assert.equal(scan("password='$ecretPassw0rdLongEnough1'").length, 1);
});

test('a custom match holding several quoted values is not exempted by the first', () => {
  const custom = [{ name: 'c', regex: /(k=)"[^"]+"\s+"[^"]{20,}"/, precision: 'heuristic' }];

  assert.equal(findSecretsInContent('k="$(a)" "realliteralsecret1234567"', custom).length, 1);
});

test('a literal default inside ${VAR:-…} is the documented, accepted shape', () => {
  assert.deepEqual(scan('password="${DB_PASSWORD:-changeme-placeholder-x}"'), []);
});
