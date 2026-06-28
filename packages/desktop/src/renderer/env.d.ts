/// <reference types="vite/client" />

import type { BaseHalfSandboxApi } from '../code/electron-sandbox/sandboxApi.js';

declare global {
  interface Window {
    bh: BaseHalfSandboxApi;
  }
}
