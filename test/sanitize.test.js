'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidProjectName,
  isValidSessionName,
  toSessionName,
  MAX_NAME_LENGTH,
} = require('../lib/sanitize');

test('isValidProjectName accepts plain names', () => {
  assert.equal(isValidProjectName('bookmarkminder'), true);
  assert.equal(isValidProjectName('nannylaura.com'), true);
  assert.equal(isValidProjectName('propagate-iac'), true);
  assert.equal(isValidProjectName('proj_1'), true);
});

test('isValidProjectName rejects path traversal and shell metacharacters', () => {
  for (const bad of [
    '..',
    '.',
    '../etc',
    'a/b',
    'a\\b',
    'a;rm -rf /',
    'a b',
    'a$b',
    'a`b`',
    'a|b',
    'a&b',
    '',
    null,
    undefined,
    123,
  ]) {
    assert.equal(isValidProjectName(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('isValidProjectName enforces length cap', () => {
  const long = 'a'.repeat(MAX_NAME_LENGTH + 1);
  assert.equal(isValidProjectName(long), false);
  const ok = 'a'.repeat(MAX_NAME_LENGTH);
  assert.equal(isValidProjectName(ok), true);
});

test('isValidSessionName forbids dots', () => {
  assert.equal(isValidSessionName('proj_1'), true);
  assert.equal(isValidSessionName('proj-1'), true);
  assert.equal(isValidSessionName('proj.1'), false);
});

test('toSessionName replaces dots with underscores', () => {
  assert.equal(toSessionName('nannylaura.com'), 'nannylaura_com');
  assert.equal(toSessionName('bookmarkminder'), 'bookmarkminder');
});

test('toSessionName throws on invalid input', () => {
  assert.throws(() => toSessionName('../etc'));
  assert.throws(() => toSessionName(''));
  assert.throws(() => toSessionName('a;b'));
});
