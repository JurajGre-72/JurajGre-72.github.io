#!/bin/bash
# Builds "PHARMACOPOLA Monitor.app" (universal: Apple silicon + Intel), a .zip for in-app updates and a .dmg
# for first installs. Runs on macOS with the Xcode command line tools (GitHub's macos runners have them).
set -euo pipefail
cd "$(dirname "$0")"

NAME="PHARMACOPOLA Monitor"
VERSION="$(tr -d '[:space:]' < VERSION)"
BUILD="${GITHUB_RUN_NUMBER:-1}"
OUT=build
APP="$OUT/$NAME.app"

rm -rf "$OUT"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "→ compiling $VERSION ($BUILD)"
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos11.0" -framework Cocoa -framework WebKit \
    Sources/main.swift -o "$OUT/main-$arch"
done
lipo -create "$OUT/main-arm64" "$OUT/main-x86_64" -output "$APP/Contents/MacOS/$NAME"

echo "→ Info.plist"
sed -e "s/__VERSION__/$VERSION/" -e "s/__BUILD__/$BUILD/" Info.plist > "$APP/Contents/Info.plist"
plutil -lint "$APP/Contents/Info.plist"

echo "→ icon"
ICONSET="$OUT/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s icon-1024.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) icon-1024.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "→ ad-hoc signature (not notarised)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "→ packages"
ditto -c -k --keepParent "$APP" "$OUT/PHARMACOPOLA-Monitor-mac.zip"
mkdir -p "$OUT/dmg"
cp -R "$APP" "$OUT/dmg/"
ln -s /Applications "$OUT/dmg/Applications"
hdiutil create -volname "$NAME" -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/PHARMACOPOLA-Monitor.dmg" >/dev/null

lipo -info "$APP/Contents/MacOS/$NAME"
ls -lh "$OUT"/*.zip "$OUT"/*.dmg
