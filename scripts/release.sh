#!/bin/bash
# Publishes the current version as a GitHub Release with the Mac disk image
# and zip and the Windows zips attached. Invitations link to the releases
# page, so this is how someone without the game gets it.
#
#   scripts/release.sh        build everything and publish v<version from package.json>
set -euo pipefail

cd "$(dirname "$0")/.."

NUMBER="$(node -p "require('./package.json').version")"
VERSION="v$NUMBER"
BRANCH="$(git branch --show-current)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "There are uncommitted changes. Commit them first, so the release matches the code." >&2
  exit 1
fi
git fetch -q origin "$BRANCH" 2>/dev/null || true
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$BRANCH" 2>/dev/null || echo none)" ]]; then
  echo "This commit is not on GitHub yet. Push the branch first, so the release can point at it." >&2
  exit 1
fi
if gh release view "$VERSION" >/dev/null 2>&1; then
  echo "$VERSION is already released. Raise \"version\" in package.json first." >&2
  exit 1
fi

scripts/build-mac.sh
scripts/build-win.sh

FILES=(
  "dist/Lyndas-Rummi-Tummi-$NUMBER-mac-universal.dmg"
  "dist/Lyndas-Rummi-Tummi-$NUMBER-mac-universal.zip"
  "dist/Lyndas-Rummi-Tummi-$NUMBER-windows-x64.zip"
  "dist/Lyndas-Rummi-Tummi-$NUMBER-windows-arm64.zip"
)
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || { echo "The build did not produce $f." >&2; exit 1; }
done

gh release create "$VERSION" "${FILES[@]}" \
  --target "$(git rev-parse HEAD)" \
  --title "Lynda's Rummi Tummi $VERSION" \
  --notes "## Mac (Apple silicon and Intel)

Download **Lyndas-Rummi-Tummi-$NUMBER-mac-universal.dmg**, open it and drag the game to Applications.

The first time, macOS will refuse to open it because it is not from the App Store: right-click the app, choose **Open**, then **Open** again. After that it opens normally, and invitation links open it directly.

## Windows

Download **Lyndas-Rummi-Tummi-$NUMBER-windows-x64.zip** (most PCs) or **Lyndas-Rummi-Tummi-$NUMBER-windows-arm64.zip** (ARM PCs such as Surface Pro X and Snapdragon laptops). Unzip it anywhere and run **Lynda's Rummi Tummi $NUMBER.exe** inside the folder.

Windows may show a blue \"Windows protected your PC\" box because the game is not signed: choose **More info**, then **Run anyway**."

echo
echo "Released: $(gh release view "$VERSION" --json url -q .url)"
