# Packaging inputs

- `icon-source.png` — the Pointa Labs mark (the GitHub org avatar is the
  canonical copy; re-fetch from `https://github.com/Pointa-Labs.png` if it
  ever changes upstream).
- `icon.icns` — the macOS app icon consumed by electron-builder.
- `dmg-background.png` (+ `@2x`) — the installer-window art: drag instruction,
  arrow between the two icon spots (electron-builder.yml's dmg.contents at
  x=180/x=480, y=195, iconSize 120 — keep them in sync), and the one-time
  first-launch terminal command. Regenerate like the icon: a throwaway HTML
  page at 660×420 CSS px → offscreen Electron capture (retina = 1320×840 =
  the @2x) → `sips -z 420 660` for the 1x.

## Release flow (self-update feed)

Every release must ship three assets, or installed apps can't find/verify it:

1. `pnpm dist:mac` → `dist/BaseHalf-<version>-arm64.{dmg,zip}`.
2. `node scripts/sign-update.mjs dist/BaseHalf-<version>-arm64.zip` → signs
   the zip with the project's Ed25519 update key and writes
   `dist/update-manifest-darwin-arm64.json` (it refuses to run if the key
   doesn't match the public key embedded in `src/main/update-protocol.ts`).
3. `gh release create v<version> dist/BaseHalf-<version>-arm64.dmg
   dist/BaseHalf-<version>-arm64.zip dist/update-manifest-darwin-arm64.json`.

Installed apps poll `releases/latest/download/update-manifest-darwin-arm64.json`
(background, a few hours apart; manual via Settings ▸ Updates), verify the
zip's signature against the embedded public key, swap their own bundle, and
relaunch. The private key lives ONLY at
`~/Library/Application Support/basehalf-release/update-signing.pem` on the
release machine — back it up; losing it strands every installed copy
(they'd need a manual re-download). `scripts/sign-update.mjs --init`
generates a fresh pair if you're bootstrapping a new key on purpose.

Regenerating `icon.icns` (no design tools needed): compose the mark centered
on the standard macOS rounded tile (1024 canvas, 824×824 tile at 100px
margins, radius 185, white→#eef1f7 gradient) in a throwaway HTML page, render
it with an offscreen Electron `capturePage` (a retina display yields 2048px),
then `sips` down to the ten iconset sizes and `iconutil -c icns`. Run the
capture script with `env -u ELECTRON_RUN_AS_NODE` and keep it CJS.
