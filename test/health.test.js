'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { overallStatus } = require('../lib/health');

test('overallStatus fails when tmux fails', () => {
  assert.equal(
    overallStatus({
      tmux: { status: 'fail' },
      git_root: { status: 'ok' },
      claude: { status: 'ok' },
    }),
    'fail',
  );
});

test('overallStatus fails when git_root fails', () => {
  assert.equal(
    overallStatus({
      tmux: { status: 'ok' },
      git_root: { status: 'fail' },
      claude: { status: 'ok' },
    }),
    'fail',
  );
});

test('overallStatus is degraded when only claude is missing', () => {
  assert.equal(
    overallStatus({
      tmux: { status: 'ok' },
      git_root: { status: 'ok' },
      claude: { status: 'fail' },
    }),
    'degraded',
  );
});

test('overallStatus is ok when all dependencies are ok', () => {
  assert.equal(
    overallStatus({
      tmux: { status: 'ok' },
      git_root: { status: 'ok' },
      claude: { status: 'ok' },
    }),
    'ok',
  );
});
