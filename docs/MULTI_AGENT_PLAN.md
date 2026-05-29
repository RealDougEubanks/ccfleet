<!--
doc: MULTI_AGENT_PLAN
last-refreshed: 2026-05-29
generated-by: planning session
-->

# Plan: Multi-Agent Support (opencode + codex-cli)

This document captures the research findings and proposed implementation plan for adding opencode and codex-cli alongside Claude Code as launchable agents in ccfleet.

---

## Tool Capability Summary

### Claude Code

| Capability | Detail |
|------------|--------|
| Remote control | `--remote-control <name>` — registers session with Anthropic's hosted Remote Control at `claude.ai/code` |
| Session history | `~/.claude/projects/<encoded-path>/*.jsonl` |
| Continue flag | `--continue` — resumes last session; fails if no history exists (ccfleet pre-checks) |
| Workspace trust | `hasTrustDialogAccepted` in `~/.claude.json` — ccfleet pre-writes this |
| Skip permissions | `--dangerously-skip-permissions` |
| Launch target | `tmux new-session ... 'claude --flags'` |

---

### opencode (sst/opencode)

| Capability | Detail |
|------------|--------|
| Remote control | **None analogous to Claude Code.** No hosted control surface. |
| Web UI | `opencode web` — starts a headless server **and** opens a browser web UI on a local port (default 4000). The browser UI is the interaction surface. |
| Attach mode | `opencode attach` — connects a second terminal to an already-running backend. Useful with ttyd. |
| Session history | SQLite at `~/.local/share/opencode/opencode.db`. No per-project files to check — query DB or use `opencode session list`. |
| Continue flag | `--continue` / `-c` on `opencode run`. The TUI remembers context automatically. |
| Workspace trust | **None.** No first-run trust dialog. |
| Skip permissions | `--dangerously-skip-permissions` |
| Model flag | `--model provider/model_id` (e.g. `anthropic/claude-sonnet-4-6`) |
| Known bug | `opencode run` does not exit cleanly on v0.15+ — hangs until killed. Use the TUI (`opencode`) inside tmux instead. |
| Launch target | `tmux new-session ... 'opencode'` — TUI mode. ccfleet deep-links to the `opencode web` local URL for the interaction surface. |

**Open question:** `opencode web` binds to localhost by default. For remote access from a phone we either need to bind it to `0.0.0.0` (check if `--hostname` flag supports this) or proxy through ccfleet. Needs testing.

---

### codex-cli (openai/codex)

| Capability | Detail |
|------------|--------|
| Remote control | **First-class.** `codex app-server --listen ws://0.0.0.0:PORT` starts a WebSocket server. Clients connect with `codex --remote ws://host:port`. The codex desktop app or a `--remote` TUI client is the interaction surface. |
| Remote auth | `--ws-auth`, `--ws-token-file`, `--ws-shared-secret-file` — bearer token or shared secret |
| Session history | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Resume | `codex resume` or `codex resume <session-id>` |
| Workspace trust | **None.** But `codex login` is required once before any session will work. ccfleet should pre-check that codex is authenticated. |
| Skip permissions | `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`) |
| Model flag | `--model` / `-m` |
| Sandbox flag | `--sandbox workspace-write` (recommended for automation) |
| Launch target | Two-process model: `codex app-server` as a persistent daemon + clients connect via `--remote`. ccfleet manages the app-server process. |

---

## Architecture Changes

### Current state

ccfleet is hardcoded to claude. `lib/claude.js` builds the launch command and checks session history. `lib/tmux.js` calls it directly.

### Proposed state

```
lib/
  agents/
    index.js        ← registry: { claude, opencode, codex }
    claude.js       ← moved from lib/claude.js, renamed
    opencode.js     ← new
    codex.js        ← new
  tmux.js           ← updated: accepts agentId param
server.js           ← POST /api/sessions accepts optional agent field
public/
  app.js            ← "Start session" shows agent picker (default: claude)
```

Each agent module exports a standard interface:

