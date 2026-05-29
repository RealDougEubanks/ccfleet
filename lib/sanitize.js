'use strict';

const MAX_NAME_LENGTH = 64;
const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;
const SESSION_NAME_RE = /^[a-zA-Z0-9_-]+$/;

function isValidProjectName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    PROJECT_NAME_RE.test(name)
  );
}

function isValidSessionName(name) {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH &&
    SESSION_NAME_RE.test(name)
  );
}

function toSessionName(projectName) {
  if (!isValidProjectName(projectName)) {
    throw new Error('invalid project name');
  }
  return projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
}

module.exports = {
  MAX_NAME_LENGTH,
  isValidProjectName,
  isValidSessionName,
  toSessionName,
};
