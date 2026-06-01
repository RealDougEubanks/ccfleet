'use strict';

require('dotenv').config();

const { execFile } = require('child_process');
const { promisify } = require('util');
const { randomBytes } = require('crypto');
const fs = require('fs/promises');
const os = require('os');

const execFileAsync = promisify(execFile);
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { z } = require('zod');

const logger = require('./lib/logger');
const { buildAuth } = require('./lib/auth');
const { listProjects, projectExists } = require('./lib/projects');
const tmux = require('./lib/tmux');
const health = require('./lib/health');
const { isValidSessionName, isValidProjectName, toSessionName } = require('./lib/sanitize');

const PORT = Number(process.env.PORT || 3001);
const REMOTE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function getGitRoot() { return process.env.GIT_ROOT; }

// ---- startup validation ----

if (!getGitRoot()) {
  logger.error('GIT_ROOT must be set');
  process.exit(1);
}

const configuredPrefix = process.env.REMOTE_CONTROL_PREFIX;
if (configuredPrefix !== undefined && !REMOTE_NAME_RE.test(configuredPrefix)) {
  logger.error({ REMOTE_CONTROL_PREFIX: configuredPrefix }, 'REMOTE_CONTROL_PREFIX contains unsafe characters — must match [a-zA-Z0-9._-]+');
  process.exit(1);
}

// ---- global crash handlers ----

process.on('unhandledRejection', (reason) => {
  logger.fatal({ event: 'unhandled_rejection', reason: String(reason) }, 'unhandled promise rejection — exiting');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ event: 'uncaught_exception', err: err.message, stack: err.stack }, 'uncaught exception — exiting');
  process.exit(1);
});

// ---- mutable config — updated by POST /api/system/reload ----

const RELOADABLE_KEYS = ['GIT_ROOT', 'TTYD_URL', 'REMOTE_CONTROL_URL', 'LOG_LEVEL'];

function reloadConfig() {
  require('dotenv').config({ override: true });
  logger.level = process.env.LOG_LEVEL || 'info';
  const updated = RELOADABLE_KEYS.filter((k) => process.env[k] !== undefined);
  logger.info({ event: 'config_reload', updated }, 'config reloaded');
  return updated;
}

// ---- express setup ----

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      // Transport encryption is handled externally (Cloudflare Tunnel / VPN).
      // Disable upgrade-insecure-requests so the browser doesn't silently
      // rewrite sub-resource requests to HTTPS on plain-HTTP deployments.
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
}));

app.use(pinoHttp({ logger, customLogLevel: (req, res, err) => {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}}));

// 64kb accommodates .env files; all routes enforce tighter limits via Zod schemas.
app.use(express.json({ limit: '64kb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// ---- health: unauthenticated, before rate limit ----

app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok' });
});

app.get('/readyz', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await tmux.tmuxAvailable();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'fail', reason: 'tmux unavailable' });
  }
});

app.get('/health', async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  const checks = await health.runChecks(getGitRoot());
  const status = health.overallStatus(checks);
  res.status(status === 'fail' ? 503 : 200).json({
    status,
    checks,
    checked_at: new Date().toISOString(),
  });
});

// ---- rate limit + optional auth ----

app.use(apiLimiter);

const authMiddleware = buildAuth();
if (authMiddleware) {
  app.use(authMiddleware);
  logger.info({ event: 'auth_mode', mode: 'basic' }, 'basic auth enabled');
} else {
  logger.info({ event: 'auth_mode', mode: 'none' }, 'basic auth not configured — access control delegated to network layer');
}

app.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

// ---- CSRF guard for mutating system endpoints ----
// Requires Content-Type: application/json so that cross-origin form POSTs
// (which arrive as application/x-www-form-urlencoded) are rejected at the
// middleware layer before any handler runs.

function requireJson(req, res, next) {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
}

// ---- schemas ----

const createSessionSchema = z.object({
  project_name: z.string().min(1).max(64),
}).strict();

const updateEnvSchema = z.object({
  content: z.string().max(65536),
}).strict();

// ---- API routes ----

app.get('/api/config', (_req, res) => {
  res.json({
    remote_control_url: process.env.REMOTE_CONTROL_URL || 'https://claude.ai/code',
    ttyd_url: process.env.TTYD_URL || '',
  });
});

app.get('/api/projects', async (_req, res, next) => {
  try {
    const projects = await listProjects(getGitRoot());
    res.json({ projects });
  } catch (err) {
    next(err);
  }
});

