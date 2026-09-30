'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authCheckStatus, overallStatus, parseAuthStatus } = require('../lib/health');

function checks(overrides) {
  return {
    tmux: { status: 'ok' },
    git_root: { status: 'ok' },
    claude: { status: 'ok' },
    claude_auth: { status: 'ok' },
    ...overrides,
  };
}

test('overallStatus fails when tmux fails', () => {
  assert.equal(overallStatus(checks({ tmux: { status: 'fail' } })), 'fail');
});

test('overallStatus fails when git_root fails', () => {
  assert.equal(overallStatus(checks({ git_root: { status: 'fail' } })), 'fail');
});

test('overallStatus is degraded when only claude is missing', () => {
  assert.equal(overallStatus(checks({ claude: { status: 'fail' } })), 'degraded');
});

test('overallStatus is degraded when claude is not logged in', () => {
  assert.equal(overallStatus(checks({ claude_auth: { status: 'fail' } })), 'degraded');
});

test('overallStatus is degraded when claude uses a login without Remote Control', () => {
  assert.equal(overallStatus(checks({ claude_auth: { status: 'degraded' } })), 'degraded');
});

test('authCheckStatus is ok for a claude.ai subscription login', () => {
  assert.equal(authCheckStatus({ loggedIn: true, method: 'claude.ai' }), 'ok');
});

test('authCheckStatus is degraded for a setup-token or API key login', () => {
  assert.equal(authCheckStatus({ loggedIn: true, method: 'oauth_token' }), 'degraded');
  assert.equal(authCheckStatus({ loggedIn: true, method: 'api_key' }), 'degraded');
  assert.equal(authCheckStatus({ loggedIn: true, method: null }), 'degraded');
});

test('authCheckStatus fails when claude is not logged in', () => {
  assert.equal(authCheckStatus({ loggedIn: false, method: 'claude.ai' }), 'fail');
  assert.equal(authCheckStatus({ loggedIn: false, method: null }), 'fail');
});

test('overallStatus is ok when all dependencies are ok', () => {
  assert.equal(overallStatus(checks({})), 'ok');
});

test('parseAuthStatus reports logged-in state and method', () => {
  assert.deepEqual(
    parseAuthStatus(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' })),
    { loggedIn: true, method: 'oauth_token' },
  );
});

test('parseAuthStatus drops identifying fields from the CLI output', () => {
  const result = parseAuthStatus(JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    email: 'someone@example.com',
    orgId: 'org-123',
    orgName: 'Example Org',
  }));
  assert.deepEqual(Object.keys(result).sort(), ['loggedIn', 'method']);
});

test('parseAuthStatus treats loggedIn other than true as logged out', () => {
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: 'yes' })).loggedIn, false);
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: false, authMethod: 'none' })).loggedIn, false);
});

test('parseAuthStatus handles malformed and non-object output', () => {
  assert.deepEqual(parseAuthStatus('not json'), { loggedIn: false, method: null });
  assert.deepEqual(parseAuthStatus(''), { loggedIn: false, method: null });
  assert.deepEqual(parseAuthStatus('null'), { loggedIn: false, method: null });
  assert.deepEqual(parseAuthStatus('42'), { loggedIn: false, method: null });
});

test('parseAuthStatus ignores a non-string authMethod', () => {
  assert.equal(parseAuthStatus(JSON.stringify({ loggedIn: true, authMethod: { x: 1 } })).method, null);
});
