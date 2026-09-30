'use strict';

const { execFile } = require('child_process');
const fs = require('fs/promises');

const PROBE_TIMEOUT_MS = 1000;

function probeExec(cmd, args) {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS }, (err) => {
      resolve({ ok: !err, latency_ms: Date.now() - start });
    });
  });
}

async function probeGitRoot(gitRoot) {
  const start = Date.now();
  try {
    await fs.access(gitRoot, fs.constants.R_OK);
    return { ok: true, latency_ms: Date.now() - start };
  } catch {
    return { ok: false, latency_ms: Date.now() - start };
  }
}

const AUTH_PROBE_TIMEOUT_MS = 3000;

// Only the two non-identifying fields leave this function; the CLI output
// also carries email and org details that /health must not expose.
function parseAuthStatus(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || typeof parsed !== 'object') return { loggedIn: false, method: null };
    return {
      loggedIn: parsed.loggedIn === true,
      method: typeof parsed.authMethod === 'string' ? parsed.authMethod : null,
    };
  } catch {
    return { loggedIn: false, method: null };
  }
}

// Remote Control and claude.ai MCP connectors need a claude.ai subscription
// login. Tokens from `claude setup-token` and API keys authenticate model
// calls only, so sessions start but never appear in the Claude apps.
const SUBSCRIPTION_AUTH_METHOD = 'claude.ai';

function authCheckStatus({ loggedIn, method }) {
  if (!loggedIn) return 'fail';
  return method === SUBSCRIPTION_AUTH_METHOD ? 'ok' : 'degraded';
}

// `claude auth status` confirms credentials are present and readable, not
// that they are unexpired.
function probeClaudeAuth() {
  return new Promise((resolve) => {
    const start = Date.now();
    execFile('claude', ['auth', 'status', '--json'], { timeout: AUTH_PROBE_TIMEOUT_MS }, (err, stdout) => {
      const parsed = err ? { loggedIn: false, method: null } : parseAuthStatus(stdout);
      resolve({ status: authCheckStatus(parsed), method: parsed.method, latency_ms: Date.now() - start });
    });
  });
}

async function runChecks(gitRoot) {
  const [tmux, claude, claudeAuth, gitRootCheck] = await Promise.all([
    probeExec('tmux', ['-V']),
    probeExec('claude', ['--version']),
    probeClaudeAuth(),
    probeGitRoot(gitRoot),
  ]);

  return {
    claude: { status: claude.ok ? 'ok' : 'fail', latency_ms: claude.latency_ms },
    claude_auth: { status: claudeAuth.status, method: claudeAuth.method, latency_ms: claudeAuth.latency_ms },
    git_root: { status: gitRootCheck.ok ? 'ok' : 'fail', latency_ms: gitRootCheck.latency_ms },
    tmux: { status: tmux.ok ? 'ok' : 'fail', latency_ms: tmux.latency_ms },
  };
}

function overallStatus(checks) {
  if (checks.tmux.status !== 'ok' || checks.git_root.status !== 'ok') return 'fail';
  if (checks.claude.status !== 'ok') return 'degraded';
  if (checks.claude_auth.status !== 'ok') return 'degraded';
  return 'ok';
}

module.exports = { authCheckStatus, runChecks, overallStatus, parseAuthStatus };
