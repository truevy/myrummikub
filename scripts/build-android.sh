#!/bin/bash
# Builds the Android app (an installable .apk) from the same web code as the
# Mac, Windows and iPhone apps.
#
#   scripts/build-android.sh      needs Java 17, the Android SDK (ANDROID_HOME) and gradle
#
# The file ends up in dist/Lyndas-Rummi-Time-<version>-android.apk. Without a
# signing key in the environment it is signed with a debug key, which is fine for
# installing it on a phone by hand (see docs/android.md). SKIP_TESTS=1 skips the tests.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"

if ! command -v gradle >/dev/null; then
  echo "gradle is needed to build the Android app (https://gradle.org/install, version 8.9 or newer)." >&2
  exit 1
fi
if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then
  echo "The Android SDK is needed: install Android Studio, or the command-line tools, and set ANDROID_HOME." >&2
  exit 1
fi

if [[ -z "${SKIP_TESTS:-}" ]]; then
  echo "==> Running tests"
  npm test --silent
fi

echo "==> Building the Android app $VERSION"
gradle -p android --no-daemon assembleRelease

APK="android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "The build did not produce $APK." >&2; exit 1; }
mkdir -p dist
cp "$APK" "dist/Lyndas-Rummi-Time-$VERSION-android.apk"
echo "    dist/Lyndas-Rummi-Time-$VERSION-android.apk"
