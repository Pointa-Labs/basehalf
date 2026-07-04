#!/usr/bin/env bash
# Package + sign a BaseHalf macOS release from the vscode-base tree.
#
#   build/basehalf/package-darwin.sh [arm64|x64] [--no-build] [--notes-file path]
#
# Steps:
#   1. gulp vscode-darwin-<arch>-min  →  ../VSCode-darwin-<arch>/BaseHalf.app
#      (unsigned on purpose: no platform signing identity; release integrity
#      comes from the Ed25519 chain in sign-update.mjs / the in-app verifier)
#   2. ditto-zip the bundle           →  ../basehalf-dist/BaseHalf-<version>-darwin-<arch>.zip
#   3. sign-update.mjs                →  ../basehalf-dist/update-manifest-darwin-<arch>.json
#
# Upload the zip + manifest as release assets on the tag v<version>; the
# manifest must keep its exact asset name so releases/latest/download/ serves it.
set -euo pipefail

ARCH="arm64"
BUILD=1
NOTES_ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		arm64|x64) ARCH="$1"; shift ;;
		--no-build) BUILD=0; shift ;;
		--notes-file) NOTES_ARGS=(--notes-file "$2"); shift 2 ;;
		*) echo "Unknown argument: $1" >&2; exit 2 ;;
	esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./product.json').basehalfVersion")"

# vscode-base has no .git of its own (it lives inside the basehalf repo), so
# the build can't derive a commit — but the packaged product.json needs one
# (the update service is disabled without it). Feed it explicitly.
export BUILD_SOURCEVERSION="${BUILD_SOURCEVERSION:-$(git -C "$ROOT" rev-parse HEAD)}"
# The bundled copilot extension's own build script requires this even though
# BaseHalf excludes the extension from the final package.
export VSCODE_QUALITY="${VSCODE_QUALITY:-stable}"
APP_DIR="$(dirname "$ROOT")/VSCode-darwin-${ARCH}"
APP="${APP_DIR}/BaseHalf.app"
DIST="$(dirname "$ROOT")/basehalf-dist"
ZIP="${DIST}/BaseHalf-${VERSION}-darwin-${ARCH}.zip"

if [[ "$BUILD" == 1 ]]; then
	echo "▸ building minified darwin-${ARCH} package (this takes a while)…"
	npm run gulp -- "vscode-darwin-${ARCH}-min"
fi

if [[ ! -d "$APP" ]]; then
	echo "App bundle not found at $APP — build failed or --no-build without a prior build." >&2
	exit 1
fi

mkdir -p "$DIST"
rm -f "$ZIP"
echo "▸ zipping ${APP} → ${ZIP}"
/usr/bin/ditto -ck --keepParent "$APP" "$ZIP"

echo "▸ signing + writing manifest"
node build/basehalf/sign-update.mjs "$ZIP" --version "$VERSION" --asset "darwin-${ARCH}" ${NOTES_ARGS[@]+"${NOTES_ARGS[@]}"}

echo
echo "Done. Release assets in ${DIST}:"
ls -lh "$DIST" | sed -n '2,9p'
echo
echo "Publish with:"
echo "  gh release create v${VERSION} '${ZIP}' '${DIST}/update-manifest-darwin-${ARCH}.json' --title 'BaseHalf ${VERSION}' --notes-file <notes.md>"
