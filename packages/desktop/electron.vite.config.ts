import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

// Main and preload emit as CommonJS (.cjs). Electron's `electron` npm package
// is a path-resolver stub; only its runtime CJS module hook returns the real
// API. ESM `import 'electron'` bypasses the hook and gets the binary path (a
// string), which destructures to undefined and crashes at first API call.
// Renderer stays ESM (Vite handles it).
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/code/electron-main/main.ts',
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/code/electron-sandbox/preload.ts',
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react()],
  },
});
