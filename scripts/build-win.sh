#!/bin/bash
# Builds Lynda's Rummi Time for Windows (from a Mac) into dist/: one folder and one
# zip per processor type. Unzip anywhere and run "Lynda's Rummi Time.exe".
#
#   scripts/build-win.sh                 build for Intel/AMD (x64) and ARM (arm64)
#   ARCHS="x64" scripts/build-win.sh     build for one of them
set -euo pipefail

cd "$(dirname "$0")/.."

ARCHS="${ARCHS:-x64 arm64}"
VERSION="$(node -p "require('./package.json').version")"
NAME="Lynda's Rummi Time $VERSION" # the version is part of the name; the data folder does not carry it
OUT="dist"
ICON="build/icon.ico"

echo "==> Installing dependencies"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

echo "==> Running tests"
npm test --silent

# The icon is drawn from build/icon.svg with tools that ship with macOS.
if [[ ! -f "$ICON" || build/icon.svg -nt "$ICON" ]]; then
  echo "==> Making the Windows icon"
  TMP="$(mktemp -d)"
  if qlmanage -t -s 1024 -o "$TMP" build/icon.svg >/dev/null 2>&1 && [[ -f "$TMP/icon.svg.png" ]]; then
    sips -z 256 256 "$TMP/icon.svg.png" --out "$TMP/icon256.png" >/dev/null
    node scripts/make-ico.js "$TMP/icon256.png" "$ICON"
  else
    echo "    could not render the icon, the default Electron icon will be used"
  fi
  rm -rf "$TMP"
fi

ICON_ARG=()
[[ -f "$ICON" ]] && ICON_ARG=(--icon="$ICON")

for ARCH in $ARCHS; do
  echo "==> Packaging $NAME for Windows $ARCH"
  npx --yes @electron/packager@18 . "$NAME" \
    --platform=win32 \
    --arch="$ARCH" \
    --out="$OUT" \
    --overwrite \
    --prune=true \
    --win32metadata.CompanyName="Lynda's Rummi Time" \
    --win32metadata.ProductName="$NAME" \
    --win32metadata.FileDescription="Lynda's Rummi Time" \
    --ignore='^/(test|scripts|build|dist|docs|ios|functions|myrummikub|\.claude|\.git|\.gitignore|README\.md|firebase\.json|firebase-debug\.log|[^/]*\.p8)($|/)' \
    "${ICON_ARG[@]}"

  ZIP="$OUT/Lyndas-Rummi-Time-$VERSION-windows-$ARCH.zip"
  rm -f "$ZIP"
  (cd "$OUT" && zip -r -q -X "$(basename "$ZIP")" "$NAME-win32-$ARCH")
  echo "    $ZIP"
done

echo
echo "Done. On Windows: unzip, open the folder and run \"$NAME.exe\"."
