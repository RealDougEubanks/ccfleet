# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.9.0] — 2026-05-29

### Added
- **systemd install script** (`scripts/install-systemd.sh`) — Linux support alongside the existing macOS launchd setup
- **Helmet** security headers on all responses: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- **CSRF protection** on all three system control endpoints (`/api/system/reload`, `/api/system/restart`, `/api/system/ttyd/restart`) — rejects requests without `Content-Type: application/json`
- **Global crash handlers** — `unhandledRejection` and `uncaughtException` now emit a structured fatal log before the process exits, rather than exiting silently
- **IP logging** on system control actions (`restart_requested`, `ttyd_restart_requested`)
- **Integration tests** (`test/server.test.js`) for all HTTP routes: health, config, projects, session validation, CSRF protection, cache headers
- **Auth unit tests** (`test/auth.test.js`) covering all `buildAuth()` branches
- **MIT `LICENSE`** file
- **`CHANGELOG.md`** (this file)
- `REMOTE_CONTROL_PREFIX` startup validation — process exits with a clear error if the value contains shell metacharacters
- `REMOTE_CONTROL_PREFIX` defaults to `os.hostname()` instead of the hardcoded string `MacMini`

### Changed
- `--dangerously-skip-permissions` is now **opt-in** via `CLAUDE_SKIP_PERMISSIONS=true` in `.env` — disabled by default
- `CLAUDE_MODEL` and `CLAUDE_EFFORT` are now configurable via `.env` (defaults: `claude-sonnet-4-6`, `medium`)
- `pm2` moved from `dependencies` to `devDependencies` — it is not required to run the server; launchd (macOS) and systemd (Linux) are the production service managers
- `/api/config` route moved before `express.static` middleware — prevents a static file from accidentally shadowing the route
- `probeGitRoot` in `lib/health.js` now uses `fs.access(R_OK)` instead of `fs.stat` — correctly detects permission failures, not just existence
- Claude binary health probe changed from `which claude` to `claude --version` — more reliable across shell configurations
- `listSessions` in `lib/tmux.js` now validates each session name and silently skips any entry that fails the `isValidSessionName` check
- Error handler in `server.js` logs `err.message` and `err.code` only — stack traces dropped from the structured log field to avoid leaking internal paths
- `timeSince` in `public/app.js` returns `'unknown'` for unparseable dates instead of an empty string
- Available projects empty state now shows `'All projects have active sessions.'` when all projects are running, vs `'No projects found in GIT_ROOT.'` when the project list itself is empty
- `createSessionSchema` uses `.strict()` — extra fields in the request body now return 400 instead of being silently stripped

### Fixed
- Hardcoded username and home paths (`dougeubanks`) removed from committed `launchd/*.plist` templates and `scripts/install-launchd.sh`; the install script now generates service files dynamically from the invoking user's account
- Dead code `pendingButtons: new Set()` removed from `public/app.js` state object
- Test isolation: `test/claude.test.js` now pins `REMOTE_CONTROL_PREFIX` and clears `CLAUDE_SKIP_PERMISSIONS`/`CLAUDE_MODEL`/`CLAUDE_EFFORT` before any test runs, so results are not affected by the developer's local `.env`
