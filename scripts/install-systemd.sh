#!/usr/bin/env bash
# Installs ccfleet and (optionally) ttyd as systemd system services on Linux.
# Services start at boot, before any user logs in.
#
# Usage:
#   sudo bash scripts/install-systemd.sh            # install
#   sudo bash scripts/install-systemd.sh uninstall  # remove

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Identify the target user (the one who invoked sudo, not root).
CCFLEET_USER="${SUDO_USER:-$USER}"
USER_HOME=$(getent passwd "$CCFLEET_USER" | cut -d: -f6)

SYSTEMD_DIR="/etc/systemd/system"
LOG_DIR="$USER_HOME/.local/share/ccfleet/logs"
ENV_FILE="$INSTALL_DIR/.env"

CCFLEET_SERVICE="ccfleet.service"
TTYD_SERVICE="ccfleet-ttyd.service"

# ---- helpers ----------------------------------------------------------------

die() { echo "ERROR: $*" >&2; exit 1; }

find_bin() {
  # Check well-known locations before falling back to PATH.
  local name="$1"
  local candidates=(
    "$USER_HOME/.local/bin/$name"
    "/usr/local/bin/$name"
    "/usr/bin/$name"
    "/opt/homebrew/bin/$name"
  )
  for c in "${candidates[@]}"; do
    [ -x "$c" ] && echo "$c" && return 0
  done
  command -v "$name" 2>/dev/null && return 0
  return 1
}

# ---- root check -------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash scripts/install-systemd.sh"

# ---- uninstall --------------------------------------------------------------

if [ "${1:-install}" = "uninstall" ]; then
  echo "Removing ccfleet systemd services..."

  for svc in "$CCFLEET_SERVICE" "$TTYD_SERVICE"; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      systemctl stop "$svc"
      echo "  stopped $svc"
    fi
    if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
      systemctl disable "$svc"
      echo "  disabled $svc"
    fi
    rm -f "$SYSTEMD_DIR/$svc"
    echo "  removed $svc"
  done

  systemctl daemon-reload
  echo "Done. Services will not start on next boot."
  exit 0
fi

# ---- preflight checks -------------------------------------------------------

[ -f "$ENV_FILE" ] || die ".env not found at $ENV_FILE — copy .env.example to .env and fill in GIT_ROOT first"

NODE_BIN=$(find_bin node) || die "node not found — install Node.js 20+ first (https://nodejs.org)"
echo "Using node: $NODE_BIN"

NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required, found v$NODE_VERSION"

# Check for .env file and GIT_ROOT
if ! grep -q "^GIT_ROOT=" "$ENV_FILE"; then
  die "GIT_ROOT is not set in $ENV_FILE — edit it and try again"
fi

# ---- build PATH for services ------------------------------------------------

# Include common locations where node, claude, tmux, and ttyd may live.
SERVICE_PATH="$USER_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$(dirname "$NODE_BIN")"

# ---- install ccfleet.service ------------------------------------------------

echo "Installing $CCFLEET_SERVICE..."

mkdir -p "$LOG_DIR"
chown "$CCFLEET_USER" "$LOG_DIR"

cat > "$SYSTEMD_DIR/$CCFLEET_SERVICE" <<EOF
[Unit]
Description=ccfleet — Claude Code session manager
Documentation=file://$INSTALL_DIR/README.md
After=network.target

[Service]
Type=simple
User=$CCFLEET_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
Environment=HOME=$USER_HOME
Environment=PATH=$SERVICE_PATH
ExecStart=$NODE_BIN $INSTALL_DIR/server.js
Restart=always
RestartSec=2
StandardOutput=append:$LOG_DIR/ccfleet.log
StandardError=append:$LOG_DIR/ccfleet-error.log

[Install]
WantedBy=multi-user.target
EOF

chmod 644 "$SYSTEMD_DIR/$CCFLEET_SERVICE"
echo "  wrote $SYSTEMD_DIR/$CCFLEET_SERVICE"

# ---- install ccfleet-ttyd.service (optional) --------------------------------

TTYD_BIN=$(find_bin ttyd 2>/dev/null || true)
TMUX_BIN=$(find_bin tmux 2>/dev/null || true)

if [ -z "$TTYD_BIN" ] || [ -z "$TMUX_BIN" ]; then
  echo "  ttyd or tmux not found — skipping $TTYD_SERVICE"
  echo "  Install ttyd and tmux, then re-run this script to add the terminal service."
else
  # Read optional port from .env, default 7681
  TTYD_PORT=$(grep "^TTYD_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "7681")
  TTYD_PORT="${TTYD_PORT:-7681}"

  echo "Installing $TTYD_SERVICE (ttyd: $TTYD_BIN, tmux: $TMUX_BIN)..."

  cat > "$SYSTEMD_DIR/$TTYD_SERVICE" <<EOF
[Unit]
Description=ccfleet ttyd — browser terminal for tmux
After=network.target

[Service]
Type=simple
User=$CCFLEET_USER
Environment=HOME=$USER_HOME
Environment=PATH=$SERVICE_PATH
# -A: attach to existing session or create 'main' — avoids crash-loop at boot.
ExecStart=$TTYD_BIN -p $TTYD_PORT -W $TMUX_BIN new-session -A -s main
Restart=always
RestartSec=2
StandardOutput=append:$LOG_DIR/ttyd.log
StandardError=append:$LOG_DIR/ttyd-error.log

[Install]
WantedBy=multi-user.target
EOF

  chmod 644 "$SYSTEMD_DIR/$TTYD_SERVICE"
  echo "  wrote $SYSTEMD_DIR/$TTYD_SERVICE"
fi

# ---- enable and start -------------------------------------------------------

systemctl daemon-reload

systemctl enable --now "$CCFLEET_SERVICE"
echo "  enabled and started $CCFLEET_SERVICE"

if [ -f "$SYSTEMD_DIR/$TTYD_SERVICE" ]; then
  systemctl enable --now "$TTYD_SERVICE"
  echo "  enabled and started $TTYD_SERVICE"
fi

# ---- summary ----------------------------------------------------------------

echo ""
echo "Done. Services will start automatically at boot."
echo ""
echo "Logs:          $LOG_DIR"
echo "Health check:  curl http://localhost:3001/healthz"
echo ""
echo "Useful commands:"
echo "  systemctl status ccfleet"
echo "  systemctl status ccfleet-ttyd"
echo "  journalctl -u ccfleet -f"
echo "  sudo systemctl stop ccfleet"
echo "  sudo systemctl start ccfleet"
echo "  sudo bash scripts/install-systemd.sh uninstall"
