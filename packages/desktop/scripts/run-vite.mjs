import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

// Create a copy of the environment and completely delete the problematic key.
// This prevents Windows from seeing an empty string `""` (which C++ getenv treats as truthy)
// and prevents Mac/Linux from inheriting any globally set value.
const env = { ...process.env };
// biome-ignore lint/performance/noDelete: this is a startup script, performance is not critical here
delete env.ELECTRON_RUN_AS_NODE;

// Resolving the local CLI javascript file directly ensures we use the deterministic
// workspace version instead of relying on `npx`'s external fetching logic.
// We must resolve `package.json` first because `bin/electron-vite.js` is not an exported subpath in Node.
const require = createRequire(import.meta.url);
const pkgPath = require.resolve('electron-vite/package.json');
const pkg = require(pkgPath);
const binSubpath = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['electron-vite'];
const viteBin = path.resolve(path.dirname(pkgPath), binSubpath);

// Spawn via `process.execPath` (the current Node binary) to run the CLI script directly.
// This bypasses the OS's `.cmd`/`.bat` shims entirely, allowing us to drop `shell: true`
// without triggering Node's CVE-2024-27980 `EINVAL` spawn guard on Windows.
const args = [viteBin, ...process.argv.slice(2)];

const result = spawnSync(process.execPath, args, {
  env,
  stdio: 'inherit',
});

// Explicitly log any execution/spawning errors so failures aren't silent
if (result.error) {
  console.error('[run-vite] Error launching electron-vite:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
