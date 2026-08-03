#!/usr/bin/env bash
# Point git at the version-controlled hooks in .githooks/.
#
# Using core.hooksPath rather than copying into .git/hooks means the hooks stay
# under version control: a fix to the hook reaches everyone on their next pull,
# and nobody ends up running a stale copy.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "error: not a git repository (no .git directory found)" >&2
  exit 1
fi

chmod +x .githooks/*

git config core.hooksPath .githooks

echo "Hooks installed."
echo
echo "  pre-commit  secrets, conflict markers, oversized files, debug leftovers,"
echo "              lockfile sync, shellcheck, eslint, tests"
echo "  pre-push    direct-to-main block, full lint, full test suite"
echo
echo "Bypass a single commit with: git commit --no-verify"
echo "Uninstall with:              git config --unset core.hooksPath"
