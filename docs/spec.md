# Claude Code Fleet Manager

A lightweight, self-hosted web dashboard for managing Claude Code CLI sessions across multiple git projects on a remote always-on machine (M1 Mac Mini). Built for personal use over a private VPN.

## Working Name

`ccfleet` — short, types fast, doesn't collide with anything obvious. Replace if you prefer.

## Why This Exists

Running an always-on Mac Mini as a remote Claude Code host works great over SSH + tmux, but managing multiple per-project sessions from a phone is awkward. Anthropic's native Remote Control handles *interaction* with existing sessions beautifully but cannot start new sessions. This tool fills that specific gap: a phone-friendly web UI to list git projects, see which have active sessions, and start/stop/rename them — then deep-link into Remote Control or a browser terminal for the actual chat.

## Goals

- **Spin up Claude Code sessions in any project under `~/git/` from a phone browser**, in one tap.
- **Spin them down** just as easily, with a confirmation step to prevent fat-finger accidents.
- **See at a glance** which projects have active sessions, when they were started, and roughly what Claude is doing (idle vs. running).
- **Deep-link to interaction surfaces** — Anthropic's Remote Control (preferred) or a browser-embedded terminal as a fallback.
- **Be safe to expose on a private network** behind a VPN, with basic auth as defense in depth.
- **Survive reboots** — run as a system service that comes up automatically.

## Non-Goals

- **Not** a Claude Code wrapper or harness. This tool never touches OAuth tokens, never proxies API requests, never spoofs Claude Code's telemetry. It spawns the real `claude` binary as a subprocess and that's it. (See "Compliance Notes" below.)
- **Not** a replacement for Remote Control. If Remote Control covers the interaction, this tool's job ends at "session is running."
- **Not** multi-tenant. Single user, single machine.
- **Not** an editor. File viewing/editing belongs in a real IDE or CloudCLI; this is a fleet manager, not a workbench.
- **No automation of `claude -p` runs.** Sessions are started attached to tmux for a human to drive. Headless batch runs are out of scope and would push toward the "unusual traffic patterns" that Anthropic's ToS calls out.

## Target Environment

- **Host:** M1 Mac Mini, 8GB RAM, macOS, always-on
- **Network:** Accessible only over pfSense VPN (no public exposure)
- **Runtime:** Node.js 20+ via Homebrew
- **Dependencies:** `tmux`, `claude` CLI, optionally `ttyd` for embedded terminal
- **Project layout:** All git repos live as direct children of `~/git/` (e.g., `~/git/bookmarkminder`, `~/git/nannylaura.com`)

## Compliance Notes

This is the part to get right. Read carefully:

- This tool **must** invoke the real `claude` binary via subprocess. Never extract OAuth tokens, never call the Anthropic API directly with subscription credentials, never modify or proxy Claude Code's network traffic.
- This tool **must not** spawn unattended `claude -p` runs in a loop, batch jobs across many projects in parallel, or any other pattern that would generate non-human-paced traffic.
- This tool is for a **single user managing their own sessions on their own machine**. It is not a service offered to others. Do not add multi-user support.
- Architecturally equivalent to running `claude` inside `tmux` and attaching via `ttyd` — both already-accepted patterns. The web UI is just a process manager and a deep-link launcher.
- Reference: https://code.claude.com/docs/en/legal-and-compliance

## Architecture

```
┌─────────────────────────────────────────────────────┐
│ Phone or laptop browser (over pfSense VPN)          │
└────────────────────────┬────────────────────────────┘
                         │ HTTPS (self-signed or HTTP)
                         ▼
┌─────────────────────────────────────────────────────┐
│ Express server on Mac Mini, port 3001               │
│                                                     │
│  GET  /api/projects       scan ~/git for repos      │
│  GET  /api/sessions       tmux ls + parse           │
│  POST /api/sessions       tmux new-session          │
│  DEL  /api/sessions/:n    tmux kill-session         │
│  GET  /api/status/:n      pane current command      │
│                                                     │
│  Static frontend at /                               │
└────────────────────────┬────────────────────────────┘
                         │ shell-out
                         ▼
┌─────────────────────────────────────────────────────┐
│ tmux sessions, one per active project               │
│   bookmarkminder    running `claude`                │
│   nannylaura_com    running `claude`                │
│   propagate_iac     idle (shell prompt)             │
└─────────────────────────────────────────────────────┘
                         │ optional
                         ▼
┌─────────────────────────────────────────────────────┐
│ ttyd on port 7681 for browser terminal attach       │
│   (fallback when Remote Control is not enough)      │
└─────────────────────────────────────────────────────┘
```

