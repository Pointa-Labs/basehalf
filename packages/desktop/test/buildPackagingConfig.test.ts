import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = join(__dirname, '..', '..', '..');
const desktopRoot = join(__dirname, '..');

describe('build and packaging config', () => {
  it('keeps dependency build-script approvals explicit', () => {
    const raw = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
    const workspace = parse(raw) as {
      allowBuilds?: unknown;
      onlyBuiltDependencies?: unknown;
    };

    expect(raw).not.toContain('set this to true or false');
    expect(workspace.allowBuilds).toEqual({
      '@biomejs/biome': true,
      electron: true,
      esbuild: true,
    });
    expect(workspace.onlyBuiltDependencies).toEqual(['@biomejs/biome', 'electron', 'esbuild']);
  });

  it('keeps externalized main-process runtime deps packageable', () => {
    const electronViteConfig = readFileSync(join(desktopRoot, 'electron.vite.config.ts'), 'utf8');
    const electronBuilder = parse(
      readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8'),
    ) as { files?: string[] };
    const pkg = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(electronViteConfig).toContain('externalizeDepsPlugin()');
    for (const dep of ['@lydell/node-pty', 'chokidar', 'yaml']) {
      expect(pkg.dependencies).toHaveProperty(dep);
      expect(pkg.devDependencies ?? {}).not.toHaveProperty(dep);
    }
    expect(electronBuilder.files).toContain('out/**');
    expect(electronBuilder.files?.some((pattern) => pattern.includes('node_modules'))).toBe(false);
  });
});
