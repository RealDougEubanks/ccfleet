'use strict';

const { execFile } = require('child_process');
const path = require('path');

const EXEC_TIMEOUT_MS = 5000;
// Conservative: only common URL-safe characters expected in repo names.
const REPO_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: EXEC_TIMEOUT_MS, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseOriginProjectName(url) {
  if (typeof url !== 'string') return null;
  let s = url.trim();
  if (!s) return null;

  if (s.endsWith('.git')) s = s.slice(0, -4);
  s = s.replace(/\/+$/, '');

  const match = s.match(/[^/:]+$/);
  if (!match) return null;

  const name = match[0];
  return REPO_NAME_RE.test(name) ? name : null;
}

async function getOriginUrl(projectDir) {
  try {
    const { stdout } = await run('git', ['-C', projectDir, 'remote', 'get-url', 'origin']);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function resolveProjectIdentity(projectDir) {
  const dirName = path.basename(projectDir);
  const originUrl = await getOriginUrl(projectDir);
  const fromOrigin = parseOriginProjectName(originUrl);
  return fromOrigin || dirName;
}

module.exports = {
  getOriginUrl,
  parseOriginProjectName,
  resolveProjectIdentity,
};
