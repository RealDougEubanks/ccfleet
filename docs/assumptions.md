# Assumptions

Non-obvious decisions made during ccfleet implementation. Each entry: assumption, why, recorded by, date.

---

- **Assumption:** Test coverage in v1 is limited to unit tests for input sanitization, the tmux command builder, and the project scanner. No integration tests, no end-to-end browser tests.
- **Why:** Single-user personal tool behind a VPN with a narrow API surface (4 routes). Sanitization is the only code path with security implications worth automating; everything else is shell-out plumbing that is easier to verify by manual walk-through. CLAUDE.md mandates tests for input handlers — those are covered. Broader test infrastructure is deferred to v2.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** HTTP only, no TLS, for v1. Basic auth credentials traverse the VPN tunnel in clear text inside the encrypted VPN.
- **Why:** Service binds only to a pfSense VPN-reachable interface and is not exposed publicly. The VPN already provides transport encryption between client and server. Adding self-signed TLS adds setup friction (cert trust on phone) for marginal gain. Revisit if the service is ever exposed beyond the VPN.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** Logs are emitted as JSON via `pino` to stdout; launchd captures stdout/stderr to `~/Library/Logs/ccfleet/ccfleet.log` and `ccfleet-error.log`. No separate log aggregator or rotation daemon.
- **Why:** Single host, single user, low log volume. launchd's file redirection is sufficient for this scale. Structured JSON keeps the door open for piping to a real aggregator later without changing the application.
- **Recorded by:** Claude (Sonnet 4.6)
- **Date:** 2026-05-29

---

- **Assumption:** Static frontend assets (`index.html`, `app.js`, `style.css`) are served with `Cache-Control: no-cache` rather than long-lived immutable caching. API responses use `Cache-Control: private, no-store`.
- **Why:** No build step means no content-hashed filenames, so aggressive caching would force manual cache-busting on every edit. `no-cache` lets the browser revalidate cheaply (304s) while always reflecting the current file. API data is per-user and tmux state changes frequently — never cache.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** Health endpoints (`/healthz`, `/readyz`, `/health`) are unauthenticated.
- **Why:** External uptime monitors (NodePing etc.) need to probe without credentials. The endpoints disclose only the names of dependencies already documented in this repository's spec — no secrets, paths, or version strings. Acceptable for a VPN-only service.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** Session name sanitization replaces any character outside `[a-zA-Z0-9_-]` with `_`. Collisions (e.g. `nannylaura.com` and `nannylaura_com`) are detected at session creation time and rejected with 409.
- **Why:** tmux session names are constrained, and a regex-replace strategy is simpler than escaping. Collisions are rare in practice on a personal `~/git/` tree; an explicit 409 with the colliding session name is clearer than silent overwrite. Custom session names are deferred to v2 per spec.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** `claude` is launched inside tmux with `--dangerously-skip-permissions --continue --model claude-sonnet-4-6 --effort medium --remote-control <prefix>-<originProjectName>` where `<prefix>` is `REMOTE_CONTROL_PREFIX` if set, otherwise `os.hostname()`. `--continue` is only included when prior session history exists for the project (a non-empty `~/.claude/projects/<encoded-path>/` directory containing at least one `.jsonl`); otherwise it is omitted because `--continue` against a fresh project causes claude to exit at startup.
- **Why:** The user runs claude on a remote always-on host and wants every fleet-launched session to attach to Anthropic's Remote Control surface under a stable, host-prefixed identifier. The identifier is derived from the git `origin` URL (e.g. `https://github.com/RealDougEubanks/ClaudeMarketplace` → `<hostname>-ClaudeMarketplace`) so it is stable across directory renames. If no `origin` remote is configured, the directory basename is used as a fallback. `--dangerously-skip-permissions` is the user's standing preference for this host.
- **How to apply:** When extending session creation logic, keep the existence check before adding `--continue`, validate the derived remote-control name against `[a-zA-Z0-9._-]+` before passing it as an argument, and never interpolate the origin URL itself into a shell command.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** Before launching `claude`, ccfleet pre-trusts the target project by writing `projects[<absolute-path>].hasTrustDialogAccepted = true` into `~/.claude.json`. Existing fields on the project entry are preserved; the file is rewritten atomically via a temp-file rename with mode `0600`.
- **Why:** Claude's workspace-trust dialog is only suppressed in non-interactive mode (`-p` or non-TTY). Inside a detached tmux session it is interactive, so a fresh project blocks indefinitely on the prompt — which defeats the "one tap to start" goal. Pre-trusting is the same outcome as the user accepting the dialog once, just done up front by the caller.
- **How to apply:** Trust is granted unconditionally for any project under `GIT_ROOT`, because ccfleet's threat model already trusts everything in that directory. If the threat model widens (e.g. multi-user, or projects sourced from untrusted locations), revisit this — at that point trust should require an explicit per-project approval step.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** All `execFile` calls to `tmux`, `git`, and `claude` have a 5-second timeout. Hung shell-outs return an error rather than blocking the request indefinitely.
- **Why:** CLAUDE.md mandates timeouts on every external call. `tmux` and filesystem calls should complete in milliseconds; 5s is a generous ceiling that catches pathological cases without false positives.
- **Recorded by:** Claude (Opus 4.7)
- **Date:** 2026-05-29

---

- **Assumption:** `pm2` was removed entirely from the project (previously a `devDependency`). ccfleet uses launchd (macOS) and systemd (Linux) exclusively as its service managers. There are no npm scripts wrapping pm2.
- **Recorded by:** Claude (Sonnet 4.6)
- **Date:** 2026-06-01

---

- **Assumption:** The `.env` editor exposes project environment files (which may contain API keys and secrets) via the web UI. The global JSON body limit was raised to `64kb` to accommodate typical `.env` files; individual routes still enforce tighter limits via Zod schemas (`content` capped at 65536 chars). Writes are atomic: a temp file with a random hex suffix and mode `0600` is written and then renamed over the target — no partial content is ever readable. The editor automatically appends `.env` to the project's `.gitignore` if not already covered.
- **Why:** A `.env` editor that writes insecure temp files or lacks a `.gitignore` guard could silently commit secrets if the user runs `git add .` in the project directory. The body limit increase is safe because all routes enforce per-field Zod caps that are tighter than the global limit.
- **How to apply:** Any future route that writes sensitive files should follow the same atomic-write pattern (`randomBytes` suffix, mode `0600`, unlink on failure) and should include a `.gitignore` guard where applicable.
- **Recorded by:** Claude (Sonnet 4.6)
- **Date:** 2026-06-01

---

- **Assumption:** Session reload (`POST /api/projects/:name/sessions/reload`) uses `tmux respawn-pane -k` to kill the running `claude` process and immediately relaunch it with `--continue` in the same pane. This is a process restart, not a true in-place env reload (Linux's `/proc/PID/environ` is write-once at `execve` time). The conversation history stored in the `.jsonl` file is untouched; from the user's perspective the session is continuous.
- **Why:** Environment variables are set at process startup and cannot be injected into a running process without OS-specific and fragile tricks. `respawn-pane -k` is the cleanest available mechanism: it reuses the same tmux window and working directory, so the user sees no visible session disruption.
- **How to apply:** `respawn-pane` with the `-k` flag requires tmux ≥ 3.0. If tmux version detection is ever added to the health check, include a version gate for this feature.
- **Recorded by:** Claude (Sonnet 4.6)
- **Date:** 2026-06-01
