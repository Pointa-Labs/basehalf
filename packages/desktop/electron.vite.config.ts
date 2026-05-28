import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Main and preload emit as CommonJS (.cjs). Electron's `electron` npm package
// is a path-resolver stub; only its runtime CJS module hook returns the real
// API. ESM `import 'electron'` bypasses the hook and gets the binary path (a
// string), which destructures to undefined and crashes at first API call.
// Renderer stays ESM (Vite handles it).
//
// `@basehalf/core` is excluded from externalize so rollup bundles its ESM into
// the CJS main output — CJS can't `require()` an ESM-only package at runtime,
// so we inline it at build time.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@basehalf/core'] })],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
