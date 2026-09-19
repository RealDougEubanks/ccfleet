# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.9.6] — 2026-09-19

### Fixed
- **`spawn tmux ENOENT` on every `/api/sessions` request under Docker** — the runtime image had no tmux client. The server shells out to the tmux *client* to list and manage sessions; the tmux *server* runs on the host and is reachable via socket bind-mount. Added `apk add --no-cache tmux` to the runtime stage. (`Dockerfile`)
- **Docker healthcheck reported `healthy` while all requests 500'd** — both the `Dockerfile` `HEALTHCHECK` and `docker-compose.yml` probed `/healthz`, which only confirms the process is alive. Changed both to probe `/readyz`, which also verifies that tmux and `GIT_ROOT` are reachable before reporting ready. (`Dockerfile`, `docker-compose.yml`)
- **Fresh clone crash-looped on `Cannot find module 'dotenv'` after `install-launchd.sh`** — the script started the service without first installing Node dependencies, so every boot attempt failed with `MODULE_NOT_FOUND` until `npm ci` was run by hand. The script now detects a missing `node_modules` directory and runs `npm ci --omit=dev` as the target user before installing the LaunchDaemon. (`scripts/install-launchd.sh`)
- **Three moderate npm vulnerabilities** — `qs` 6.15.2 → 6.16.0 (array-limit bypass and DoS via attacker-controlled `isBuffer`), `express` 4.22.2 → 4.22.3, `body-parser` 1.20.6 → 1.20.8, `side-channel` 1.1.0 → 1.1.1. (`package-lock.json`)

### Documentation
- **README clarifies that Docker requires a Linux host** — on macOS the container runs inside a VM that cannot reach the host tmux server or `claude` binary. macOS users should use the Node direct or launchd paths. (`README.md`)

## [0.9.5] — 2026-08-11

### Fixed
- **`.env` editor silently discarded every save under Docker** — `docker-compose.yml` mounted `GIT_ROOT` with `read_only: true`, but the editor (`PUT /api/projects/:name/env`) writes into each project directory and appends `.env` to its `.gitignore`. Every save failed with `EROFS`, hit the generic 500 handler, and lost the edit with nothing to indicate the container mount was the cause. The mount is now writable, with a comment recording why it has to be. (`docker-compose.yml`)
- **Docker image no longer built** — `npm install -g npm@latest` was unpinned, so the build broke on its own the day npm 12 shipped: npm 12 requires Node >= 22 and refuses to install on `node:20-alpine`. Nothing in the repo had changed. The base image moves to `node:22-alpine` (Node 20 reached end of life in April 2026) and the global npm upgrade is dropped rather than re-pinned. CI and the security workflow move to Node 22 to match. (`Dockerfile`, `.github/workflows/`)
- **Six CVEs (1 critical, 5 high) in the runtime image** — all of them inside npm's own bundled dependencies under `/usr/local/lib/node_modules/npm`, not in ccfleet's dependency tree. The runtime stage only runs `node server.js` and dependencies are copied in from the deps stage, so `npm` and `npx` are deleted from the final image. This removes the whole class of finding, shrinks the image, and leaves a compromised container with no package manager. (`Dockerfile`)
- **`brace-expansion` and `body-parser` advisories** — `brace-expansion` 5.0.6 → 5.0.9 (three DoS advisories; dev-only, arrives through eslint) and `body-parser` 1.20.5 → 1.20.6 (size enforcement silently disabled on an invalid limit value; ships in the production image). Lockfile only. Supersedes dependabot PR #8, which covered neither fully. (`package-lock.json`)
- **Missing timeout on the ttyd `pkill` shell-out** — every other `execFile` call sets one; this one could hang indefinitely. Now bounded at 5s. (`server.js`)

