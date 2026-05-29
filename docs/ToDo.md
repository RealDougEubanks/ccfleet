# ToDo

## Authentication & Security

- [ ] **Read Cf-Access-Jwt-Assertion header to populate user identity in GUI**
  After Cloudflare Access is in front of the server, the `Cf-Access-Jwt-Assertion` JWT is injected on every request. Parse it server-side (verify signature against the Cloudflare JWKS endpoint for the Access application), extract the `email` claim, and pass it through `/api/config` so the header can show `@<email>`. No client-side JWT handling — verify only on the server.
  See: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

## Multi-agent support

- [ ] **opencode integration** — see `docs/MULTI_AGENT_PLAN.md`
- [ ] **codex-cli integration** — see `docs/MULTI_AGENT_PLAN.md`