## Stack

- **Backend:** Node.js + Express. No TypeScript for v1 — keep the surface area small.
- **Process control:** `child_process.execFile` (not `exec` — avoid shell interpolation).
- **Frontend:** Single `index.html` with vanilla JS + a small CSS file. No build step. Alpine.js is acceptable if reactivity gets painful, but Vue/React are overkill.
- **Auth:** `express-basic-auth` with a single user/pass loaded from env vars.
- **Process supervisor:** macOS launchd LaunchDaemons (`launchd/com.ccfleet.plist`, `launchd/com.ccfleet.ttyd.plist`). Installed via `sudo bash scripts/install-launchd.sh`. Services start at boot, before user login, and restart automatically on exit.

## Data Model

There is no database. Truth lives in two places:

1. **Filesystem:** What directories exist under `~/git/`?
2. **tmux:** What sessions are running, and what command is in each pane?

The server is stateless. Restart it and it picks up exactly where things were.

Project name convention: tmux session name = project directory name with `[^a-zA-Z0-9_-]` replaced by `_`. Display name = original directory name. Keep a small in-memory mapping or recompute on each request.

## API Specification

### `GET /api/projects`

Returns the list of git projects under `~/git/`.

**Response:**
```json
{
  "projects": [
    { "name": "bookmarkminder", "session_name": "bookmarkminder", "has_git": true },
    { "name": "nannylaura.com", "session_name": "nannylaura_com", "has_git": true }
  ]
}
```

A "project" is any direct child directory of `~/git/` that contains a `.git/` entry (file or directory, to support worktrees).

### `GET /api/sessions`

Returns active tmux sessions, joined against the project list.

**Response:**
```json
{
  "sessions": [
    {
      "session_name": "bookmarkminder",
      "project_name": "bookmarkminder",
      "started_at": "2026-05-28T09:14:22Z",
      "current_command": "claude",
      "status": "active"
    }
  ]
}
```

`status` is one of:
- `active` — pane is running `claude` (or `node`, since claude spawns node)
- `idle` — pane is a shell prompt (claude has exited)
- `unknown` — pane command couldn't be determined

### `POST /api/sessions`

Starts a new tmux session running `claude` in a project directory.

**Request:**
```json
{ "project_name": "bookmarkminder" }
```

**Behavior:**
- 404 if `~/git/<project_name>` does not exist
- 409 if a tmux session with the sanitized name already exists
- 201 on success with the session record in the same shape as `/api/sessions`

**Implementation:**
```
tmux new-session -d -s <safe_name> -c ~/git/<project_name> \
  'claude --dangerously-skip-permissions [--continue] \
   --model claude-sonnet-4-6 --effort medium \
   --remote-control mymachine-<originProjectName>'
```

- `originProjectName` is the last path segment of the `git remote get-url origin` URL with any trailing `.git` stripped (e.g. `https://github.com/RealDougEubanks/ClaudeMarketplace` → `ClaudeMarketplace`). If the project has no `origin` remote, the directory basename is used.
- `--continue` is included only when `~/.claude/projects/<encoded-path>/` exists and contains at least one `.jsonl` file. Including `--continue` against a fresh project causes claude to exit at startup, so the existence check is mandatory.
- The derived `originProjectName` is validated against `[a-zA-Z0-9._-]+` before being passed as a flag value.
- Before launching, ccfleet writes `~/.claude.json` to mark `projects[<absolute-path>].hasTrustDialogAccepted = true` for the project. Without this, the first launch in a new project blocks indefinitely on claude's interactive workspace-trust dialog. Existing fields on the project entry are preserved.

### `DELETE /api/sessions/:session_name`

Kills the named tmux session.

**Behavior:**
- 404 if no such session
- 204 on success
- The frontend should require a confirmation step before calling this.

### `GET /healthz`

Liveness probe. Returns `200 {"status":"ok"}` whenever the process is up. No auth required.

### `GET /readyz`

Readiness probe. Returns `200 {"status":"ok"}` when the server can shell out to `tmux` successfully, `503 {"status":"fail","reason":"<short>"}` otherwise. No auth required.

### `GET /health`

Deep health check. Synthetically probes each dependency:

- `tmux` — runs `tmux -V` with a 1s timeout
- `git_root` — stats `GIT_ROOT` and checks it is a readable directory
- `claude` — checks the `claude` binary is on `PATH` (`which claude`) with a 1s timeout

**Response:**
```json
{
  "status": "ok",
  "checks": {
    "claude":   { "status": "ok",   "latency_ms": 12 },
    "git_root": { "status": "ok",   "latency_ms": 1  },
    "tmux":     { "status": "ok",   "latency_ms": 8  }
  },
  "checked_at": "2026-05-29T12:00:00Z"
}
```

