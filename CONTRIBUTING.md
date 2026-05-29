<!--
doc: CONTRIBUTING
last-refreshed: 2026-05-29
generated-by: doc-refresh skill
-->

# Contributing to ccfleet

## Before You Start

1. Read [`README.md`](README.md) to understand what the project does.
2. Read [`docs/spec.md`](docs/spec.md) for the full specification.
3. Read [`CLAUDE.md`](CLAUDE.md) for the mandatory project rules (security, naming, testing).
4. For non-trivial changes, open an issue first to discuss the approach.

> **SECURITY:** Never commit secrets, API keys, tokens, or credentials. `.env` is git-ignored — keep it that way. If you accidentally commit a secret, rotate it immediately and force-push the cleanup (after coordinating with the maintainer).

## Workflow

1. Branch from `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feature/short-description
   ```
2. Make your changes.
3. Run tests:
   ```bash
   npm test
   ```
4. Start the server locally and exercise the change end-to-end:
   ```bash
   npm start
   ```
5. Commit with a descriptive message.
6. Open a PR with a clear title and description.

> **SECURITY:** Never commit or push directly to `main`. All changes go through a branch and PR — no exceptions. See the Git Hygiene section of [`CLAUDE.md`](CLAUDE.md).

## PR Checklist

- [ ] `npm test` passes
- [ ] No new secrets or hardcoded credentials
- [ ] Input handlers (any new HTTP route, any new shell-out) have unit tests for valid, invalid, oversized, and exception paths
- [ ] Every `execFile` shell-out has a timeout
- [ ] Docs updated if behavior changed (README, spec, runbook as applicable)
- [ ] Any non-obvious decision recorded in [`docs/assumptions.md`](docs/assumptions.md)
- [ ] At least one approving review before merge (solo maintainer: self-review the diff explicitly)

## Code Style

| Aspect | Convention |
|--------|------------|
| Language | Node.js 20+, plain JavaScript (no TypeScript) |
| Naming | `camelCase` for variables and functions, `kebab-case` for CSS, `snake_case` for JSON keys returned over the API |
| Async | `async`/`await`, never raw promise chains or callbacks |
| Shell-outs | `execFile` only, never `exec`. Every call needs an explicit timeout |
| Errors | JSON responses shaped `{ "error": "human-readable message" }`. Never let Express defaults render HTML |
| Logging | Structured `pino` logs only. No `console.log` in production paths |
| Comments | Explain *why*, not *what* |

## Adding a New Dependency

1. Justify the addition: does the value outweigh the security and maintenance cost?
2. Check the package's size, maintainer, recent activity, and known CVEs.
3. Pin the version in `package.json`.
4. Run `npm audit` after installing.
5. Note the rationale in the PR description.

## Tests

| File | Covers |
|------|--------|
| `test/sanitize.test.js` | Input validation and path traversal rejection |
| `test/projects.test.js` | Filesystem scanning, `.git` detection, traversal guards |
| `test/tmux-classify.test.js` | Mapping pane command to status (active/idle/unknown) |
| `test/health.test.js` | Health aggregation logic |
| `test/git.test.js` | Origin URL parsing (HTTPS, SSH, subgroups, `.git` suffix) |
| `test/claude.test.js` | Claude command builder and session-history detection |

Add a test file under `test/` for every new module. Use the built-in `node:test` runner — no extra dependencies.
