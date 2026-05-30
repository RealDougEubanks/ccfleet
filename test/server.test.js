'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const fsSync = require('fs');
const os = require('os');
const path = require('path');

// Must be set synchronously before server.js is required — it reads these at
// module-load time.
const tmpGitRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ccfleet-srv-'));
process.env.GIT_ROOT = tmpGitRoot;
process.env.REMOTE_CONTROL_PREFIX = 'TestHost';
delete process.env.BASIC_AUTH_USER;
delete process.env.BASIC_AUTH_PASS;

const app = require('../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await fs.rm(tmpGitRoot, { recursive: true, force: true });
});

function get(url, headers = {}) {
  return fetch(`${base}${url}`, { headers });
}

function post(url, body, extraHeaders = {}) {
  return fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function del(url) {
  return fetch(`${base}${url}`, { method: 'DELETE' });
}

// ---- health endpoints -------------------------------------------------------

test('GET /healthz returns 200 ok', async () => {
  const res = await get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('GET /health returns status and checks', async () => {
  const res = await get('/health');
  const body = await res.json();
  assert.ok(['ok', 'degraded', 'fail'].includes(body.status), `unexpected status: ${body.status}`);
  assert.ok(typeof body.checks === 'object');
  assert.ok(typeof body.checked_at === 'string');
});

test('GET /readyz returns 200 or 503', async () => {
  const res = await get('/readyz');
  assert.ok([200, 503].includes(res.status));
});

// ---- security headers -------------------------------------------------------

test('responses include X-Content-Type-Options nosniff', async () => {
  const res = await get('/healthz');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('responses include X-Frame-Options', async () => {
  const res = await get('/healthz');
  assert.ok(res.headers.get('x-frame-options'), 'x-frame-options header missing');
});

test('responses include Content-Security-Policy', async () => {
  const res = await get('/healthz');
  assert.ok(res.headers.get('content-security-policy'), 'csp header missing');
});

// ---- config -----------------------------------------------------------------

test('GET /api/config returns remote_control_url and ttyd_url', async () => {
  const res = await get('/api/config');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.remote_control_url === 'string');
  assert.ok(typeof body.ttyd_url === 'string');
});

// ---- projects ---------------------------------------------------------------

test('GET /api/projects returns empty array for empty GIT_ROOT', async () => {
  const res = await get('/api/projects');
  assert.equal(res.status, 200);
  const { projects } = await res.json();
  assert.deepEqual(projects, []);
});

test('GET /api/projects returns entry when git dir exists', async () => {
  const projectDir = path.join(tmpGitRoot, 'test-repo');
  await fs.mkdir(path.join(projectDir, '.git'), { recursive: true });
  try {
    const res = await get('/api/projects');
    assert.equal(res.status, 200);
    const { projects } = await res.json();
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'test-repo');
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true });
  }
});

// ---- sessions (validation only — no tmux required) --------------------------

test('POST /api/sessions with no body returns 400', async () => {
  const res = await fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
});

test('POST /api/sessions with empty project_name returns 400', async () => {
  const res = await post('/api/sessions', { project_name: '' });
  assert.equal(res.status, 400);
});

test('POST /api/sessions with oversized project_name returns 400', async () => {
  const res = await post('/api/sessions', { project_name: 'x'.repeat(65) });
  assert.equal(res.status, 400);
});

test('POST /api/sessions with path-traversal name returns 400', async () => {
  const res = await post('/api/sessions', { project_name: '../etc/passwd' });
  assert.equal(res.status, 400);
});

test('POST /api/sessions with extra fields returns 400 (strict schema)', async () => {
  const res = await post('/api/sessions', { project_name: 'valid', extra_field: 'bad' });
  assert.equal(res.status, 400);
});

test('POST /api/sessions for nonexistent project returns 404', async () => {
  const res = await post('/api/sessions', { project_name: 'no-such-project' });
  assert.equal(res.status, 404);
});

test('DELETE /api/sessions with dotted name returns 400', async () => {
  const res = await del('/api/sessions/bad.name');
  assert.equal(res.status, 400);
});

test('DELETE /api/sessions with valid name for nonexistent session returns 404', async () => {
  const res = await del('/api/sessions/not-running');
  assert.equal(res.status, 404);
});

test('GET /api/status with dotted name returns 400', async () => {
  const res = await get('/api/status/bad.name');
  assert.equal(res.status, 400);
});

// ---- CSRF protection --------------------------------------------------------

test('POST /api/system/reload without JSON content-type returns 415', async () => {
  const res = await fetch(`${base}/api/system/reload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'action=reload',
  });
  assert.equal(res.status, 415);
});

test('POST /api/system/ttyd/restart without JSON content-type returns 415', async () => {
  const res = await fetch(`${base}/api/system/ttyd/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '',
  });
  assert.equal(res.status, 415);
});

test('POST /api/system/reload with JSON content-type succeeds', async () => {
  const res = await post('/api/system/reload', {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.reloaded));
});

// ---- cache-control ----------------------------------------------------------

test('API responses set Cache-Control: private, no-store', async () => {
  const res = await get('/api/projects');
  const cc = res.headers.get('cache-control');
  assert.ok(cc && cc.includes('no-store'), `expected no-store, got: ${cc}`);
});

// ---- system resources -------------------------------------------------------

test('GET /api/system/resources returns cpu, mem, disk with pct fields', async () => {
  const res = await get('/api/system/resources');
  assert.equal(res.status, 200);
  const body = await res.json();
  for (const key of ['cpu', 'mem', 'disk']) {
    assert.ok(typeof body[key] === 'object', `missing ${key}`);
    assert.ok(typeof body[key].pct === 'number', `${key}.pct not a number`);
    assert.ok(body[key].pct >= 0 && body[key].pct <= 100, `${key}.pct out of range: ${body[key].pct}`);
  }
  assert.ok(typeof body.cpu.cores === 'number' && body.cpu.cores > 0);
  assert.ok(typeof body.mem.total === 'number' && body.mem.total > 0);
  assert.ok(typeof body.disk.total === 'number' && body.disk.total > 0);
});
