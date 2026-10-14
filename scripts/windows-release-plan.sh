#!/bin/bash
# Decides what the "Windows build" workflow (.github/workflows/windows.yml) does for the
# event that started it, and prints it as key=value lines for $GITHUB_OUTPUT:
#
#   tag=<vX.Y.Z or empty>   the release to publish to; empty: only keep the zips
#   build=<true|false>      false: this version is already released, so do nothing
#
# Started by         tag
#   pushing a tag       that tag
#   Run workflow        the "tag" typed in (empty is fine)
#   a push to main      v<version in package.json>, but only if it has no release with the
#                       Windows zips yet,
#                       so merging a version bump publishes it once, and nothing else does
#
# Environment: EVENT (github.event_name), REF_TYPE, REF_NAME, INPUT_TAG; needs gh and GH_TOKEN.
set -euo pipefail

cd "$(dirname "$0")/.."

EVENT="${EVENT:-}"
TAG=""
BUILD=true

if [[ "$EVENT" == "push" && "${REF_TYPE:-}" == "tag" ]]; then
  TAG="${REF_NAME:-}"
elif [[ "$EVENT" == "workflow_dispatch" ]]; then
  TAG="${INPUT_TAG:-}"
else
  TAG="v$(node -p "require('./package.json').version")"
  # released means the Windows zips are there: a release that was created but never got
  # its files (a failed run) is filled in by the next run
  if gh release view "$TAG" --json assets -q '.assets[].name' 2>/dev/null | grep -q -- '-windows-.*\.zip$'; then
    echo "$TAG is already released: nothing to do." >&2
    BUILD=false
  fi
fi

echo "tag=$TAG"
echo "build=$BUILD"
