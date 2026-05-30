'use strict';

require('dotenv').config();

const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');
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
const { isValidSessionName, isValidProjectName } = require('./lib/sanitize');

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
    },
  },
  // Transport encryption is handled externally (Cloudflare Tunnel / VPN).
  hsts: false,
}));

app.use(pinoHttp({ logger, customLogLevel: (req, res, err) => {
  if (err || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  return 'info';
}}));

app.use(express.json({ limit: '1kb' }));

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
    const knownSessionNames = new Set(projects.map((p) => p.session_name));
    const sessions = allSessions.filter((s) => knownSessionNames.has(s.session_name));
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

// ---- system resources ----

app.get('/api/system/resources', async (_req, res, next) => {
  try {
    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    const cores = os.cpus().length;
    const load1 = os.loadavg()[0];

    const statfs = await fs.statfs(getGitRoot());
    const diskTotal = statfs.blocks * statfs.bsize;
    const diskUsed = (statfs.blocks - statfs.bavail) * statfs.bsize;

    res.json({
      cpu: { pct: Math.min(100, Math.round(load1 / cores * 100)), load: parseFloat(load1.toFixed(2)), cores },
      mem: { pct: Math.round(usedMem / totalMem * 100), used: usedMem, total: totalMem },
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