### Changed
- **Frontend builds DOM nodes instead of interpolating into `innerHTML`** — `renderSessionCard` and `renderProjectRow` now use `createElement`/`textContent`. The previous escaping was correct, but it depended on `escapeHtml` being applied at every interpolation point with nothing to catch an omission, and `current_command` reaches the browser straight from tmux. `escapeHtml` is removed so it cannot be partially reapplied alongside the new pattern. (`public/app.js`)
- **CI runs on pull requests instead of every branch push** — the five-job matrix previously ran twice per branch push and a third time on main after merge, with test, lint, and audit each doing their own checkout and `npm ci` for about three seconds of work. Those collapse into one `verify` job sharing a single `npm ci`; concurrency cancels superseded PR runs; the Docker job always reports but only builds when an image input changed, and now smoke-tests `/healthz` rather than only proving the build succeeded. CVE scanning moves to a weekly schedule plus any PR touching dependencies or the Dockerfile — scanning per-commit turned unrelated PRs red the morning a base-image CVE dropped, and scanned nothing during a quiet week. (`.github/workflows/`)
- **`SECURITY.md` states that authentication is out of scope** — access control is the operator's responsibility via Cloudflare Access, nginx, or equivalent. An unproxied ccfleet reachable from an untrusted network is fully compromised: every API route, including the `.env` editor and the process-restart endpoint, is available to anyone who can open a TCP connection to it. Findings that amount to "ccfleet should authenticate users" are working as designed; findings about how ccfleet behaves *behind* a proxy remain in scope.

### Added
- **Git hooks** (`.githooks/`, installed with `scripts/install-hooks.sh` via `core.hooksPath` so they stay version-controlled). `pre-commit` checks staged secrets and `.env` files, conflict markers, files over 1MB, `console.log` in production paths, `TODO` comments, `.only()` in tests, `package.json`/lockfile drift, shellcheck, ESLint on staged files, and the full test suite. `pre-push` blocks direct pushes to `main` and runs lint and tests. Plain bash, no new dependencies, portable to the bash 3.2 that stock macOS ships. Hooks are fast feedback, not enforcement — `--no-verify` bypasses them, so the PR run stays authoritative. Documented in `README.md`.
- **Tests pinning the tmux command-injection boundary** — tmux joins the argv returned by `buildClaudeCommand` into one string and runs it through `$SHELL -c`, which makes the `[a-zA-Z0-9._-]` allow-list the only thing preventing injection. Fifteen metacharacter payloads are now asserted against remote-control names, `CLAUDE_MODEL`, and `REMOTE_CONTROL_PREFIX`, plus an assertion that every emitted token is safe to join. Relaxing that regex now fails the suite. Suite grows from 82 to 86 tests. (`test/claude.test.js`)

## [0.9.4] — 2026-06-15

### Fixed
- **Session history did not resume for projects with dots in their directory name** — `encodeProjectPath` translated only `/` to `-`, but the Claude CLI also translates `.` to `-` when bucketing project history under `~/.claude/projects/`. Projects such as `PropagateHosting.com` never matched their on-disk history directory, so `hasExistingSession` always returned `false`, `--continue` was never passed, and every session launched fresh. Pins in the Claude desktop app pointed at orphaned conversations, producing the "spins when prompted" symptom. Encoding now mirrors the CLI: both `/` and `.` map to `-`. (`lib/claude.js`, `test/claude.test.js`)
- **Dockerfile pulls patched alpine packages at build time** — `apk -U upgrade --no-cache` runs in both build stages so CVE-2026-45447 (openssl heap use-after-free in `PKCS7_verify`) is patched on top of the `node:20-alpine` base, which still ships `libcrypto3`/`libssl3` 3.5.6-r0. (`Dockerfile`)

## [0.9.3] — 2026-06-01

### Added
- **.env editor** — read, edit, and save `.env` files for each project directory directly from the dashboard. Save-and-reload restarts the active session in place via `tmux respawn-pane -k` so new variables take effect without losing the tmux session. (`server.js`, `lib/projects.js`, `public/app.js`, `public/index.html`)
- **Docker support** — multi-stage `Dockerfile`, `docker-compose.yml`, and `.dockerignore`. Container reuses the built-in `node:20-alpine` `node` user (UID 1000) so it matches the host's tmux socket owner. `TMUX_TMPDIR=/tmp/tmux-1000` and `TRUST_PROXY=172.16.0.0/12` are documented for container deployments.
- **CI pipeline** — GitHub Actions workflow runs tests, ESLint, `npm audit`, Trivy container scan, and a Docker build on every push/PR. All third-party actions pinned to commit SHAs.
- **ESLint** — flat config with `@eslint/js` recommended rules and project-specific overrides. `npm run lint` enforces style locally and in CI.

