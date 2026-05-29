'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseOriginProjectName } = require('../lib/git');

test('parseOriginProjectName extracts repo from https URL', () => {
  assert.equal(
    parseOriginProjectName('https://github.com/RealDougEubanks/ClaudeMarketplace'),
    'ClaudeMarketplace',
  );
});

test('parseOriginProjectName strips trailing .git', () => {
  assert.equal(
    parseOriginProjectName('https://github.com/RealDougEubanks/ClaudeMarketplace.git'),
    'ClaudeMarketplace',
  );
});

test('parseOriginProjectName handles SSH URLs', () => {
  assert.equal(
    parseOriginProjectName('git@github.com:RealDougEubanks/ClaudeMarketplace.git'),
    'ClaudeMarketplace',
  );
});

test('parseOriginProjectName handles deeper paths (GitLab subgroups)', () => {
  assert.equal(
    parseOriginProjectName('https://gitlab.com/group/subgroup/some-repo.git'),
    'some-repo',
  );
});

test('parseOriginProjectName tolerates trailing slash', () => {
  assert.equal(
    parseOriginProjectName('https://github.com/x/y/'),
    'y',
  );
});

test('parseOriginProjectName returns null for empty or non-string input', () => {
  assert.equal(parseOriginProjectName(''), null);
  assert.equal(parseOriginProjectName(null), null);
  assert.equal(parseOriginProjectName(undefined), null);
  assert.equal(parseOriginProjectName(42), null);
});

test('parseOriginProjectName rejects names with unsafe characters', () => {
  assert.equal(parseOriginProjectName('https://x/foo bar'), null);
  assert.equal(parseOriginProjectName('https://x/foo;rm'), null);
  assert.equal(parseOriginProjectName('https://x/foo$bar'), null);
});
