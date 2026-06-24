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

All steps run from the REPO ROOT. Every release must ship three assets, or
installed apps can't find/verify it:

0. `pnpm bump <x.y.z|patch|minor|major>` → sets the version in the root and
   desktop `package.json` in lockstep (the single source of truth; never
   hand-edit one without the other).
1. `pnpm --filter @basehalf/desktop dist:mac` →
   `packages/desktop/dist/BaseHalf-<version>-arm64.{dmg,zip}`.
2. `node packages/desktop/scripts/sign-update.mjs
   packages/desktop/dist/BaseHalf-<version>-arm64.zip` → signs the zip AND the
   manifest metadata with the project's Ed25519 update key and writes
   `packages/desktop/dist/update-manifest-darwin-arm64.json` (it refuses to run
   if the key doesn't match the public key embedded in
   `src/main/update-protocol.ts`).
3. `gh release create v<version>
   packages/desktop/dist/BaseHalf-<version>-arm64.dmg
   packages/desktop/dist/BaseHalf-<version>-arm64.zip
   packages/desktop/dist/update-manifest-darwin-arm64.json`.

Installed apps poll `releases/latest/download/update-manifest-darwin-arm64.json`
(background: shortly after launch, hourly, and on window focus — throttled — so a
new release surfaces on its own in the title-bar chip with no manual step; an
explicit "Check for Updates…" app-menu item is also there), verify BOTH the
manifest signature (so the
version/url can't be forged) and the downloaded zip's signature against the
embedded public key, swap their own bundle, and relaunch. The private key lives
ONLY at
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
