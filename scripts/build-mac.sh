#!/bin/bash
# Builds a self-contained "Lynda's Rummi Time.app" (Electron runtime bundled inside) into dist/,
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
# The version is part of the app's name, so it is plain which build someone
# has. The game's data folder does not carry the version, so players and
# statistics stay put from one version to the next.
VERSION="$(node -p "require('./package.json').version")"
NAME="Lynda's Rummi Time $VERSION"
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
  --protocol=rummi-tummi --protocol-name="Rummi Time invitation" \
  --usage-description.Camera="Lynda's Rummi Time uses the camera to take a profile photo when a player registers." \
  --ignore='^/(test|scripts|build|dist|docs|ios|myrummikub|\.claude|\.git|\.gitignore|README\.md)($|/)' \
  "${ICON_ARG[@]}"

APP="$OUT/$NAME-darwin-$ARCH/$NAME.app"
ZIP="$OUT/Lyndas-Rummi-Time-$VERSION-mac-$ARCH.zip"
DMG="$OUT/Lyndas-Rummi-Time-$VERSION-mac-$ARCH.dmg"

# ---- signing ---------------------------------------------------------------
#
# With a "Developer ID Application" certificate in the keychain the app is
# signed with it (hardened runtime), and with notary credentials stored under
# $NOTARY_PROFILE it is also notarized by Apple and the ticket stapled on.
# Such an app opens on any Mac without a security override. Without the
# certificate the app is only signed ad hoc, which is enough for this Mac.
#
#   SIGN_IDENTITY="…"     use this identity instead of looking one up
#   NOTARY_PROFILE=name   the notarytool keychain profile (default below)
IDENTITY="${SIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)}"
NOTARY_PROFILE="${NOTARY_PROFILE:-rummi-tummi-notary}"
ENTITLEMENTS="build/entitlements.mac.plist"
SIGNED="ad hoc (opens on this Mac; other Macs need right-click › Open)"
CAN_NOTARIZE=no

notarize() { # $1: a .zip or .dmg to send to Apple; waits for the verdict
  xcrun notarytool submit "$1" --keychain-profile "$NOTARY_PROFILE" --wait
}

if [[ -n "$IDENTITY" ]]; then
  echo "==> Signing as $IDENTITY"
  # Inside out, one piece at a time. A single "deep" signature skips loose
  # libraries and helper tools inside the frameworks, and Apple's notary
  # service rejects the app for every binary left unsigned.
  sign() { codesign --force --options runtime --timestamp --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$1"; }
  # 1. loose binaries: libraries and helper tools that are not themselves the
  #    main program of a bundle (those are signed with their bundle below)
  while IFS= read -r -d '' f; do
    case "$f" in */Contents/MacOS/*) continue ;; esac
    if [[ "$f" == *.framework/* ]]; then
      owner="${f%%.framework/*}"
      [[ "$(basename "$f")" == "$(basename "$owner")" ]] && continue
    fi
    if file -b "$f" | grep -q "Mach-O"; then sign "$f"; fi
  done < <(find "$APP/Contents" -type f \( -name "*.dylib" -o -name "*.node" -o -perm -u+x \) -print0)
  # 2. nested bundles, deepest first, then 3. the app itself
  while IFS= read -r -d '' bundle; do
    sign "$bundle"
  done < <(find "$APP/Contents/Frameworks" -depth \( -name "*.framework" -o -name "*.app" \) -print0)
  sign "$APP"
  codesign --verify --deep --strict "$APP"
  SIGNED="$IDENTITY (not notarized: other Macs will still ask for an override)"
  if [[ "$IDENTITY" == "Developer ID Application:"* ]] && xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
    CAN_NOTARIZE=yes
    echo "==> Notarizing the app with Apple (this takes a few minutes)"
    NOTARY_ZIP="$(mktemp -d)/app.zip"
    ditto -c -k --keepParent "$APP" "$NOTARY_ZIP"
    notarize "$NOTARY_ZIP"
    xcrun stapler staple "$APP"
    rm -f "$NOTARY_ZIP"
    SIGNED="$IDENTITY, notarized by Apple (opens on any Mac without an override)"
  elif [[ "$IDENTITY" == "Developer ID Application:"* ]]; then
    echo "    No notary credentials under the profile \"$NOTARY_PROFILE\" — see docs/signing.md."
  fi
else
  # Apple silicon refuses to start unsigned code, an ad-hoc signature is enough locally.
  echo "==> Signing (ad hoc — no Developer ID certificate found, see docs/signing.md)"
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep "$APP"
fi

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
if [[ -n "$IDENTITY" ]]; then
  codesign --force --timestamp --sign "$IDENTITY" "$DMG"
  if [[ "$CAN_NOTARIZE" == yes ]]; then
    echo "==> Notarizing the disk image"
    notarize "$DMG"
    xcrun stapler staple "$DMG"
  fi
fi

echo
echo "Done:"
echo "  $APP"
echo "  $ZIP"
echo "  $DMG"
echo
echo "Signed: $SIGNED"
echo
echo "Open it with:  open \"$APP\""