Overall `status` is `ok` only if every dependency is `ok`; otherwise `degraded` (HTTP 200) if non-critical fails, `fail` (HTTP 503) if `tmux` or `git_root` fails. No secrets, paths, or hostnames leak beyond what is already in the spec. No auth required for v1 (private VPN); revisit if the surface ever widens.

### `GET /api/status/:session_name`

Returns the current pane command for a session — used for live status polling.

**Response:**
```json
{ "session_name": "bookmarkminder", "current_command": "claude", "status": "active" }
```

Frontend polls this every 5 seconds for visible sessions.

## Frontend Specification

Single-page app. Three sections, top to bottom:

### Header
- App name on the left
- Logged-in user indicator on the right (from basic auth)
- A small "refresh" button that re-fetches projects + sessions

### Active Sessions
- One card per running session
- Each card shows: project name, status badge (green = active, yellow = idle, gray = unknown), time since started
- Two buttons per card:
  - **Open** — deep-links to `https://claude.ai/code` (Remote Control surface) in a new tab
  - **Attach (terminal)** — opens ttyd in a new tab attached to this session
  - **Kill** — opens a confirm dialog, then `DELETE`s the session
- If no sessions are running, show a friendly empty state.

### Available Projects
- One row per project under `~/git/` that does *not* currently have a session
- Each row shows: project name, "Start session" button
- Tapping "Start session" calls `POST /api/sessions`, then optimistically moves the project to the Active Sessions section

### Mobile Layout
- Single column always — no responsive tricks needed
- Buttons big enough to tap (min 44px tall, per iOS HIG)
- No hover-only interactions

## Security

This is going on a private network behind a VPN, but defense in depth:

