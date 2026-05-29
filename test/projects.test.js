'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { listProjects, projectExists } = require('../lib/projects');

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ccfleet-test-'));
  await fs.mkdir(path.join(root, 'real-repo', '.git'), { recursive: true });
  await fs.mkdir(path.join(root, 'no-git-here'));
  await fs.mkdir(path.join(root, 'has.dot'), { recursive: true });
  await fs.mkdir(path.join(root, 'has.dot', '.git'));
  await fs.writeFile(path.join(root, 'a-file'), 'not a project');
  await fs.mkdir(path.join(root, 'weird name'));
  return root;
}

test('listProjects returns only directories that contain .git', async () => {
  const root = await makeFixture();
  try {
    const projects = await listProjects(root);
    const names = projects.map((p) => p.name).sort();
    assert.deepEqual(names, ['has.dot', 'real-repo']);
    assert.equal(projects.find((p) => p.name === 'has.dot').session_name, 'has_dot');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('listProjects throws on unreadable GIT_ROOT', async () => {
  await assert.rejects(() => listProjects('/nonexistent/ccfleet-test'));
});

test('projectExists guards against traversal', async () => {
  const root = await makeFixture();
  try {
    assert.equal(await projectExists(root, 'real-repo'), true);
    assert.equal(await projectExists(root, '../etc'), false);
    assert.equal(await projectExists(root, 'nope'), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