app.get('/api/sessions', async (_req, res, next) => {
  try {
    const [allSessions, projects] = await Promise.all([
      tmux.listSessions(),
      listProjects(getGitRoot()),
    ]);
    // Index by session_name so we can restore the real directory name.
    // listSessions() sets project_name = session_name (dots replaced with
    // underscores), which breaks .env lookups for directories like
    // PropagateHosting.com whose session name is PropagateHosting_com.
    const projectBySession = new Map(projects.map((p) => [p.session_name, p]));
    const sessions = allSessions
      .filter((s) => projectBySession.has(s.session_name))
      .map((s) => ({ ...s, project_name: projectBySession.get(s.session_name).name }));
    res.json({ sessions });
  } catch (err) {
    next(err);
  }
});

app.post('/api/sessions', async (req, res, next) => {
  try {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request body' });
    }
    const { project_name: projectName } = parsed.data;

    if (!isValidProjectName(projectName)) {
      return res.status(400).json({ error: 'invalid project name' });
    }
    if (!(await projectExists(getGitRoot(), projectName))) {
      return res.status(404).json({ error: 'project not found' });
    }

    try {
      const result = await tmux.createSession(getGitRoot(), projectName);
      const session = await tmux.getSession(result.sessionName);
      logger.info({
        event: 'session_created',
        session_name: result.sessionName,
        remote_control_name: result.remoteControlName,
        continued: result.continueExisting,
        trust_granted: result.trustGranted,
      }, 'session created');
      return res.status(201).json(session);
    } catch (err) {
      if (err.code === 'SESSION_EXISTS') {
        return res.status(409).json({ error: 'session already exists' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.delete('/api/sessions/:session_name', async (req, res, next) => {
  try {
    const { session_name: sessionName } = req.params;
    if (!isValidSessionName(sessionName)) {
      return res.status(400).json({ error: 'invalid session name' });
    }
    try {
      await tmux.killSession(sessionName);
      logger.info({ event: 'session_killed', session_name: sessionName }, 'session killed');
      return res.status(204).end();
    } catch (err) {
      if (err.code === 'SESSION_NOT_FOUND') {
        return res.status(404).json({ error: 'session not found' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.get('/api/status/:session_name', async (req, res, next) => {
  try {
    const { session_name: sessionName } = req.params;
    if (!isValidSessionName(sessionName)) {
      return res.status(400).json({ error: 'invalid session name' });
    }
    const session = await tmux.getSession(sessionName);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json({
      session_name: session.session_name,
      current_command: session.current_command,
      status: session.status,
    });
  } catch (err) {
    next(err);
  }
});

// ---- project .env editor ----

const GITIGNORE_MAX_BYTES = 1024 * 1024; // 1 MB — a larger .gitignore is almost certainly not a real one

async function ensureEnvIgnored(gitignorePath) {
  let existing = '';
  try {
    const stat = await fs.stat(gitignorePath);
    if (stat.size > GITIGNORE_MAX_BYTES) return; // too large to be a real .gitignore; skip safely
    existing = await fs.readFile(gitignorePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  // Check whether any line already covers .env (exact, prefixed, or glob).
  const lines = existing.split('\n');
  const alreadyCovered = lines.some((l) => /^(\*\.env|\/?.env)$/.test(l.trim()));
  if (alreadyCovered) return;
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.appendFile(gitignorePath, `${separator}.env\n`);
}

app.get('/api/projects/:project_name/env', async (req, res, next) => {
  try {
    const { project_name: projectName } = req.params;
    if (!isValidProjectName(projectName)) {
      return res.status(400).json({ error: 'invalid project name' });
    }
    if (!(await projectExists(getGitRoot(), projectName))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const envPath = path.join(getGitRoot(), projectName, '.env');
    try {
      const stat = await fs.stat(envPath);
      if (stat.size > 65536) {
        return res.status(422).json({ error: '.env file exceeds maximum size' });
      }
      const content = await fs.readFile(envPath, 'utf8');
      return res.json({ content, exists: true });
    } catch (err) {
      if (err.code === 'ENOENT') return res.json({ content: '', exists: false });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

app.put('/api/projects/:project_name/env', requireJson, async (req, res, next) => {
  try {
    const { project_name: projectName } = req.params;
    if (!isValidProjectName(projectName)) {
      return res.status(400).json({ error: 'invalid project name' });
    }
    if (!(await projectExists(getGitRoot(), projectName))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const parsed = updateEnvSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid request body' });
    }
    // Normalize line endings and strip null bytes.
    const content = parsed.data.content
      .replace(/\x00/g, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const projectDir = path.join(getGitRoot(), projectName);
    const envPath = path.join(projectDir, '.env');
    const tmp = `${envPath}.ccfleet.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(tmp, content, { mode: 0o600 });
      await fs.rename(tmp, envPath);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }

    // Ensure .env is in the project's .gitignore so it isn't accidentally committed.
    await ensureEnvIgnored(path.join(projectDir, '.gitignore'));

    logger.info({ event: 'env_updated', project: projectName }, '.env updated');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/projects/:project_name/sessions/reload', requireJson, async (req, res, next) => {
  try {
    const { project_name: projectName } = req.params;
    if (!isValidProjectName(projectName)) {
      return res.status(400).json({ error: 'invalid project name' });
    }
    if (!(await projectExists(getGitRoot(), projectName))) {
      return res.status(404).json({ error: 'project not found' });
    }
    const sessionName = toSessionName(projectName);
    await tmux.reloadSession(sessionName, getGitRoot(), projectName);
    logger.info({ event: 'session_reloaded', project: projectName }, 'session reloaded to apply updated env');
    res.json({ ok: true });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') return res.status(404).json({ error: 'no active session for this project' });
    next(err);
  }
});

// ---- system resources ----

// On macOS, os.freemem() counts compressed pages at their pre-compression size,
// producing "used" figures that exceed physical RAM. vm_stat gives the real picture:
// wired (pinned kernel pages) + active (in-use app pages) + compressed (compressed
// in place by the compressor) is what is genuinely consuming physical RAM.
// Color coding uses the kernel's own pressure signal (0=normal, 1=warning, 2=critical)
// rather than a raw percentage, because macOS manages memory aggressively and a high
// percentage is normal — swap activity and kernel pressure are the real danger signs.
async function getMemStats() {
  const total = os.totalmem();

  if (process.platform === 'darwin') {
    try {
      const [{ stdout: vmOut }, { stdout: pressureOut }] = await Promise.all([
        execFileAsync('/usr/bin/vm_stat'),
        execFileAsync('/usr/sbin/sysctl', ['-n', 'vm.memory_pressure']),
      ]);
      const pageSize = parseInt(vmOut.match(/page size of (\d+)/)?.[1] || '16384', 10);
      const pages = (label) => {
        const m = vmOut.match(new RegExp(`${label}:\\s+(\\d+)`));
        return m ? parseInt(m[1], 10) * pageSize : 0;
      };
      const used = pages('Pages wired down') + pages('Pages active') + pages('Pages occupied by compressor');
      const pressure = parseInt(pressureOut.trim(), 10); // 0=normal 1=warning 2=critical
      return { used, total, pct: Math.round(used / total * 100), pressure };
    } catch {
      // fall through
    }
  }

  if (process.platform === 'linux') {
    try {
      // MemAvailable (not MemFree) includes reclaimable page cache — the accurate
      // "how much memory can a new process actually use" number on Linux.
      const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
      const available = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0', 10) * 1024;
      const used = total - available;
      return { used, total, pct: Math.round(used / total * 100), pressure: null };
    } catch {
      // fall through
    }
  }

  // Windows and fallback: os.freemem() is accurate here.
  const used = total - os.freemem();
  return { used, total, pct: Math.round(used / total * 100), pressure: null };
}

app.get('/api/system/resources', async (_req, res, next) => {
  try {
    const cores = os.cpus().length;
    const load1 = os.loadavg()[0];

    const statfs = await fs.statfs(getGitRoot());
    const diskTotal = statfs.blocks * statfs.bsize;
    const diskUsed = (statfs.blocks - statfs.bavail) * statfs.bsize;

    const mem = await getMemStats();

    res.json({
      cpu: { pct: Math.min(100, Math.round(load1 / cores * 100)), load: parseFloat(load1.toFixed(2)), cores },
      mem,
      disk: { pct: Math.round(diskUsed / diskTotal * 100), used: diskUsed, total: diskTotal },
    });
  } catch (err) {
    next(err);
  }
});

// ---- system control ----

app.post('/api/system/reload', requireJson, (_req, res) => {
  const updated = reloadConfig();
  res.json({ reloaded: updated });
});

app.post('/api/system/restart', requireJson, (req, res) => {
  logger.info({ event: 'restart_requested', ip: req.ip }, 'ccfleet restart requested via API');
  res.status(202).json({ message: 'restarting' });
  setTimeout(() => process.exit(0), 400);
});

app.post('/api/system/ttyd/restart', requireJson, (req, res, next) => {
  execFile('pkill', ['-x', 'ttyd'], (err) => {
    if (err && err.code !== 1) return next(err);
    logger.info({ event: 'ttyd_restart_requested', ip: req.ip }, 'ttyd restart requested via API');
    res.status(202).json({ message: 'ttyd restarting' });
  });
});

// ---- static frontend (after all API routes) ----

app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-cache');
    },
  }),
);

// ---- error handler ----

app.use((err, req, res, _next) => {
  logger.error({ event: 'request_error', err: err.message, code: err.code }, 'request failed');
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    logger.info({ event: 'startup', port: PORT, git_root: getGitRoot() }, 'ccfleet listening');
  });
}

module.exports = app;