```js
{
  id: 'claude' | 'opencode' | 'codex',
  displayName: string,
  binaryName: string,                   // for health check / PATH detection

  // Returns true if the agent can be launched (binary on PATH, auth valid)
  isAvailable(): Promise<boolean>,

  // Returns true if session history exists for this project dir
  hasExistingSession(projectDir): Promise<boolean>,

  // Pre-launch setup (trust files, auth checks, etc.)
  preflight(projectDir): Promise<{ ok: boolean, reason?: string }>,

  // Returns the shell command string to pass to tmux new-session
  buildLaunchCommand({ projectDir, sessionName, originProjectName }): string,

  // URL to open when user clicks the "Open" button. May be null if not supported.
  getRemoteUrl({ sessionName, host }): string | null,
}
```

---

## Per-Agent Launch Details

### opencode

```
opencode --dangerously-skip-permissions
```

- No `--remote-control` equivalent.
- The "Open" button deep-links to `http://<host>:4000` (the `opencode web` local server port). **Requires testing** to confirm `opencode web` can bind to `0.0.0.0` for remote access.
- Alternative for remote access: use ttyd Attach button, which already works.
- `hasExistingSession()`: query `opencode session list --format json` and check for an entry matching the project path. Or check if `~/.local/share/opencode/opencode.db` exists (any sessions). Simpler: always launch without `--continue` for v1; add session resume in v2.
- No `preflight()` needed — no trust dialog, no auth gate for tool use.

### codex

Two-process model:

1. **`codex app-server` daemon** — one per project, launched by ccfleet and tracked as a separate tmux pane or background process. Port allocated per project (e.g. 7700 + project index, or from a config map).
2. **`codex --remote ws://localhost:<port>` TUI** — the session the user sees in tmux, which connects to the app-server.

The "Open" button has nothing to deep-link to unless the user has the codex desktop app (`codex app`). For v1: "Open" button is hidden for codex sessions. The Attach button (ttyd) is the interaction surface.

`preflight()` for codex:
- Check `codex login` status — run `codex login --help` or check `~/.codex/auth.json`. If not authenticated, return `{ ok: false, reason: 'codex not authenticated — run codex login on the host' }`.

`hasExistingSession()`: check `~/.codex/sessions/` for any `.jsonl` files in the current date tree. If files exist, pass `codex resume --last` in the launch command.

---

## Session Identification

Currently ccfleet infers agent type from `pane_current_command` (claude/node → active, zsh → idle). With multiple agents, the inference needs to expand:

| pane_current_command | Inferred agent |
|----------------------|----------------|
| `claude` or `node`   | claude (existing) |
| `opencode`           | opencode |
| `codex`              | codex |

The UI card can show which agent is running in the badge area.

The tmux session naming convention does not need to change — session names remain the project-derived name. Agent type is inferred at display time.

---

## UI Changes

### "Start session" row

Replace the single "Start session" button with a split:

```
[ project-name ]    [ Start ▾ ]
                       claude       ← default, top
                       opencode
                       codex
```

Or three separate buttons: `claude | opencode | codex`. The simpler option given the mobile-first layout.

`POST /api/sessions` body gains an optional `agent` field:

```json
{ "project_name": "ccfleet", "agent": "codex" }
```

Defaults to `claude` if omitted (backward compatible).

### Session cards

Add an agent indicator to the card:

```
[ ccfleet ]   ● active   [claude]
```

`[claude]` / `[opencode]` / `[codex]` as a small secondary badge.

The "Open" button is conditionally shown/hidden per agent:
- claude → opens `REMOTE_CONTROL_URL`
- opencode → opens `http://<host>:4000` (or hidden if web server not confirmed running)
- codex → hidden for v1

---

## Health Checks

Add `opencode` and `codex` to `/health`:

```json
{
  "checks": {
    "claude":   { "status": "ok" },
    "codex":    { "status": "ok" },
    "git_root": { "status": "ok" },
    "opencode": { "status": "ok" },
    "tmux":     { "status": "ok" }
  }
}
```

All three agent checks are `degraded` (not `fail`) if missing — the service still works with whichever agents are installed.

---

## Configuration

New `.env` keys:

