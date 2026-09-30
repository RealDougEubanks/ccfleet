<!--
doc: ENV_VARS
last-refreshed: 2026-06-01
generated-by: doc-refresh skill
-->

# Environment Variables

Copy `.env.example` to `.env` and fill in all required values before running.

```bash
cp .env.example .env
# Edit .env in your preferred editor
```

## Variable Reference

| Variable | Required | Default | Description | Used in |
|----------|----------|---------|-------------|---------|
| `PORT` | no | `3001` | HTTP port the Express server binds to | `server.js` |
| `GIT_ROOT` | yes | — | Absolute path to the directory of git project subdirectories | `server.js`, `lib/projects.js` |
| `CLAUDE_MODEL` | no | `claude-sonnet-4-6` | Model name passed to `claude --model` | `lib/claude.js` |
| `CLAUDE_EFFORT` | no | `medium` | Effort level passed to `claude --effort`. Must be `low`, `medium`, `high`, or `highest` | `lib/claude.js` |
| `CLAUDE_SKIP_PERMISSIONS` | no | `false` | Set to `true` to pass `--dangerously-skip-permissions` to every claude session. **Disables all permission prompts — claude can read, write, and delete any file your account can access without asking.** Only enable if you fully understand and accept the risk. Never set on a shared machine. | `lib/claude.js` |
| `CLAUDE_CODE_OAUTH_TOKEN` | no | — | Long-lived login token from `claude setup-token`. Every session ccfleet starts gets it, so sessions authenticate at boot before anyone has logged in (needed on macOS, where the default login sits in the locked login Keychain). Must be 20–512 characters of `[A-Za-z0-9_-]`; a malformed value stops ccfleet at startup. Passed to sessions through tmux `update-environment`, never on a command line. A changed token reaches new sessions only — stop and start a running session to pick it up. `/health` reports `claude_auth.method: oauth_token` when it is in use. | `lib/claude.js`, `lib/tmux.js` |
| `REMOTE_CONTROL_PREFIX` | no | `os.hostname()` | Host prefix prepended to the per-session `--remote-control` identifier. Defaults to the machine hostname. Set this explicitly if the hostname is long, ambiguous, or changes (e.g. DHCP) | `lib/claude.js` |
| `TTYD_URL` | no | empty | URL of the optional `ttyd` browser terminal. Attach button hidden when unset | `server.js` |
| `REMOTE_CONTROL_URL` | no | `https://claude.ai/code` | URL the Open button deep-links to | `server.js` |
| `LOG_LEVEL` | no | `info` | `pino` log level (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) | `lib/logger.js` |
| `BASIC_AUTH_USER` | no | — | Username for optional HTTP Basic authentication. Both this and `BASIC_AUTH_PASS` must be set to enable basic auth | `lib/auth.js` |
| `BASIC_AUTH_PASS` | no | — | Password for optional HTTP Basic authentication | `lib/auth.js` |

## Optional Basic Authentication

Basic auth is disabled by default. Access control is handled at the network layer by Cloudflare Access (for remote connections) and LAN trust (for local connections).

To enable basic auth as an additional credential layer, set both variables in `.env`:

```
BASIC_AUTH_USER=yourname
BASIC_AUTH_PASS=<paste openssl output>
```

Generate a strong password:

```bash
openssl rand -base64 32
```

When only one of the two variables is set, basic auth stays disabled.

## Secrets

`.env` is the source of truth for local secrets and is git-ignored — it is never committed. There is no central secrets manager. If you need to rotate `BASIC_AUTH_PASS`, update it in `.env` and restart the service.