### Fixed
- **HIGH — `javascript:` URI injection via `window.open`** — `REMOTE_CONTROL_URL` and `TTYD_URL` are now validated against `^https?://` at the API boundary and again in the frontend before every `window.open` call. (`server.js`, `public/app.js`)
- **MODERATE — ttyd credential leak in process environment** — `bin/start-ttyd.sh` now unsets `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` before `exec`, so they are not visible in the ttyd process environment.
- **MODERATE — `trust proxy` misconfigured under Docker** — `TRUST_PROXY` env var (default: `loopback`) controls Express's trust setting so `req.ip` and rate limiting work correctly behind a reverse proxy. Documented Docker (`172.16.0.0/12`) and reverse-proxy examples.
- **MODERATE — Docker UID/TMUX_TMPDIR mismatch** — image pins to the existing `node` user (UID 1000) and `TMUX_TMPDIR` is set so the host's tmux socket bind-mount works.
- **.env editor hardening** — temp file written with `mode: 0o600` and a random suffix, then atomically renamed over the target; null bytes stripped; 64KB size cap; filename validated against an allow-list to prevent path traversal.
- **`.env` button for projects with dots in their name** — frontend now URL-encodes the project name segment so `PropagateHosting.com` no longer breaks the route.
- **`listSessions` handles tmux socket missing in CI** — returns `[]` instead of throwing when tmux is not installed or no server is running.
- **Restart confirmation dialog warns about service-manager dependency** — clarifies that ccfleet only comes back automatically if launchd or systemd is supervising it.

### Changed
- **`SECURITY.md`** documents the Docker tmux socket bind-mount risk and mitigations.
- **`server.js`** elevates the "basic auth disabled" startup message from `info` to `warn` so it surfaces in monitoring dashboards.

## [0.9.2] — 2026-05-30

### Fixed
- **Accurate memory stats on macOS** — `os.freemem()` overcounts by reporting compressed pages at pre-compression size, producing figures like "15GB used" on an 8GB machine. Now uses `vm_stat` (wired + active + compressor pages) for the real physical footprint. Color coding uses `sysctl vm.memory_pressure` (0=normal, 1=warning, 2=critical) rather than a raw percentage, since macOS manages memory aggressively and a high percentage without swap pressure is not a problem.
- **Accurate memory stats on Linux** — was reading `MemFree` from `/proc/meminfo`; now reads `MemAvailable`, which includes reclaimable page cache and gives the correct "memory a new process can actually use" figure.

## [0.9.1] — 2026-05-30

### Added
- **System resource stats in header** — CPU load, RAM used/total, and disk used/total displayed as color-coded indicators (green < 70%, yellow 70–89%, red ≥ 90%). Sourced from `os.loadavg`, `os.freemem`, and `fs.statfs` with no new dependencies. Updates on every 5-second poll via `GET /api/system/resources`.

### Fixed
- **CSP `upgrade-insecure-requests` removed** — Helmet adds this directive by default, which caused browsers to silently rewrite sub-resource requests (CSS, JS, images) from HTTP to HTTPS. On plain-HTTP deployments (local network, Cloudflare Tunnel) this broke the entire UI. TLS is handled externally.
- **Restart confirmation dialog** — Clicking Restart now shows a warning that the process will only come back automatically if launchd or systemd is managing it. The confirm button label also changes dynamically between "Kill" (session) and "Restart" (ccfleet).

### Changed
- `docs/ENV_VARS.md` — `REMOTE_CONTROL_PREFIX` default corrected from `MacMini` to `os.hostname()`
- `docs/spec.md` — example command updated to use generic `mymachine-` prefix
- `pm2` removed from `devDependencies` (was a low-severity ReDoS CVE); launchd and systemd are the documented production service managers

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