```
# Comma-separated list of enabled agents. Defaults to 'claude' only.
ENABLED_AGENTS=claude,opencode,codex

# Per-agent port for codex app-server (one port per concurrent codex session)
CODEX_APP_SERVER_BASE_PORT=7700

# opencode web server port (if using opencode web for remote access)
OPENCODE_WEB_PORT=4000
```

---

## Implementation Steps

Each step leaves the app in a working state. All existing claude functionality is unchanged until Step 3.

### Step 1 — Restructure agent code
- Create `lib/agents/` directory.
- Move `lib/claude.js` → `lib/agents/claude.js`, adapt to the agent interface.
- Create `lib/agents/index.js` registry.
- Update all existing imports. Tests still pass.

### Step 2 — opencode agent module
- Implement `lib/agents/opencode.js`.
- `isAvailable()`: `which opencode`.
- `hasExistingSession()`: stub returning `false` for v1 (no `--continue` in first version).
- `buildLaunchCommand()`: `opencode --dangerously-skip-permissions`.
- `getRemoteUrl()`: return `http://<host>:${OPENCODE_WEB_PORT}` (document that user must run `opencode web` separately for v1, or auto-launch it in v2).
- Add `opencode` to `/health` checks.
- Add unit tests.

### Step 3 — codex agent module
- Implement `lib/agents/codex.js`.
- `isAvailable()`: `which codex`.
- `preflight()`: check `~/.codex/auth.json` exists and is non-empty.
- `hasExistingSession()`: check `~/.codex/sessions/` for any `.jsonl`.
- `buildLaunchCommand()`: `codex --yolo --model <model>` (TUI mode, no app-server for v1). App-server two-process model is v2.
- `getRemoteUrl()`: return `null` for v1.
- Add `codex` to `/health` checks.
- Add unit tests.

### Step 4 — Wire agent param into session creation
- Update `POST /api/sessions` to accept optional `agent` field (validated against `ENABLED_AGENTS`).
- Update `tmux.createSession()` to accept and use the agent module.
- Update session response to include `agent_id`.

### Step 5 — Infer agent from running sessions
- Update `classify()` / session listing to infer and return `agent_id` from `pane_current_command`.

### Step 6 — UI: agent picker
- Add agent selector to the Available Projects rows.
- Show agent badge on Active Session cards.
- Show/hide "Open" button per agent.

### Step 7 — codex app-server (v2, post-v1)
- Launch `codex app-server --listen ws://0.0.0.0:<port> --ws-auth ...` as a separate managed process before launching the codex TUI.
- Track the port mapping (session name → port) in a small in-memory map (reset on server restart — acceptable).
- Update `getRemoteUrl()` to return the WebSocket endpoint for the codex desktop app.
- Add app-server restart to the System panel.

---

## Open Questions

1. **opencode web binding.** Does `opencode web` support `--hostname 0.0.0.0` to bind to all interfaces? Needs local testing before Step 2 can ship the "Open" button.

2. **codex auth check.** The `~/.codex/auth.json` existence check may be too naive — the token could be expired. A better check would be a low-cost authenticated call. Investigate `codex debug models` as a preflight probe.

3. **Multiple agent sessions for the same project.** If a user starts a claude session for `ccfleet` and then a codex session for `ccfleet`, both would try to use the same tmux session name (`ccfleet`). Options: encode agent in the session name (`ccfleet-codex`), or enforce one session per project regardless of agent. Proposal: one session per project in v1, agent is a property of that session.

4. **opencode session resume.** The SQLite DB doesn't map neatly to a per-project check. Test whether `opencode session list` output is filterable by project directory before committing to a resume strategy.

5. **Effort / model flags.** opencode uses `--model provider/model_id` and `--variant` for reasoning effort. codex uses `--model`. These should be configurable per-agent via `.env` rather than hardcoded. Defer to v2.

---

## Out of Scope for v1

- codex app-server two-process management (Step 7 above)
- opencode `web` auto-launch
- Per-project agent preference persistence
- Session resume for opencode and codex (both launch fresh in v1)
- Multi-session per project (one session per project, first agent wins)
