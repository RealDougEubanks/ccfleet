'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { isValidSessionName, isValidProjectName, toSessionName } = require('./sanitize');
const { resolveProjectIdentity } = require('./git');
const {
  buildClaudeCommand,
  buildRemoteControlName,
  ensureProjectTrusted,
  hasExistingSession,
} = require('./claude');

const EXEC_TIMEOUT_MS = 5000;
const SHELL_COMMANDS = new Set(['zsh', 'bash', 'fish', 'sh', '-zsh', '-bash']);
const ACTIVE_COMMANDS = new Set(['claude', 'node']);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function classify(currentCommand) {
  if (!currentCommand) return 'unknown';
  if (ACTIVE_COMMANDS.has(currentCommand)) return 'active';
  if (SHELL_COMMANDS.has(currentCommand)) return 'idle';
  return 'unknown';
}

async function listSessions() {
  let stdout;
  try {
    const res = await run('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}|#{session_created}|#{pane_current_command}',
    ]);
    stdout = res.stdout;
  } catch (err) {
    // tmux exits non-zero with "no server running" when no sessions exist.
    const msg = (err.stderr || err.message || '').toLowerCase();
    if (msg.includes('no server running') || msg.includes('no sessions')) {
      return [];
    }
    throw err;
  }

  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const sessions = [];
  for (const line of lines) {
    const [sessionName, createdUnix, currentCommand] = line.split('|');
    if (!isValidSessionName(sessionName)) continue;
    const startedAt = new Date(Number(createdUnix) * 1000).toISOString();
    sessions.push({
      session_name: sessionName,
      project_name: sessionName,
      started_at: startedAt,
      current_command: currentCommand || '',
      status: classify(currentCommand),
    });
  }
  return sessions;
}

async function getSession(sessionName) {
  if (!isValidSessionName(sessionName)) return null;
  const sessions = await listSessions();
  return sessions.find((s) => s.session_name === sessionName) || null;
}

async function sessionExists(sessionName) {
  if (!isValidSessionName(sessionName)) return false;
  try {
    await run('tmux', ['has-session', '-t', `=${sessionName}`]);
    return true;
  } catch {
    return false;
  }
}

async function createSession(gitRoot, projectName) {
  if (!isValidProjectName(projectName)) {
    const err = new Error('invalid project name');
    err.code = 'INVALID_PROJECT';
    throw err;
  }
  const sessionName = toSessionName(projectName);
  const cwd = path.join(gitRoot, projectName);

  if (await sessionExists(sessionName)) {
    const err = new Error(`session ${sessionName} already exists`);
    err.code = 'SESSION_EXISTS';
    throw err;
  }

  const originProjectName = await resolveProjectIdentity(cwd);
  const remoteControlName = buildRemoteControlName(originProjectName);
  const continueExisting = await hasExistingSession(cwd);
  const trustGranted = await ensureProjectTrusted(cwd);
  const claudeCmd = buildClaudeCommand({ remoteControlName, continueExisting });

  await run('tmux', [
    'new-session',
    '-d',
    '-s',
    sessionName,
    '-c',
    cwd,
    claudeCmd,
  ]);
  return { sessionName, remoteControlName, continueExisting, trustGranted };
}

async function killSession(sessionName) {
  if (!isValidSessionName(sessionName)) {
    const err = new Error('invalid session name');
    err.code = 'INVALID_SESSION';
    throw err;
  }
  if (!(await sessionExists(sessionName))) {
    const err = new Error(`session ${sessionName} not found`);
    err.code = 'SESSION_NOT_FOUND';
    throw err;
  }
  await run('tmux', ['kill-session', '-t', `=${sessionName}`]);
}

async function tmuxAvailable() {
  await run('tmux', ['-V']);
}

module.exports = {
  classify,
  createSession,
  getSession,
  killSession,
  listSessions,
  sessionExists,
  tmuxAvailable,
};
