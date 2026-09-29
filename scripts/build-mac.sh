#!/bin/bash
# Builds a self-contained "Tina's Rummikub.app" (Electron runtime bundled inside) into dist/.
#
#   scripts/build-mac.sh              build for this Mac's processor
#   ARCH=universal scripts/build-mac.sh   build for both Apple silicon and Intel
#   ARCH=x64 scripts/build-mac.sh     build for Intel only
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ "$(uname)" != "Darwin" ]]; then
  echo "This script has to run on macOS." >&2
  exit 1
fi

ARCH="${ARCH:-$(uname -m | sed 's/x86_64/x64/')}"
NAME="Tina's Rummikub"
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
  --ignore='^/(test|scripts|build|dist|myrummikub|\.claude|\.git|\.gitignore|README\.md)($|/)' \
  "${ICON_ARG[@]}"

APP="$OUT/$NAME-darwin-$ARCH/$NAME.app"
ZIP="$OUT/Tinas-Rummikub-mac-$ARCH.zip"

# Apple silicon refuses to start unsigned code, an ad-hoc signature is enough locally.
echo "==> Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP"

echo "==> Zipping"
ditto -c -k --keepParent "$APP" "$ZIP"

echo
echo "Done:"
echo "  $APP"
echo "  $ZIP"
echo
echo "Open it with:  open \"$APP\""
