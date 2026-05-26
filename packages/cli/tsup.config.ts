import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'tsup';

/**
 * tsup bundles bin.js only; declarations come from `tsc -b` (composite).
 * Sets the exec bit on dist/bin.js post-build — tsup itself doesn't.
 */
export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  // Bundle the @basehalf/core workspace dep + citty into the CLI so
  // `node dist/bin.js` works as a standalone binary (no runtime resolve of
  // workspace packages, no separate runtime deps to ship). citty is pure ESM,
  // so bundling works cleanly (commander was CJS and broke dynamic require).
  noExternal: ['@basehalf/core', 'citty'],
  async onSuccess() {
    chmodSync(resolve('dist/bin.js'), 0o755);
  },
});
