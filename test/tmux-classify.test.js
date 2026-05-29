'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../lib/tmux');

test('classify returns active for claude or node', () => {
  assert.equal(classify('claude'), 'active');
  assert.equal(classify('node'), 'active');
});

test('classify returns idle for known shells', () => {
  assert.equal(classify('zsh'), 'idle');
  assert.equal(classify('bash'), 'idle');
  assert.equal(classify('-zsh'), 'idle');
});

test('classify returns unknown for empty or unfamiliar', () => {
  assert.equal(classify(''), 'unknown');
  assert.equal(classify(undefined), 'unknown');
  assert.equal(classify('vim'), 'unknown');
});
