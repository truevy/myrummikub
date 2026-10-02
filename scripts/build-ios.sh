#!/bin/bash
# Builds the iPhone and iPad app (one app for both) from the same web code as
# the Mac and Windows apps.
#
#   scripts/build-ios.sh                 build for the iOS Simulator
#   scripts/build-ios.sh run             build, then install and start it on a simulator
#   scripts/build-ios.sh run "iPad (A16)"   …on the simulator with that name
#   scripts/build-ios.sh open            open the Xcode project, to run on your own
#                                        iPhone or iPad or to archive for TestFlight
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null; then
  echo "xcodegen is needed to create the Xcode project:  brew install xcodegen" >&2
  exit 1
fi

# The project file is generated from ios/project.yml, with the game's version.
export RK_VERSION="$(node -p "require('./package.json').version")"
export RK_BUILD="${RK_BUILD:-$(date +%Y%m%d%H%M)}"
node scripts/vendor-firebase.js >/dev/null
(cd ios && xcodegen generate >/dev/null)

MODE="${1:-build}"
if [[ "$MODE" == "open" ]]; then
  open ios/RummiTummi.xcodeproj
  exit 0
fi

echo "==> Running tests"
npm test --silent

echo "==> Building for the iOS Simulator"
xcodebuild -project ios/RummiTummi.xcodeproj -scheme RummiTummi \
  -sdk iphonesimulator -configuration Debug -derivedDataPath ios/build \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build \
  | grep -E "error:|warning: unre|BUILD (SUCCEEDED|FAILED)" || true

APP="ios/build/Build/Products/Debug-iphonesimulator/Rummi Time.app"
[[ -d "$APP" ]] || { echo "The build did not produce the app." >&2; exit 1; }
echo "    $APP"

if [[ "$MODE" == "run" ]]; then
  NAME="${2:-iPhone 17 Pro}"
  # several simulators can share a name: take the first one with it
  DEVICE="$(xcrun simctl list devices available | grep -F "    $NAME (" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1 || true)"
  if [[ -z "$DEVICE" ]]; then
    echo "No simulator called \"$NAME\". The ones available:" >&2
    xcrun simctl list devices available | grep -E "iPhone|iPad" >&2
    exit 1
  fi
  echo "==> Starting it on the \"$NAME\" simulator"
  xcrun simctl boot "$DEVICE" 2>/dev/null || true
  # The window that shows the simulator lives inside Xcode: "Simulator" in
  # older Xcodes, "DeviceHub" from Xcode 27. Open whichever is there.
  XCODE="$(xcode-select -p)"
  for viewer in "$XCODE/Applications/Simulator.app" "$XCODE/../Applications/DeviceHub.app"; do
    if [[ -d "$viewer" ]]; then open "$viewer" || true; break; fi
  done
  xcrun simctl bootstatus "$DEVICE" -b >/dev/null
  xcrun simctl install "$DEVICE" "$APP"
  xcrun simctl launch "$DEVICE" com.lyndasrummitummi.ios >/dev/null
  echo "    running"
fi
