# BaseHalf workbench vendor bundle

`yjs.bundle.js` is a workbench ESM-loader-safe bundle of the root npm
dependencies `yjs` and `lib0`.

Why it exists:

- VS Code workbench sources load as browser ESM from `out/`.
- Bare runtime imports such as `import ... from 'yjs'` are not resolved there.
- `yjs/dist/yjs.mjs` itself imports many bare `lib0/*` modules, so a direct
  relative import to the npm package still fails at Electron runtime.

Regenerate after dependency upgrades from `vscode-base/`:

```sh
./extensions/node_modules/.bin/esbuild node_modules/yjs/dist/yjs.mjs \
  --bundle \
  --format=esm \
  --platform=browser \
  --target=es2022 \
  --banner:js='/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *
 *  Bundles yjs 13.6.30 and lib0 0.2.117 for the VS Code workbench ESM loader.
 *  Their MIT licenses are available in node_modules/yjs/LICENSE and node_modules/lib0/LICENSE.
 *--------------------------------------------------------------------------------------------*/' \
  --outfile=src/vs/workbench/basehalf/common/vendor/yjs.bundle.js
```

The bundled packages are MIT licensed:

- `yjs` 13.6.30: https://github.com/yjs/yjs
- `lib0` 0.2.117: https://github.com/dmonad/lib0
