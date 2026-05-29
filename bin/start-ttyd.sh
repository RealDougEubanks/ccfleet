#!/usr/bin/env bash
# Starts ttyd attached to tmux. Access control is handled by Cloudflare Access.
# Managed by launchd (com.ccfleet.ttyd) — do not run manually unless debugging.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

TTYD_PORT="${TTYD_PORT:-7681}"

# -A: attach to 'main' if it exists, create it if not.
# This avoids a crash loop at boot when no tmux server is running yet.
exec /opt/homebrew/bin/ttyd \
  -p "$TTYD_PORT" \
  -W \
  /opt/homebrew/bin/tmux new-session -A -s main
