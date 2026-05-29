<!--
doc: RUNBOOK
last-refreshed: 2026-05-29
generated-by: doc-refresh skill
-->

# Runbook — ccfleet

> **You were just paged. Start here.**

## Is the service alive?

```bash
# 1. Liveness — does the process answer at all?
curl -fsS http://localhost:3001/healthz

# 2. Readiness — can it reach tmux?
curl -fsS http://localhost:3001/readyz

# 3. Deep health — every dependency
curl -fsS http://localhost:3001/health | jq .

# 4. Tail logs
tail -f ~/Library/Logs/ccfleet/ccfleet.log
```

Expected healthy responses:

| Endpoint | Healthy body |
|----------|--------------|
| `/healthz` | `{"status":"ok"}` |
| `/readyz` | `{"status":"ok"}` |
| `/health` | `{"status":"ok","checks":{"claude":{...},"git_root":{...},"tmux":{...}},...}` |

## Service Overview

| Property | Value |
|----------|-------|
| Port | `3001` (override with `PORT`) |
| Health endpoints | `/healthz`, `/readyz`, `/health` |
| Log location | `~/Library/Logs/ccfleet/ccfleet.log` and `~/Library/Logs/ccfleet/ccfleet-error.log` |
| Log format | JSON (`pino`), ISO timestamps |
| Restart command | `launchctl kickstart -k system/com.ccfleet` |
| Deployed via | macOS launchd LaunchDaemon (`launchd/com.ccfleet.plist`) |
| Auth | Optional HTTP Basic (enabled when `BASIC_AUTH_USER` + `BASIC_AUTH_PASS` are set); otherwise delegated to Cloudflare Access |
| Network exposure | Private VPN / Cloudflare Access only — see [`SECURITY.md`](../SECURITY.md) |

## Start / Stop / Restart

```bash
# Status (are both services running?)
launchctl list | grep ccfleet

# Restart ccfleet
launchctl kickstart -k system/com.ccfleet

# Restart ttyd
launchctl kickstart -k system/com.ccfleet.ttyd

# Stop ccfleet
launchctl bootout system/com.ccfleet

# Start ccfleet (if stopped)
launchctl bootstrap system /Library/LaunchDaemons/com.ccfleet.plist

# Run in foreground (debugging)
npm start
```

> **Note:** The launchd daemon has `KeepAlive: true`. A clean `process.exit(0)` (e.g. from `POST /api/system/restart`) triggers an automatic restart by launchd. `bootout` is the only way to stop it until the next reboot.

## Known Failure Modes

| Symptom | Root cause | Immediate fix |
|---------|-----------|---------------|
| Process exits at startup with `GIT_ROOT must be set` | `GIT_ROOT` env var unset | Set `GIT_ROOT` to an absolute path in `.env` |
| `/readyz` returns 503 with `tmux unavailable` | `tmux` not on `PATH` for the launchd process | `brew install tmux` and restart the daemon |
| `/health` reports `claude: fail` | `claude` CLI missing or not on `PATH` | Install Claude Code and verify with `which claude` |
| `/health` reports `git_root: fail` | `GIT_ROOT` points at a non-existent or unreadable directory | `ls -la $GIT_ROOT` to confirm, fix the path in `.env` |
| Every API call returns 401 | Basic auth is enabled and credentials are wrong or `.env` was rotated | Verify `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `.env` match what the client sends |
| `POST /api/sessions` returns 409 | A tmux session with the sanitized name already exists | `tmux kill-session -t <name>` then retry, or use the Kill button in the UI |
| `POST /api/sessions` succeeds but claude exits immediately | `--continue` flag against a project with no history (should not happen — ccfleet checks first); or `claude` not on the PATH inside tmux | `tmux attach -t <name>` to see the error, then check the log `session_created` event |
| `POST /api/sessions` succeeds but the session never appears in Remote Control | Claude is blocked on the workspace-trust dialog (ccfleet should pre-trust — verify `~/.claude.json` has `projects[<path>].hasTrustDialogAccepted = true`) | `tmux attach -t <name>` to dismiss the prompt; check the log line `trust_granted` field |
| Rate limit (`429`) hit | More than 120 requests/minute from one IP | Wait one minute; if expected, raise the limit in `server.js` |
| ttyd crash-loops at boot | `tmux` server not running yet when ttyd starts | The launchd wrapper uses `tmux new-session -A -s main` which creates the server on first attach — this should self-heal |

## Environment Variables

| Variable | Required | Description | Where to find it |
|----------|----------|-------------|------------------|
| `PORT` | no | HTTP port (default `3001`) | `.env` |
| `GIT_ROOT` | yes | Absolute path to the directory of git projects | `.env` |
| `BASIC_AUTH_USER` | no | Username for optional HTTP Basic auth | `.env` |
| `BASIC_AUTH_PASS` | no | Password for optional HTTP Basic auth | `.env` — generated locally, never shared |
| `TTYD_URL` | no | URL of the optional `ttyd` terminal | `.env` |
| `REMOTE_CONTROL_URL` | no | Override URL for the Open button | `.env` |
| `LOG_LEVEL` | no | `pino` level (`trace`/`debug`/`info`/`warn`/`error`) | `.env` |

## Rollback

```bash
# 1. See recent commits
git log --oneline -10

# 2. Revert the last commit (safe — creates a new commit)
git revert HEAD

# 3. Reinstall dependencies if package.json changed
npm install

# 4. Restart the service
launchctl kickstart -k system/com.ccfleet

# 5. Confirm health
curl -fsS http://localhost:3001/health | jq .
```

## Escalation Path

Solo-maintained personal project. If the maintainer is unreachable and the service is impacting work, stop it with `launchctl bootout system/com.ccfleet` and SSH into the Mac Mini to drive `claude` over `tmux` directly.
