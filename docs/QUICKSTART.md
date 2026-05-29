<!--
doc: QUICKSTART
last-refreshed: 2026-05-29
generated-by: doc-refresh skill
-->

# Quick Start — ccfleet

End-to-end setup and verification for a fresh install on a Mac. Follow the steps in order; each one verifies the previous.

> **Prerequisites:** Node.js 20+, `tmux`, the `claude` CLI, a populated `~/git/` directory, and `jq` for pretty-printing JSON (`brew install jq`).

## Step 1 — Local smoke test on the Mac Mini

1. Install and configure:

   ```bash
   cd ~/git/ccfleet
   npm install
   cp .env.example .env
   ```

2. Edit `.env` and fill in at minimum:

   ```
   PORT=3001
   GIT_ROOT=/Users/<you>/git
   REMOTE_CONTROL_URL=https://claude.ai/code
   LOG_LEVEL=info
   ```

   **Optional:** to add a local credential layer on top of network access control, also set:

   ```
   BASIC_AUTH_USER=<you>
   BASIC_AUTH_PASS=$(openssl rand -base64 32)
   ```

3. Run tests:

   ```bash
   npm test
   ```

   Expected: `34 pass, 0 fail`.

4. Start the server in the foreground:

   ```bash
   npm start
   ```

   Expected log line: `ccfleet listening` with the configured port and git root.

5. In a second terminal on the Mini, probe every endpoint:

   ```bash
   curl -fsS http://127.0.0.1:3001/healthz
   curl -fsS http://127.0.0.1:3001/readyz
   curl -fsS http://127.0.0.1:3001/health | jq .
   curl -fsS http://127.0.0.1:3001/api/projects | jq .
   curl -fsS http://127.0.0.1:3001/api/sessions | jq .
   ```

   If basic auth is enabled, add `-u <user>:<pass>` to the last two `curl` commands.

   Expected results:

   | Endpoint | Expected response |
   |----------|-------------------|
   | `/healthz` | `{"status":"ok"}` |
   | `/readyz` | `{"status":"ok"}` |
   | `/health` | `status: ok`, all three checks `ok` |
   | `/api/projects` | JSON list of git repos under `GIT_ROOT` |
   | `/api/sessions` | `{"sessions":[]}` (empty if no tmux sessions yet) |

6. Stop the server with `Ctrl-C`.

## Step 2 — Create and kill a real session

1. Restart the server:

   ```bash
   npm start
   ```

2. Pick a project name from `/api/projects` and start a session:

   ```bash
   curl -fsS -X POST \
     -H 'Content-Type: application/json' \
     -d '{"project_name":"ccfleet"}' \
     http://127.0.0.1:3001/api/sessions | jq .
   ```

3. Confirm tmux sees it:

   ```bash
   tmux list-sessions
   ```

4. Attach to the tmux session and confirm `claude` is running with the expected flags:

   ```bash
   tmux attach -t ccfleet
   ```

   Expected: the `claude` TUI running with `--model claude-sonnet-4-6`, `--effort medium`, and `--remote-control MacMini-<originProjectName>`. `--continue` is included if the project has prior session history. `--dangerously-skip-permissions` is included only if `CLAUDE_SKIP_PERMISSIONS=true` is set in `.env`.

5. Detach with `Ctrl-b` then `d`.

6. Kill the session via the API:

   ```bash
   curl -fsS -X DELETE http://127.0.0.1:3001/api/sessions/ccfleet
   tmux list-sessions
   ```

   Expected: `204 No Content` from the DELETE, and `no server running` (or an empty list) from tmux.

7. Stop the foreground server with `Ctrl-C`.

## Step 3 — Install as boot services (launchd)

ccfleet and ttyd run as **LaunchDaemons** — macOS system services that start at boot, before any user logs in.

> **SECURITY:** The install script copies plists into `/Library/LaunchDaemons/` and requires `sudo`. The services run as the invoking user's account, not root. Logs go to `~/Library/Logs/ccfleet/`.

