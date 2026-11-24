#!/usr/bin/env bash
# Builds the fixture app for the tvOS Simulator with swiftc alone (no Xcode project), so the
# build is small, reviewable and reproducible on any Mac with Xcode and the tvOS platform.
#
#   fixtures/tvos-app/build.sh [out-dir]      # default out-dir: fixtures/tvos-app/build
#
# Env: ARCH (default: host arch), MIN_TVOS (default 17.0). Prints the .app path.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="$(mkdir -p "${1:-$here/build}" && cd "${1:-$here/build}" && pwd)"
arch="${ARCH:-$(uname -m)}"
min_tvos="${MIN_TVOS:-17.0}"
app="$out/ToetsFixture.app"

sdk="$(xcrun --sdk appletvsimulator --show-sdk-path)"
rm -rf "$app"
mkdir -p "$app"

xcrun --sdk appletvsimulator swiftc \
  -parse-as-library \
  -O \
  -target "$arch-apple-tvos$min_tvos-simulator" \
  -sdk "$sdk" \
  "$here"/Sources/*.swift \
  -o "$app/ToetsFixture"

sed "s/__MIN_TVOS__/$min_tvos/" "$here/Info.plist" >"$app/Info.plist"
plutil -lint -s "$app/Info.plist"
# Simulators accept ad hoc signatures.
codesign --force --sign - --timestamp=none "$app" 2>/dev/null

echo "$app"
