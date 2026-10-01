#!/bin/bash
# Builds a self-contained "Lynda's Rummi Tummi.app" (Electron runtime bundled inside) into dist/,
# plus a zip and a disk image (.dmg) of it.
#
#   scripts/build-mac.sh              build one app for both Apple silicon and Intel
#   ARCH=arm64 scripts/build-mac.sh   build for Apple silicon only (smaller, faster to build)
#   ARCH=x64 scripts/build-mac.sh     build for Intel only
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script has to run on macOS." >&2
  exit 1
fi

# One app that runs on both Apple silicon and Intel Macs, unless ARCH says otherwise.
ARCH="${ARCH:-universal}"
NAME="Lynda's Rummi Tummi"
OUT="dist"
ICON="build/icon.icns"

echo "==> Installing dependencies"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

echo "==> Running tests"
npm test --silent

# The icon is drawn from build/icon.svg with tools that ship with macOS.
if [[ ! -f "$ICON" || build/icon.svg -nt "$ICON" ]]; then
  echo "==> Making the app icon"
  TMP="$(mktemp -d)"
  if qlmanage -t -s 1024 -o "$TMP" build/icon.svg >/dev/null 2>&1 && [[ -f "$TMP/icon.svg.png" ]]; then
    SET="$TMP/icon.iconset"
    mkdir "$SET"
    for size in 16 32 128 256 512; do
      sips -z $size $size "$TMP/icon.svg.png" --out "$SET/icon_${size}x${size}.png" >/dev/null
      sips -z $((size * 2)) $((size * 2)) "$TMP/icon.svg.png" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$SET" -o "$ICON"
  else
    echo "    could not render the icon, the default Electron icon will be used"
  fi
  rm -rf "$TMP"
fi

ICON_ARG=()
[[ -f "$ICON" ]] && ICON_ARG=(--icon="$ICON")

echo "==> Packaging $NAME.app for $ARCH"
npx --yes @electron/packager@18 . "$NAME" \
  --platform=darwin \
  --arch="$ARCH" \
  --out="$OUT" \
  --overwrite \
  --prune=true \
  --app-bundle-id=com.myrummikub.app \
  --app-category-type=public.app-category.board-games \
  --protocol=rummi-tummi --protocol-name="Rummi Tummi invitation" \
  --usage-description.Camera="Lynda's Rummi Tummi uses the camera to take a profile photo when a player registers." \
  --ignore='^/(test|scripts|build|dist|docs|myrummikub|\.claude|\.git|\.gitignore|README\.md)($|/)' \
  "${ICON_ARG[@]}"

APP="$OUT/$NAME-darwin-$ARCH/$NAME.app"
ZIP="$OUT/Lyndas-Rummi-Tummi-mac-$ARCH.zip"
DMG="$OUT/Lyndas-Rummi-Tummi-mac-$ARCH.dmg"

# Apple silicon refuses to start unsigned code, an ad-hoc signature is enough locally.
echo "==> Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"

echo "==> Zipping"
ditto -c -k --keepParent "$APP" "$ZIP"

# A disk image with the app next to a shortcut to Applications, for drag-to-install.
echo "==> Making the disk image"
STAGE="$(mktemp -d)"
ditto "$APP" "$STAGE/$NAME.app"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo
echo "Done:"
echo "  $APP"
echo "  $ZIP"
echo "  $DMG"
echo
echo "Open it with:  open \"$APP\""
