#!/bin/bash
# Installs (or updates) PHARMACOPOLA Monitor for Mac.
#
#   curl -fsSL https://jurajgre-72.github.io/pharma-monitor/install-mac.sh | bash
#
# Files downloaded with curl are not marked as "from the internet", so macOS opens the app without the
# "Apple could not verify…" block that apps from outside the App Store otherwise get. Replaces any earlier copy.
set -euo pipefail

URL="${PM_ZIP_URL:-https://github.com/JurajGre-72/JurajGre-72.github.io/releases/download/monitor-mac-latest/PHARMACOPOLA-Monitor-mac.zip}"
NAME="PHARMACOPOLA Monitor"

major="$(sw_vers -productVersion | cut -d. -f1)"
if [ "$major" -lt 11 ]; then
  echo "Sorry – PHARMACOPOLA Monitor needs macOS 11 (Big Sur) or newer. This Mac has $(sw_vers -productVersion)."
  echo "Use the dashboard in a browser instead: https://jurajgre-72.github.io/pharma-monitor/"
  exit 1
fi

DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloading PHARMACOPOLA Monitor…"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"

echo "→ Installing into $DEST"
osascript -e "quit app \"$NAME\"" >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST/$NAME.app"
ditto -x -k "$TMP/app.zip" "$DEST"
xattr -dr com.apple.quarantine "$DEST/$NAME.app" 2>/dev/null || true

version="$(defaults read "$DEST/$NAME.app/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?')"
echo "✓ Installed $NAME $version in $DEST"

if [ "${PM_NO_OPEN:-}" != "1" ]; then
  open "$DEST/$NAME.app"
  echo "  It is starting now and is also in Launchpad. Right-click its Dock icon → Options → Keep in Dock to pin it."
fi
