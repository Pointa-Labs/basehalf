# Packaging inputs

- `icon-source.png` — the Pointa Labs mark (the GitHub org avatar is the
  canonical copy; re-fetch from `https://github.com/Pointa-Labs.png` if it
  ever changes upstream).
- `icon.icns` — the macOS app icon consumed by electron-builder.

Regenerating `icon.icns` (no design tools needed): compose the mark centered
on the standard macOS rounded tile (1024 canvas, 824×824 tile at 100px
margins, radius 185, white→#eef1f7 gradient) in a throwaway HTML page, render
it with an offscreen Electron `capturePage` (a retina display yields 2048px),
then `sips` down to the ten iconset sizes and `iconutil -c icns`. Run the
capture script with `env -u ELECTRON_RUN_AS_NODE` and keep it CJS.
