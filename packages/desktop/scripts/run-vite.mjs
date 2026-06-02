import { spawnSync } from 'node:child_process';

// Create a copy of the environment and completely delete the problematic key.
// This prevents Windows from seeing an empty string `""` (which C++ getenv treats as truthy)
// and prevents Mac/Linux from inheriting any globally set value.
const env = { ...process.env };
// biome-ignore lint/performance/noDelete: this is a startup script, performance is not critical here
delete env.ELECTRON_RUN_AS_NODE;

// Spawn electron-vite with the cleanly scrubbed environment.
// Using 'npx' with { shell: true } ensures cross-platform compatibility
// and avoids the Node 20.12+/22+ spawn guard (CVE-2024-27980) that throws EINVAL.
const args = ['electron-vite', ...process.argv.slice(2)];

const result = spawnSync('npx', args, {
  env,
  stdio: 'inherit',
  shell: true,
});

// Explicitly log any execution/spawning errors so failures aren't silent
if (result.error) {
  console.error('[run-vite] Error launching electron-vite:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
