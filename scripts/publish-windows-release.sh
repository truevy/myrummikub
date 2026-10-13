#!/bin/bash
# Attaches the Windows zips in dist/ to the GitHub Release for a version, creating
# the release first if there is none. Used by the "Windows build" workflow
# (.github/workflows/windows.yml); needs the gh command-line tool and GH_TOKEN.
#
#   scripts/publish-windows-release.sh v3.0.2
#
# The release page https://github.com/<repo>/releases/latest then points at the
# newest version, and each zip has a fixed address:
#   .../releases/download/v3.0.2/Lyndas-Rummi-Time-3.0.2-windows-x64.zip
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${1:-}"
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Give the version tag, for example v3.0.2." >&2; exit 1; }
NUMBER="${TAG#v}"
DIST="${DIST_DIR:-dist}"

# the zips are named after the version in package.json, so the tag has to match it
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
if [[ "$NUMBER" != "$PACKAGE_VERSION" ]]; then
  echo "The tag is $TAG but package.json says $PACKAGE_VERSION, so the zips are named for $PACKAGE_VERSION. Use v$PACKAGE_VERSION." >&2
  exit 1
fi

shopt -s nullglob
FILES=("$DIST"/Lyndas-Rummi-Time-"$NUMBER"-windows-*.zip)
[[ ${#FILES[@]} -gt 0 ]] || { echo "No Windows zips for $NUMBER in $DIST/." >&2; exit 1; }

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Adding the Windows builds to the existing release $TAG."
else
  gh release create "$TAG" \
    --target "${GITHUB_SHA:-$(git rev-parse HEAD)}" \
    --title "Lynda's Rummi Time $TAG" \
    --notes "## Windows

Download **Lyndas-Rummi-Time-$NUMBER-windows-x64.zip** (most PCs) or **Lyndas-Rummi-Time-$NUMBER-windows-arm64.zip** (ARM PCs such as Surface Pro X and Snapdragon laptops). Unzip it anywhere and run **Lynda's Rummi Time $NUMBER.exe** inside the folder.

Windows may show a blue \"Windows protected your PC\" box because the game is not signed: choose **More info**, then **Run anyway**.

## Mac

The Mac disk image is added to this release separately."
fi

gh release upload "$TAG" "${FILES[@]}" --clobber

URL="$(gh release view "$TAG" --json url -q .url)"
echo
echo "Published: $URL"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Windows builds for $TAG"
    echo
    echo "Release page: $URL"
    for f in "${FILES[@]}"; do echo "- \`${f##*/}\`: ${URL/\/tag\//\/download\/}/${f##*/}"; done
  } >> "$GITHUB_STEP_SUMMARY"
fi
