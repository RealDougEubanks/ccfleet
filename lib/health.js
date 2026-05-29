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

async function runChecks(gitRoot) {
  const [tmux, claude, gitRootCheck] = await Promise.all([
    probeExec('tmux', ['-V']),
    probeExec('claude', ['--version']),
    probeGitRoot(gitRoot),
  ]);

  return {
    claude: { status: claude.ok ? 'ok' : 'fail', latency_ms: claude.latency_ms },
    git_root: { status: gitRootCheck.ok ? 'ok' : 'fail', latency_ms: gitRootCheck.latency_ms },
    tmux: { status: tmux.ok ? 'ok' : 'fail', latency_ms: tmux.latency_ms },
  };
}

function overallStatus(checks) {
  if (checks.tmux.status !== 'ok' || checks.git_root.status !== 'ok') return 'fail';
  if (checks.claude.status !== 'ok') return 'degraded';
  return 'ok';
}

module.exports = { runChecks, overallStatus };
