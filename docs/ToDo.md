# ToDo

## Authentication & Security

- [ ] **Rate-limit the `/health` deep-check endpoint separately** (`server.js`)
  `/health` runs child processes (`tmux -V`, `claude --version`) on every call and is unauthenticated with no rate limit. Apply a tighter limiter (e.g. 10 req/min) to `/health` only, keeping `/healthz` and `/readyz` fully open for uptime monitors.

- [ ] **Add `requireJson` to `DELETE /api/sessions/:name`** (`server.js:252`)
  All other mutating routes use `requireJson` as a CSRF guard; DELETE is the only exception. Browsers require a CORS preflight for cross-origin DELETEs (which the server does not grant), but adding `requireJson` is consistent and closes the gap for non-browser callers.

- [ ] **Per-project `CLAUDE_SKIP_PERMISSIONS` override**
  Currently the flag is global — all sessions get `--dangerously-skip-permissions` or none do. Add a per-project opt-in (e.g. a `.ccfleet` config file in the project root) so high-trust projects can use it while others retain prompting.

- [ ] **Read Cf-Access-Jwt-Assertion header to populate user identity in GUI**
  After Cloudflare Access is in front of the server, the `Cf-Access-Jwt-Assertion` JWT is injected on every request. Parse it server-side (verify signature against the Cloudflare JWKS endpoint for the Access application), extract the `email` claim, and pass it through `/api/config` so the header can show `@<email>`. No client-side JWT handling — verify only on the server.
  See: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

## Distribution

- [ ] **Docker Hub publish pipeline**
  Add a GitHub Actions workflow (`.github/workflows/publish.yml`) that builds and pushes a multi-arch image (`linux/amd64`, `linux/arm64`) to Docker Hub on every push to `main` and on version tags (`v*`). Steps:
  1. Log in with `docker/login-action` using `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repository secrets.
  2. Generate tags with `docker/metadata-action`: `latest` on `main`, `v1.2.3` + `v1.2` + `v1` on semver tags.
  3. Build and push with `docker/build-push-action` using `platforms: linux/amd64,linux/arm64` and `push: true`.
  4. Run a Trivy image scan (`aquasecurity/trivy-action`) against the pushed digest before the job completes — fail the workflow if HIGH or CRITICAL findings are present.
  5. Repository secrets needed: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (use a scoped access token, not the account password).
  6. Separate publish job from the existing CI jobs so a scan failure blocks publish but not test/lint.

## Multi-agent support

- [ ] **opencode integration** — see `docs/MULTI_AGENT_PLAN.md`
- [ ] **codex-cli integration** — see `docs/MULTI_AGENT_PLAN.md`
