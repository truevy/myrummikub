#!/bin/bash
# Builds the Mac App Store app (the iPhone and iPad app, through Mac Catalyst)
# and uploads it to App Store Connect, under the same app record and version.
#
# Needs, once: an app record for the bundle id com.lyndasrummitummi.ios on
# App Store Connect (see docs/ios.md), and your Apple ID signed in to Xcode.
#
#   scripts/testflight-mac.sh
set -euo pipefail

cd "$(dirname "$0")/.."

export RK_VERSION="$(node -p "require('./package.json').version")"
# every upload needs a build number Apple has not seen before
export RK_BUILD="${RK_BUILD:-$(date +%Y%m%d%H%M)}"

echo "==> Running tests"
[[ -n "${SKIP_TESTS:-}" ]] || npm test --silent

node scripts/vendor-firebase.js >/dev/null
(cd ios && xcodegen generate >/dev/null)

ARCHIVE="ios/build/RummiTummi-mac.xcarchive"
echo "==> Archiving version $RK_VERSION (build $RK_BUILD)"
rm -rf "$ARCHIVE"
xcodebuild archive -project ios/RummiTummi.xcodeproj -scheme RummiTummi \
  -configuration Release -destination 'generic/platform=macOS,variant=Mac Catalyst' \
  -archivePath "$ARCHIVE" -derivedDataPath ios/build -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" || true
[[ -d "$ARCHIVE" ]] || { echo "The archive was not created." >&2; exit 1; }

echo "==> Uploading to App Store Connect"
rm -rf ios/build/export-mac
if ! xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/export-mac \
  -allowProvisioningUpdates 2>&1 | tee ios/build/upload-mac.log | grep -E "error|App record|Upload succeeded|EXPORT (SUCCEEDED|FAILED)"; then
  true
fi
if grep -q "EXPORT SUCCEEDED" ios/build/upload-mac.log; then
  echo
  echo "Uploaded. Apple processes a build for 10–30 minutes; it then appears at"
  echo "https://appstoreconnect.apple.com under your app › TestFlight › macOS."
else
  echo
  echo "The upload did not go through — see the lines above and docs/ios.md." >&2
  exit 1
fi
