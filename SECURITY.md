<!--
doc: SECURITY
last-refreshed: 2026-05-29
generated-by: doc-refresh skill
-->

# Security Policy

## Reporting a Vulnerability

> **SECURITY: Do NOT open a public GitHub issue for security vulnerabilities.**

This is a personal project with a single maintainer. Report privately by emailing the repository owner.

Expected acknowledgment: within 7 days. This is a hobby project — response times are best-effort.

## Threat Model

ccfleet is designed to run on a single user's always-on Mac, accessible only over a private VPN or Cloudflare Access tunnel. The intended threat model is:

- **In scope:** an attacker who bypasses the network perimeter (VPN/Cloudflare Access), a stolen `.env` file, or a malicious crafted request to one of the API endpoints.
- **Out of scope:** local code execution by the user who owns the Mac, attacks against the Anthropic API, or attacks against `tmux` or `claude` themselves.

## Access Control Model

ccfleet has no mandatory built-in authentication. Access control is layered at the network:

| Access path | How it's protected |
|-------------|-------------------|
| Remote (public internet) | Cloudflare Access (JumpCloud SAML) via `cloudflared` tunnel — zero-trust identity check before any request reaches the server |
| Local LAN | Network trust — only devices on the private LAN can reach port `3001` |
| Direct port `3001` | Never expose to the public internet |

**Optional basic auth:** If you want an extra credential layer on top of network access control, set both `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in `.env`. When both are present, the server enables HTTP Basic authentication on all API routes. When either is absent, basic auth is disabled and access relies entirely on the network perimeter.

## Sensitive Data This Project Handles

| Data | Where it lives | Protection |
|------|----------------|------------|
| Optional basic auth credentials | `.env` file on the host | File-system permissions, `.gitignore` |
| Project directory listing | Returned by `GET /api/projects` | Behind Cloudflare Access (and optionally basic auth) |
| tmux session names | Returned by `GET /api/sessions` | Behind Cloudflare Access (and optionally basic auth) |
| Logs | launchd stdout files | Local-only, no PII logged |

ccfleet does **not** handle:
- Anthropic OAuth tokens or API keys (the `claude` binary owns those)
- Source code or repository contents (read-only directory listing only)
- PII or payment data

## Known Security Controls

| Control | Where it lives |
|---------|----------------|
| Optional HTTP Basic auth on API and static routes | `lib/auth.js`, `server.js` |
| Rate limiting (120 req/min per IP) | `server.js` |
| Request body size cap (`1kb`) | `server.js` |
| Strict input validation (regex + `zod`) | `lib/sanitize.js`, `server.js` |
| Path traversal rejection in project names | `lib/sanitize.js` |
| `execFile` only, never `exec` (no shell interpolation for tmux/git args) | `lib/tmux.js`, `lib/git.js` |
| 5-second timeout on every shell-out | `lib/tmux.js`, `lib/git.js` |
| 1-second timeout on health-check probes | `lib/health.js` |
| `Cache-Control: private, no-store` on API responses | `server.js` |
| Auth failures logged with IP, path, method (when basic auth is enabled) | `lib/auth.js` |
| Unauthenticated health endpoints (no secrets disclosed) | `server.js` |
| `x-powered-by` header disabled | `server.js` |
| Atomic, mode-`0600` write of `~/.claude.json` when pre-trusting a project | `lib/claude.js` |

## Network Exposure

> **SECURITY:** ccfleet has no TLS by default. It must run only on a network where transport encryption is provided externally (Cloudflare Tunnel, WireGuard, OpenVPN). Never expose port `3001` directly to the public internet.

For remote access, use `cloudflared tunnel` with Cloudflare Access — this terminates TLS at the edge and enforces identity before traffic reaches the server.

## Dependency Security

```bash
# Run before every release
npm audit

# Fix automatically applicable issues
npm audit fix
```

Production dependencies are intentionally small to limit the attack surface. Review every new dependency for size, maintainer, and recent activity before adding it.

## Monitoring for Suspicious Activity

When basic auth is enabled, check for `auth_failure` events:

```bash
tail -f ~/Library/Logs/ccfleet/ccfleet.log | grep auth_failure
```

Repeated failures from an unexpected IP suggest someone reached the server despite the network perimeter. Review your Cloudflare Access policy and VPN access list.
