'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  buildClaudeCommand,
  buildRemoteControlName,
  encodeProjectPath,
  ensureProjectTrusted,
  hasExistingSession,
} = require('../lib/claude');

// Pin REMOTE_CONTROL_PREFIX to a known value (read at module load) and clear
// other Claude env vars so tests are not affected by the developer's .env.
process.env.REMOTE_CONTROL_PREFIX = 'TestHost';
['CLAUDE_SKIP_PERMISSIONS', 'CLAUDE_MODEL', 'CLAUDE_EFFORT'].forEach((k) => delete process.env[k]);

async function fakeHome(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccfleet-home-'));
  const real = os.homedir;
  os.homedir = () => dir;
  t.after(async () => {
    os.homedir = real;
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('buildRemoteControlName uses REMOTE_CONTROL_PREFIX', () => {
  assert.equal(buildRemoteControlName('ClaudeMarketplace'), 'TestHost-ClaudeMarketplace');
});

test('buildRemoteControlName rejects unsafe input', () => {
  assert.throws(() => buildRemoteControlName('a;b'));
  assert.throws(() => buildRemoteControlName('a b'));
  assert.throws(() => buildRemoteControlName(''));
});

test('buildClaudeCommand omits --continue for fresh project', () => {
  const prev = process.env.CLAUDE_SKIP_PERMISSIONS;
  try {
    delete process.env.CLAUDE_SKIP_PERMISSIONS;
    const cmd = buildClaudeCommand({
      remoteControlName: 'MacMini-ClaudeMarketplace',
      continueExisting: false,
    });
    assert.equal(cmd.includes('--continue'), false);
    assert.equal(cmd.includes('--dangerously-skip-permissions'), false);
    assert.equal(cmd.includes('--model claude-sonnet-4-6'), true);
    assert.equal(cmd.includes('--effort medium'), true);
    assert.equal(cmd.includes('--remote-control MacMini-ClaudeMarketplace'), true);
  } finally {
    if (prev !== undefined) process.env.CLAUDE_SKIP_PERMISSIONS = prev;
  }
});

test('buildClaudeCommand includes --continue when history exists', () => {
  const cmd = buildClaudeCommand({
    remoteControlName: 'MacMini-x',
    continueExisting: true,
  });
  assert.equal(cmd.includes('--continue'), true);
});

test('buildClaudeCommand includes --dangerously-skip-permissions when CLAUDE_SKIP_PERMISSIONS=true', () => {
  const prev = process.env.CLAUDE_SKIP_PERMISSIONS;
  try {
    process.env.CLAUDE_SKIP_PERMISSIONS = 'true';
    const cmd = buildClaudeCommand({ remoteControlName: 'MacMini-x', continueExisting: false });
    assert.equal(cmd.includes('--dangerously-skip-permissions'), true);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_SKIP_PERMISSIONS;
    else process.env.CLAUDE_SKIP_PERMISSIONS = prev;
  }
});

test('buildClaudeCommand uses CLAUDE_MODEL and CLAUDE_EFFORT from env', () => {
  const prevModel = process.env.CLAUDE_MODEL;
  const prevEffort = process.env.CLAUDE_EFFORT;
  try {
    process.env.CLAUDE_MODEL = 'claude-opus-4-7';
    process.env.CLAUDE_EFFORT = 'high';
    const cmd = buildClaudeCommand({ remoteControlName: 'MacMini-x', continueExisting: false });
    assert.equal(cmd.includes('--model claude-opus-4-7'), true);
    assert.equal(cmd.includes('--effort high'), true);
  } finally {
    if (prevModel === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = prevModel;
    if (prevEffort === undefined) delete process.env.CLAUDE_EFFORT;
    else process.env.CLAUDE_EFFORT = prevEffort;
  }
});

test('buildClaudeCommand throws on invalid CLAUDE_EFFORT', () => {
  const prev = process.env.CLAUDE_EFFORT;
  try {
    process.env.CLAUDE_EFFORT = 'turbo';
    assert.throws(
      () => buildClaudeCommand({ remoteControlName: 'MacMini-x', continueExisting: false }),
      /invalid CLAUDE_EFFORT/,
    );
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_EFFORT;
    else process.env.CLAUDE_EFFORT = prev;
  }
});

test('buildClaudeCommand throws on invalid CLAUDE_MODEL', () => {
  const prev = process.env.CLAUDE_MODEL;
  try {
    process.env.CLAUDE_MODEL = 'bad model name!';
    assert.throws(
      () => buildClaudeCommand({ remoteControlName: 'MacMini-x', continueExisting: false }),
      /invalid CLAUDE_MODEL/,
    );
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_MODEL;
    else process.env.CLAUDE_MODEL = prev;
  }
});

test('encodeProjectPath converts slashes to dashes', () => {
  assert.equal(encodeProjectPath('/a/b/c'), '-a-b-c');
});

test('hasExistingSession is false when project history does not exist', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ccfleet-claude-'));
  try {
    assert.equal(await hasExistingSession(tmp), false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('hasExistingSession is true when a .jsonl exists', async (t) => {
  const home = await fakeHome(t);
  const projectDir = '/tmp/fakeproj';
  const encoded = projectDir.replace(/\//g, '-');
  const histDir = path.join(home, '.claude', 'projects', encoded);
  await fs.mkdir(histDir, { recursive: true });
  await fs.writeFile(path.join(histDir, 'abc.jsonl'), '{}\n');

  assert.equal(await hasExistingSession(projectDir), true);
});

test('ensureProjectTrusted creates ~/.claude.json when missing', async (t) => {
  const home = await fakeHome(t);
  const projectDir = '/tmp/freshproj';

  const granted = await ensureProjectTrusted(projectDir);
  assert.equal(granted, true);

  const config = JSON.parse(await fs.readFile(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(config.projects[projectDir].hasTrustDialogAccepted, true);
});

test('ensureProjectTrusted preserves existing project entries', async (t) => {
  const home = await fakeHome(t);
  const existingProject = '/tmp/already';
  const newProject = '/tmp/freshproj';

  await fs.writeFile(
    path.join(home, '.claude.json'),
    JSON.stringify({
      projects: {
        [existingProject]: {
          hasTrustDialogAccepted: true,
          allowedTools: ['Read'],
          lastCost: 0.42,
        },
      },
    }),
  );

  const granted = await ensureProjectTrusted(newProject);
  assert.equal(granted, true);

  const config = JSON.parse(await fs.readFile(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(config.projects[existingProject].allowedTools[0], 'Read');
  assert.equal(config.projects[existingProject].lastCost, 0.42);
  assert.equal(config.projects[newProject].hasTrustDialogAccepted, true);
});

test('ensureProjectTrusted returns false when already trusted', async (t) => {
  const home = await fakeHome(t);
  const projectDir = '/tmp/already';

  await fs.writeFile(
    path.join(home, '.claude.json'),
    JSON.stringify({
      projects: {
        [projectDir]: { hasTrustDialogAccepted: true, lastCost: 0.42 },
      },
    }),
  );

  const granted = await ensureProjectTrusted(projectDir);
  assert.equal(granted, false);

  const config = JSON.parse(await fs.readFile(path.join(home, '.claude.json'), 'utf8'));
  assert.equal(config.projects[projectDir].lastCost, 0.42);
});

test('ensureProjectTrusted throws on malformed JSON instead of clobbering', async (t) => {
  const home = await fakeHome(t);
  await fs.writeFile(path.join(home, '.claude.json'), '{ not valid json');

  await assert.rejects(() => ensureProjectTrusted('/tmp/x'));
});
