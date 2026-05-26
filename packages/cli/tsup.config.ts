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
  // Bundle the @basehalf/core workspace dep into the CLI so `node dist/bin.js`
  // works without resolving symlinked workspace packages at runtime.
  noExternal: ['@basehalf/core'],
  async onSuccess() {
    chmodSync(resolve('dist/bin.js'), 0o755);
  },
});
