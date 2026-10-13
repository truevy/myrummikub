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
#   a push to main      v<version in package.json>, but only if it has no release yet,
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
  if gh release view "$TAG" >/dev/null 2>&1; then
    echo "$TAG is already released: nothing to do." >&2
    BUILD=false
  fi
fi

echo "tag=$TAG"
echo "build=$BUILD"
