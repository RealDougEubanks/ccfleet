'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Point every tmux call (ours and lib/tmux.js's) at a private server so the
// developer's real tmux sessions are never touched.
delete process.env.TMUX;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfleet-tmux-'));
process.env.TMUX_TMPDIR = tmpDir;

const { ensureTokenPassthrough } = require('../lib/tmux');

let hasTmux = true;
try {
  execFileSync('tmux', ['-V']);
} catch {
  hasTmux = false;
}

function tmux(args, env = process.env) {
  return execFileSync('tmux', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function updateEnvironmentList() {
  return tmux(['show-options', '-gv', 'update-environment']).split(/\s+/).filter(Boolean);
}

before(() => {
  if (hasTmux) tmux(['new-session', '-d', '-s', 'base', 'sleep 60']);
});

after(() => {
  if (hasTmux) {
    try { tmux(['kill-server']); } catch { /* server already gone */ }
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('ensureTokenPassthrough adds the token variable to update-environment', { skip: !hasTmux }, async () => {
  await ensureTokenPassthrough();
  assert.ok(updateEnvironmentList().includes('CLAUDE_CODE_OAUTH_TOKEN'));
});

test('ensureTokenPassthrough is idempotent', { skip: !hasTmux }, async () => {
  await ensureTokenPassthrough();
  await ensureTokenPassthrough();
  const count = updateEnvironmentList().filter((v) => v === 'CLAUDE_CODE_OAUTH_TOKEN').length;
  assert.equal(count, 1);
});

test('new sessions receive the token without it reaching the global environment', { skip: !hasTmux }, async () => {
  await ensureTokenPassthrough();
  const token = 'sk-ant-oat01-' + 'z'.repeat(40);
  tmux(['new-session', '-d', '-s', 'withtoken', 'sleep 30'], { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token });
  assert.equal(tmux(['show-environment', '-t', 'withtoken', 'CLAUDE_CODE_OAUTH_TOKEN']).trim(), `CLAUDE_CODE_OAUTH_TOKEN=${token}`);
  assert.throws(() => tmux(['show-environment', '-g', 'CLAUDE_CODE_OAUTH_TOKEN']));
});

test('ensureTokenPassthrough succeeds when no tmux server is running', { skip: !hasTmux }, async () => {
  const saved = process.env.TMUX_TMPDIR;
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfleet-tmux-empty-'));
  process.env.TMUX_TMPDIR = empty;
  try {
    await ensureTokenPassthrough();
  } finally {
    process.env.TMUX_TMPDIR = saved;
    fs.rmSync(empty, { recursive: true, force: true });
  }
});
