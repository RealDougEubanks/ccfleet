#!/usr/bin/env bash
# Installs ccfleet and ttyd as macOS LaunchDaemons (boot-time, pre-login).
# Must be run with sudo.
#
# Usage: sudo bash scripts/install-launchd.sh
#        sudo bash scripts/install-launchd.sh uninstall

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Identify the target user (the one who invoked sudo, not root).
CCFLEET_USER="${SUDO_USER:-$USER}"
USER_HOME=$(dscl . -read "/Users/$CCFLEET_USER" NFSHomeDirectory 2>/dev/null \
  | awk '{print $2}' || echo "/Users/$CCFLEET_USER")

LAUNCH_DAEMONS="/Library/LaunchDaemons"
LOG_DIR="$USER_HOME/Library/Logs/ccfleet"
ENV_FILE="$INSTALL_DIR/.env"

SERVICES=(com.ccfleet com.ccfleet.ttyd)

die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash scripts/install-launchd.sh"

# ---- uninstall --------------------------------------------------------------

if [ "${1:-install}" = "uninstall" ]; then
  echo "Uninstalling ccfleet LaunchDaemons..."
  for svc in "${SERVICES[@]}"; do
    PLIST="$LAUNCH_DAEMONS/${svc}.plist"
    if launchctl list | grep -q "$svc"; then
      launchctl bootout system "$PLIST" 2>/dev/null || true
      echo "  stopped $svc"
    fi
    rm -f "$PLIST"
    echo "  removed ${svc}.plist"
  done
  echo "Done. Services will not start on next boot."
  exit 0
fi

# ---- preflight checks -------------------------------------------------------

[ -f "$ENV_FILE" ] || die ".env not found at $ENV_FILE — copy .env.example to .env and fill in GIT_ROOT first"

if ! grep -q "^GIT_ROOT=" "$ENV_FILE"; then
  die "GIT_ROOT is not set in $ENV_FILE — edit it and try again"
fi

NODE_BIN=$(command -v node 2>/dev/null \
  || ls /opt/homebrew/bin/node /usr/local/bin/node 2>/dev/null | head -1 \
  || die "node not found — install Node.js 20+ first")

NODE_VERSION=$("$NODE_BIN" --version 2>/dev/null | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ required, found v$NODE_VERSION"

echo "Using node:        $NODE_BIN"
echo "Install directory: $INSTALL_DIR"
echo "Run-as user:       $CCFLEET_USER"
echo "Home:              $USER_HOME"
echo "Logs:              $LOG_DIR"
echo ""

# ---- create log directory ---------------------------------------------------

mkdir -p "$LOG_DIR"
chown "$CCFLEET_USER" "$LOG_DIR"

# ---- generate and install com.ccfleet.plist ---------------------------------

CCFLEET_PLIST="$LAUNCH_DAEMONS/com.ccfleet.plist"

if launchctl list | grep -q "com.ccfleet$"; then
  echo "Stopping existing com.ccfleet..."
  launchctl bootout system "$CCFLEET_PLIST" 2>/dev/null || true
fi

cat > "$CCFLEET_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ccfleet</string>

  <key>UserName</key>
  <string>$CCFLEET_USER</string>

  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$INSTALL_DIR/server.js</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>$USER_HOME</string>
  </dict>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/ccfleet.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/ccfleet-error.log</string>

  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
EOF

chown root:wheel "$CCFLEET_PLIST"
chmod 644 "$CCFLEET_PLIST"
launchctl bootstrap system "$CCFLEET_PLIST"
echo "  installed and started com.ccfleet"

# ---- generate and install com.ccfleet.ttyd.plist ----------------------------

TTYD_PLIST="$LAUNCH_DAEMONS/com.ccfleet.ttyd.plist"

if launchctl list | grep -q "com.ccfleet.ttyd"; then
  echo "Stopping existing com.ccfleet.ttyd..."
  launchctl bootout system "$TTYD_PLIST" 2>/dev/null || true
fi

cat > "$TTYD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ccfleet.ttyd</string>

  <key>UserName</key>
  <string>$CCFLEET_USER</string>

  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_DIR/bin/start-ttyd.sh</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>$USER_HOME</string>
  </dict>

  <key>KeepAlive</key>
  <true/>

  <key>RunAtLoad</key>
  <true/>

  <key>StandardOutPath</key>
  <string>$LOG_DIR/ttyd.log</string>

  <key>StandardErrorPath</key>
  <string>$LOG_DIR/ttyd-error.log</string>

  <key>ThrottleInterval</key>
  <integer>5</integer>
</dict>
</plist>
EOF

chown root:wheel "$TTYD_PLIST"
chmod 644 "$TTYD_PLIST"
launchctl bootstrap system "$TTYD_PLIST"
echo "  installed and started com.ccfleet.ttyd"

# ---- summary ----------------------------------------------------------------

echo ""
echo "Done. Both services will start automatically at boot."
echo "Logs: $LOG_DIR"
echo ""
echo "Check status:  launchctl list | grep ccfleet"
echo "Stop ccfleet:  sudo launchctl bootout system $CCFLEET_PLIST"
echo "Stop ttyd:     sudo launchctl bootout system $TTYD_PLIST"
