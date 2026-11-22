#!/usr/bin/env bash
# Rebuilds assets/dpad-key-hold.jar (a dex jar run on the device with app_process).
# Needs the Android SDK (ANDROID_HOME) with a platform and build-tools installed, and a JDK.
# The jar is committed so installing the npm package needs no Android build tools.
set -euo pipefail

cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
PLATFORM="$(ls -d "$SDK"/platforms/android-* | sort -V | tail -1)"
BUILD_TOOLS="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

javac --release 11 -Xlint:-options -cp "$PLATFORM/android.jar" -d "$OUT/classes" \
  src/tv/dpad/helper/KeyHold.java
"$BUILD_TOOLS/d8" --min-api 26 --release --lib "$PLATFORM/android.jar" \
  --output "$OUT/dpad-key-hold.jar" "$OUT"/classes/tv/dpad/helper/*.class
cp "$OUT/dpad-key-hold.jar" ../assets/dpad-key-hold.jar
echo "Built assets/dpad-key-hold.jar"
