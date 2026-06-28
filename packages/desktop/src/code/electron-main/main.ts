import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BaseHalfMain } from './baseHalfMain.js';

// Source is ESM but emit is CJS (see electron.vite.config.ts). import.meta.url
// is polyfilled by rollup in the CJS output.
const here = dirname(fileURLToPath(import.meta.url));

new BaseHalfMain({ here }).main();
