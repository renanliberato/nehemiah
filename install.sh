#!/usr/bin/env bash
# Install quality-gate to /usr/local/bin
# Usage: sudo ./install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="/usr/local/bin/quality-gate"

if [ -L "$TARGET" ] || [ -f "$TARGET" ]; then
  echo "Removing existing: $TARGET"
  rm -f "$TARGET"
fi

ln -s "$SCRIPT_DIR/bin/quality-gate" "$TARGET"
echo "✓ Installed: $TARGET → $SCRIPT_DIR/bin/quality-gate"
