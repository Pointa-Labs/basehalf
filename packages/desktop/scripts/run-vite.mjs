import { spawnSync } from 'node:child_process';

// Create a copy of the environment and completely delete the problematic key.
// This prevents Windows from seeing an empty string `""` (which C++ getenv treats as truthy) 
// and prevents Mac/Linux from inheriting any globally set value.
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

// Spawn electron-vite with the cleanly scrubbed environment
const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = ['electron-vite', ...process.argv.slice(2)];

const result = spawnSync(cmd, args, { env, stdio: 'inherit' });
process.exit(result.status ?? 1);
