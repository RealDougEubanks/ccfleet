'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Ensure clean env before each test by resetting at the top.
delete process.env.BASIC_AUTH_USER;
delete process.env.BASIC_AUTH_PASS;

const { buildAuth } = require('../lib/auth');

test('buildAuth returns null when neither credential is set', () => {
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASS;
  assert.equal(buildAuth(), null);
});

test('buildAuth returns null when only user is set', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  delete process.env.BASIC_AUTH_PASS;
  try {
    assert.equal(buildAuth(), null);
  } finally {
    delete process.env.BASIC_AUTH_USER;
  }
});

test('buildAuth returns null when only pass is set', () => {
  delete process.env.BASIC_AUTH_USER;
  process.env.BASIC_AUTH_PASS = 'secret';
  try {
    assert.equal(buildAuth(), null);
  } finally {
    delete process.env.BASIC_AUTH_PASS;
  }
});

test('buildAuth returns null when user is empty string', () => {
  process.env.BASIC_AUTH_USER = '  ';
  process.env.BASIC_AUTH_PASS = 'secret';
  try {
    assert.equal(buildAuth(), null);
  } finally {
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASS;
  }
});

test('buildAuth returns middleware function when both credentials are set', () => {
  process.env.BASIC_AUTH_USER = 'alice';
  process.env.BASIC_AUTH_PASS = 'hunter2';
  try {
    const mw = buildAuth();
    assert.equal(typeof mw, 'function', 'expected middleware function');
  } finally {
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASS;
  }
});

test('buildAuth throws when user contains unsafe characters', () => {
  process.env.BASIC_AUTH_USER = 'user;drop';
  process.env.BASIC_AUTH_PASS = 'secret';
  try {
    assert.throws(() => buildAuth(), /unsafe characters/);
  } finally {
    delete process.env.BASIC_AUTH_USER;
    delete process.env.BASIC_AUTH_PASS;
  }
});
