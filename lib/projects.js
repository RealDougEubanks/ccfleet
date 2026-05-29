'use strict';

const fs = require('fs/promises');
const path = require('path');
const { isValidProjectName, toSessionName } = require('./sanitize');

async function listProjects(gitRoot) {
  let entries;
  try {
    entries = await fs.readdir(gitRoot, { withFileTypes: true });
  } catch (err) {
    const wrapped = new Error(`cannot read GIT_ROOT (${gitRoot}): ${err.code || err.message}`);
    wrapped.cause = err;
    throw wrapped;
  }

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidProjectName(entry.name)) continue;

    const gitPath = path.join(gitRoot, entry.name, '.git');
    let hasGit = false;
    try {
      await fs.access(gitPath);
      hasGit = true;
    } catch {
      hasGit = false;
    }
    if (!hasGit) continue;

    projects.push({
      name: entry.name,
      session_name: toSessionName(entry.name),
      has_git: true,
    });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

async function projectExists(gitRoot, projectName) {
  if (!isValidProjectName(projectName)) return false;
  const target = path.join(gitRoot, projectName);
  try {
    const stat = await fs.stat(target);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

module.exports = { listProjects, projectExists };
