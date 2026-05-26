import { defineConfig } from 'tsup';

/**
 * tsup bundles .js only — declarations are emitted by `tsc -b` (composite project).
 * The `build` script runs `tsc -b && tsup`; `clean: false` so tsc's .d.ts survives.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  dts: false,
  clean: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