1. Confirm `.env` is fully filled in:

   ```bash
   cat .env
   ```

2. Run the install script:

   ```bash
   sudo bash scripts/install-launchd.sh
   ```

   Expected output: `installed and started com.ccfleet` and `installed and started com.ccfleet.ttyd`.

3. Confirm both services are running:

   ```bash
   launchctl list | grep ccfleet
   ```

   Expected: two rows, each with a PID (non-zero first column).

4. Tail the logs:

   ```bash
   tail -f ~/Library/Logs/ccfleet/ccfleet.log
   tail -f ~/Library/Logs/ccfleet/ttyd.log
   ```

5. Verify auto-start survives a reboot:

   ```bash
   sudo reboot
   ```

   After the Mini comes back, SSH in and check:

   ```bash
   curl -fsS http://localhost:3001/healthz
   launchctl list | grep ccfleet
   ```

   Expected: `{"status":"ok"}` and both services listed with PIDs.

## Step 4 — Connect remotely from a phone or laptop

> **SECURITY:** Only connect from a device that is on the private LAN or authenticated through Cloudflare Access. Never expose port `3001` directly to the public internet.

1. Connect your phone or laptop to the VPN, or use the Cloudflare Access URL.
2. In a browser, open:

   ```
   http://mini.local:3001
   ```

   (Substitute the Mini's hostname or LAN IP if `mini.local` does not resolve.)

3. If basic auth is enabled in `.env`, the browser will prompt for credentials.

4. Verify the UI:

   | Section | Expected |
   |---------|----------|
   | Header | ccfleet logo on the left, **refresh** button |
   | Active sessions | Empty state message ("No active sessions.") |
   | Available projects | One row per git repo under `GIT_ROOT` |

5. Tap **Start session** on any project. Within ~5 seconds:

   - The project should disappear from Available projects.
   - A card should appear under Active sessions with a green `active` badge and the elapsed start time.

6. Tap **Open** on the card. A new tab should open at `https://claude.ai/code`.

7. Tap **Kill** on the card. Confirm in the dialog. The card should disappear and the project should return to Available projects.

## Step 5 — Optional: in-browser terminal (`ttyd`)

ttyd is managed automatically by the LaunchDaemon installed in Step 3. If you skipped it:

1. Install `ttyd`:

   ```bash
   brew install ttyd
   ```

2. Set `TTYD_URL` in `.env`:

   ```
   TTYD_URL=http://mini.local:7681
   ```

3. Re-run the install script to start the ttyd daemon:

   ```bash
   sudo bash scripts/install-launchd.sh
   ```

4. Reload the dashboard. The **Attach** button on each session card should now be enabled.

## End-to-end pass criteria

| Step | Pass criteria |
|------|---------------|
| Step 1 | All five `curl` probes return the expected JSON; `npm test` is 34/34 |
| Step 2 | `POST` returns `201`, tmux shows the session, `claude` is running with the expected flags, `DELETE` returns `204` |
| Step 3 | Both launchd services listed with PIDs after a reboot |
| Step 4 | Dashboard loads, Start/Kill work from the phone |
| Step 5 | Attach button opens a live terminal that mirrors `tmux attach` |

## If something breaks

| Symptom | Fix |
|---------|-----|
| Server exits with `GIT_ROOT must be set` | Set `GIT_ROOT` to an absolute path in `.env` |
| `/api/projects` is empty | No direct child of `GIT_ROOT` has a `.git/` entry — confirm with `ls -la $GIT_ROOT/*/.git` |
| `/readyz` returns `503` | `tmux` not on `PATH` — `brew install tmux` and restart the daemon |
| `/health` reports `claude: fail` | `claude` CLI missing or not on `PATH` |
| `mini.local:3001` does not resolve | Use the Mini's LAN IP or check mDNS on the VPN |

Full failure-mode table: [`docs/RUNBOOK.md`](RUNBOOK.md).
