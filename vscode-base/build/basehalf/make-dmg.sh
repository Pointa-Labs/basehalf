#!/usr/bin/env bash
# Build the branded BaseHalf installer DMG from a packaged .app.
#
#   build/basehalf/make-dmg.sh <path-to-BaseHalf.app> <output.dmg> [volume-title]
#
# Replicates the layout the background art was drawn for (electron-builder
# config of the previous BaseHalf desktop package): 660x420 window, 120pt
# icons, app at (180,195), /Applications link at (480,195). The background
# carries the drag instruction AND the one-time first-launch quarantine-clear
# command — the app is intentionally unsigned (no platform signing identity;
# release integrity comes from the Ed25519 self-update chain), so spelling the
# command out in the installer beats a release-notes footnote.
#
# Uses hdiutil + Finder scripting only (no extra tooling). Finder automation
# may prompt for permission on first use.
set -euo pipefail

APP="${1:?usage: make-dmg.sh <BaseHalf.app> <output.dmg> [title]}"
OUT="${2:?usage: make-dmg.sh <BaseHalf.app> <output.dmg> [title]}"
TITLE="${3:-BaseHalf}"
ASSETS="$(cd "$(dirname "${BASH_SOURCE[0]}")/assets" && pwd)"

[[ -d "$APP" ]] || { echo "app bundle not found: $APP" >&2; exit 1; }

STAGE="$(mktemp -d /tmp/bh-dmg-XXXXXX)"
RW_DMG="$STAGE/rw.dmg"
trap 'hdiutil detach "$MOUNT" -quiet 2>/dev/null || true; rm -rf "$STAGE"' EXIT

echo "▸ staging"
mkdir -p "$STAGE/root/.background"
/usr/bin/ditto "$APP" "$STAGE/root/$(basename "$APP")"
ln -s /Applications "$STAGE/root/Applications"
# Single multi-representation TIFF so Finder picks the retina art on hidpi.
/usr/bin/tiffutil -cathidpicheck "$ASSETS/dmg-background.png" "$ASSETS/dmg-background@2x.png" \
	-out "$STAGE/root/.background/background.tiff"

echo "▸ creating writable image"
hdiutil create -srcfolder "$STAGE/root" -volname "$TITLE" -fs HFS+ \
	-format UDRW -o "$RW_DMG" -quiet

MOUNT="/Volumes/$TITLE"
hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
# NOT -nobrowse: Finder can only script volumes it can see.
hdiutil attach "$RW_DMG" -mountpoint "$MOUNT" -quiet

echo "▸ applying Finder layout"
/usr/bin/osascript <<EOF
with timeout of 120 seconds
tell application "Finder"
	tell disk "$TITLE"
		open
		set current view of container window to icon view
		set toolbar visible of container window to false
		set statusbar visible of container window to false
		set the bounds of container window to {200, 200, 860, 620}
		set viewOptions to the icon view options of container window
		set arrangement of viewOptions to not arranged
		set icon size of viewOptions to 120
		set background picture of viewOptions to file ".background:background.tiff"
		set position of item "$(basename "$APP")" of container window to {180, 195}
		set position of item "Applications" of container window to {480, 195}
		close
	end tell
end tell
end timeout
EOF
sync

hdiutil detach "$MOUNT" -quiet

echo "▸ compressing"
rm -f "$OUT"
hdiutil convert "$RW_DMG" -format UDZO -imagekey zlib-level=9 -o "$OUT" -quiet

echo "Done: $OUT"
ls -lh "$OUT"
