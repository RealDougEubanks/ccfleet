'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const TRUST_FILE_NAME = '.claude.json';

const REMOTE_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const MODEL_RE = /^[a-zA-Z0-9._-]+$/;
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'highest']);

function encodeProjectPath(projectDir) {
  return projectDir.replace(/\//g, '-');
}

async function hasExistingSession(projectDir) {
  const encoded = encodeProjectPath(projectDir);
  const dir = path.join(os.homedir(), '.claude', 'projects', encoded);
  try {
    const entries = await fs.readdir(dir);
    return entries.some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

function buildRemoteControlName(originProjectName) {
  if (!REMOTE_NAME_RE.test(originProjectName)) {
    throw new Error(`unsafe remote-control name: ${originProjectName}`);
  }
  const prefix = process.env.REMOTE_CONTROL_PREFIX || os.hostname();
  return `${prefix}-${originProjectName}`;
}

function buildClaudeCommand({ remoteControlName, continueExisting }) {
  // Validation defense: command string is executed by a shell inside tmux.
  // Every interpolated value must be a fixed flag or a strictly-validated identifier.
  if (!REMOTE_NAME_RE.test(remoteControlName.replace(/^[^-]+-/, ''))) {
    throw new Error('invalid remote-control name');
  }

  const skipPermissions = process.env.CLAUDE_SKIP_PERMISSIONS === 'true';
  const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
  const effort = process.env.CLAUDE_EFFORT || 'medium';

  if (!MODEL_RE.test(model)) {
    throw new Error(`invalid CLAUDE_MODEL value: ${model}`);
  }
  if (!VALID_EFFORTS.has(effort)) {
    throw new Error(`invalid CLAUDE_EFFORT value: ${effort} (must be low, medium, high, or highest)`);
  }

  const parts = [
    'claude',
    ...(skipPermissions ? ['--dangerously-skip-permissions'] : []),
    ...(continueExisting ? ['--continue'] : []),
    '--model', model,
    '--effort', effort,
    '--remote-control', remoteControlName,
  ];
  return parts.join(' ');
}

async function ensureProjectTrusted(projectDir) {
  const trustFile = path.join(os.homedir(), TRUST_FILE_NAME);

  let config = {};
  try {
    const raw = await fs.readFile(trustFile, 'utf8');
    config = JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Malformed JSON or unreadable file — do not clobber. Caller can fall
      // back to manual approval.
      const wrapped = new Error(`cannot read ${trustFile}: ${err.code || err.message}`);
      wrapped.cause = err;
      throw wrapped;
    }
  }

  if (!config.projects || typeof config.projects !== 'object') {
    config.projects = {};
  }

  const existing = config.projects[projectDir];
  if (existing && existing.hasTrustDialogAccepted === true) {
    return false;
  }

  config.projects[projectDir] = {
    ...(existing || {}),
    hasTrustDialogAccepted: true,
  };

  const tmp = `${trustFile}.ccfleet.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), { mode: 0o600 });
  await fs.rename(tmp, trustFile);
  return true;
}

module.exports = {
  buildClaudeCommand,
  buildRemoteControlName,
  encodeProjectPath,
  ensureProjectTrusted,
  hasExistingSession,
};