1. **Bind to a single interface** if possible (`0.0.0.0` is fine on the VPN-only network; `127.0.0.1` only if you'll tunnel separately).
2. **Basic auth** on every endpoint, including static files. Credentials in env vars, not committed.
3. **Sanitize project names hard.** Allow only `[a-zA-Z0-9._-]`. Reject anything else. Lookup against the actual directory listing — never trust the request value to be a real project.
4. **Use `execFile`, not `exec`.** No string concatenation into shell commands.
5. **HTTPS optional but nice** — self-signed cert is fine for personal use. Skip for v1 if it's a hassle.
6. **No write access to project files** through this tool. Git operations belong in Claude Code itself or a real IDE.

## Configuration

Single `.env` file at the repo root:

```
PORT=3001
GIT_ROOT=/Users/doug/git
BASIC_AUTH_USER=doug
BASIC_AUTH_PASS=<long-random-string>
TTYD_URL=http://mini.local:7681
REMOTE_CONTROL_URL=https://claude.ai/code
```

Defaults sensibly when env vars are missing, except for `BASIC_AUTH_PASS` which should refuse to start if unset.

## Repository Layout

```
ccfleet/
├── README.md
├── SPEC.md              ← this file
├── package.json
├── server.js            ← Express app, all routes
├── lib/
│   ├── projects.js      ← scan ~/git for repos
│   ├── tmux.js          ← wrappers for tmux ls / new / kill
│   └── auth.js          ← basic auth middleware
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── ecosystem.config.js  ← PM2 config (retained for fallback; launchd is primary)
├── launchd/             ← macOS LaunchDaemon plists
│   ├── com.ccfleet.plist
│   └── com.ccfleet.ttyd.plist
├── scripts/
│   └── install-launchd.sh
├── .env.example
└── .gitignore
```

## Build Plan

A suggested order for Claude Code to work through. Each step should leave the app in a working state.

### Step 1: Scaffolding
- `npm init -y`, install `express`, `express-basic-auth`, `dotenv`
- Create the directory layout above
- `.gitignore` for `node_modules/`, `.env`, logs
- Basic `server.js` that listens on `PORT` and serves a "hello" route

### Step 2: Project discovery
- Implement `lib/projects.js` — read `GIT_ROOT`, filter to directories with `.git`
- Wire up `GET /api/projects`
- Hand-test with curl

### Step 3: Session listing
- Implement `lib/tmux.js` — `listSessions()` using `tmux ls -F "#{session_name}|#{session_created}|#{pane_current_command}"`
- Handle the "no sessions" case where tmux returns non-zero
- Wire up `GET /api/sessions` and `GET /api/status/:name`

### Step 4: Session lifecycle
- Implement `createSession(projectName)` and `killSession(sessionName)` in `lib/tmux.js`
- Sanitize names; verify project exists before creating; verify session exists before killing
- Wire up `POST /api/sessions` and `DELETE /api/sessions/:name`

### Step 5: Auth
- Add `express-basic-auth` middleware before all routes
- Refuse to start if `BASIC_AUTH_PASS` is missing or empty

### Step 6: Frontend
- `index.html` with the three sections from the Frontend Specification
- `app.js` polls `/api/sessions` every 5 seconds
- Vanilla fetch, no build step, no frameworks

### Step 7: Deep links
- "Open" button   `REMOTE_CONTROL_URL` in `target="_blank"`
- "Attach (terminal)" button   `TTYD_URL` in `target="_blank"`
- Document the ttyd command to run alongside this server:
  ```
  ttyd -p 7681 -W -c $BASIC_AUTH_USER:$BASIC_AUTH_PASS tmux a
  ```

### Step 8: Service supervision
- launchd LaunchDaemon plists in `launchd/` with `KeepAlive: true` and `RunAtLoad: true`
- Install script at `scripts/install-launchd.sh` — copies plists to `/Library/LaunchDaemons/`, sets ownership, bootstraps via `launchctl bootstrap system`
- README section on `sudo bash scripts/install-launchd.sh`

### Step 9: Polish
- Loading states on buttons (disable + spinner while requests are in flight)
- Toast/notification on errors instead of `alert()`
- Confirm dialog for kill that requires typing the project name (or just a checkmark — your call)
- "Last refreshed" timestamp in the header

## Testing Approach

Manual is fine for v1. Real test cases to walk through after each step:

1. Start the server with no tmux sessions running   projects list should populate, sessions list should be empty.
2. Start a session via the UI   it should appear in the Active Sessions section within 5 seconds.
3. Kill the session via the UI   it should disappear and reappear in Available Projects.
4. Start a session, then `exit` Claude in the actual tmux session   status should flip from `active` to `idle`.
5. Try to start a session with a name containing `;` or `..` via curl   should be rejected.
6. Restart the Mini   after boot, the server should come up automatically via launchd.

## Open Questions

These need a decision before or during implementation:

1. **Stale session cleanup.** If a session goes `idle`, do we auto-kill after N minutes, or just show the status and let the user decide? **Suggested:** show only, user decides. Auto-kill is a footgun.
2. **Multiple sessions per project.** Useful for git worktrees or parallel feature branches. **Suggested:** v1 supports one session per project. Add suffix support (`bookmarkminder-feat-x`) in v2 if needed.
3. **Session naming on creation.** Always use the project directory name, or let the user provide a custom name? **Suggested:** v1 uses directory name. Custom names are v2.
4. **ttyd auth sharing.** Should ttyd use the same basic auth credentials as the dashboard? **Suggested:** yes, simplest is one env var pair for both.
5. **HTTPS.** Self-signed cert via mkcert, or HTTP only behind VPN? **Suggested:** HTTP for v1, document the upgrade path.

## Future Ideas (Not v1)

- **Project tags or pinning** — favorite a project so it's always at the top
- **Session history** — when was the last time you worked on `propagate-iac`?
- **Git status badge** per project — dirty/clean, current branch
- **Webhook on session events** — fire a Home Assistant notification when a session goes idle, since you've already got the HA infrastructure
- **Quick-prompt** — send a one-shot prompt to a fresh `claude -p` invocation. Watch the ToS line carefully if you build this; keep it human-paced and visible.
- **Multiple machines** — if you ever add a second always-on host, this becomes a "fleet of fleets" problem. Don't design for it until it exists.

## Style and Conventions

A few things that will keep Claude Code on-brand when working in this repo:

- Surgical edits over broad rewrites. When fixing a bug, change the minimum needed.
- Sort object keys, IAM-style policy fields, and alphabetizable arrays alphabetically where there's no semantic order.
- Comments explain *why*, not *what*. The code already shows *what*.
- No TypeScript for v1. No build step. The whole point is "I can SSH in and edit a file."
- Use `async/await`, not callbacks or raw promises. No `.then()` chains.
- Error responses are JSON: `{ "error": "human-readable message" }`. Never HTML error pages from Express defaults.

## License

MIT or whatever Doug prefers for his own projects. Add a LICENSE file before going public (if it ever goes public).

## How To Hand This To Claude Code

After cloning this repo with just `SPEC.md` and `README.md` (stub) in it:

```
cd ~/git/ccfleet
claude
```

Then:

> Read SPEC.md. We're building this together. Start with Step 1 from the Build Plan and stop after each step so I can review before you move on. Don't skip ahead. Confirm you've read the Compliance Notes section before writing any code.

