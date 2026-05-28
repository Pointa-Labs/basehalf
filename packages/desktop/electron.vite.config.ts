import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Main and preload are emitted as CommonJS (.cjs) on purpose. Electron's
// `electron` npm package is a path-resolver stub; only its runtime CJS module
// hook returns the real API. ESM `import 'electron'` bypasses the hook and
// receives the binary path (a string), which destructures to undefined and
// crashes at first API call. Renderer stays ESM (Vite handles it).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
