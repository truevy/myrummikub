#!/bin/bash
# Publishes the current version as a GitHub Release with the disk image and
# the zip attached. Invitations link to the releases page, so this is how
# someone without the app gets it.
#
#   scripts/release.sh        build and publish v<version from package.json>
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="v$(node -p "require('./package.json').version")"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "There are uncommitted changes. Commit them first, so the release matches the code." >&2
  exit 1
fi
if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Releases are made from main. Switch to main (after merging) and run this again." >&2
  exit 1
fi
if gh release view "$VERSION" >/dev/null 2>&1; then
  echo "$VERSION is already released. Raise \"version\" in package.json first." >&2
  exit 1
fi

scripts/build-mac.sh

DMG="dist/Lyndas-Rummikub-mac-universal.dmg"
ZIP="dist/Lyndas-Rummikub-mac-universal.zip"
[[ -f "$DMG" && -f "$ZIP" ]] || { echo "The build did not produce $DMG and $ZIP (was ARCH set?)." >&2; exit 1; }

gh release create "$VERSION" "$DMG" "$ZIP" \
  --title "Lynda's Rummikub $VERSION" \
  --notes "Download **Lyndas-Rummikub-mac-universal.dmg**, open it and drag the game to Applications. It runs on Apple silicon and Intel Macs.

The first time, macOS will refuse to open it because it is not from the App Store: right-click the app, choose **Open**, then **Open** again. After that it opens normally, and invitation links open it directly."

echo
echo "Released: $(gh release view "$VERSION" --json url -q .url)"
