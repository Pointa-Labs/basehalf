import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateBaseHalfPluginManifest } from '@basehalf/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldPlugin } from '../src/scaffold.js';

const temporary: string[] = [];
const execFileAsync = promisify(execFile);
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('plugin scaffold', () => {
  it('creates a valid fixed-shell plugin project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-scaffold-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
      fileExtension: 'storyboard',
    });
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(() => validateBaseHalfPluginManifest(manifest)).not.toThrow();
    expect(manifest.contributes.viewsContainers).toBeUndefined();
    expect(manifest.repository.url).toBe('https://github.com/studio/storyboard');
    expect(await readFile(path.join(directory, 'src/extension.ts'), 'utf8')).toContain(
      'vscode.basehalf.registerCardProjectionProvider',
    );
    expect(await readFile(path.join(directory, 'src/extension.ts'), 'utf8')).toContain(
      "import type {} from '@basehalf/plugin-sdk/vscode'",
    );
    expect(manifest.scripts.package).toBe('npm run compile && bh-plugin package .');
    expect(manifest.scripts.publish).toBe('npm run compile && bh-plugin publish .');
    expect(
      JSON.parse(await readFile(path.join(directory, '.vscode/launch.json'), 'utf8'))
        .configurations[0],
    ).toMatchObject({
      name: 'Run BaseHalf Plugin',
      type: 'extensionHost',
      runtimeExecutable: '${execPath}',
      preLaunchTask: 'npm: compile',
    });
    expect(await readFile(path.join(directory, 'tsconfig.json'), 'utf8')).toContain('strict');
    expect(await readFile(path.join(directory, '.vscodeignore'), 'utf8')).toContain('*.vsix');
  });

  it('typechecks the generated project against the public SDK exports', async () => {
    const root = await mkdtemp(path.join(packageDirectory, '.tmp-scaffold-typecheck-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
      fileExtension: 'storyboard',
    });

    await expect(
      execFileAsync(process.execPath, [
        path.join(packageDirectory, 'node_modules/typescript/bin/tsc'),
        '--project',
        path.join(directory, 'tsconfig.json'),
        '--pretty',
        'false',
      ]),
    ).resolves.toMatchObject({ stderr: '' });
  });

  it('rejects identities that cannot be registered by the publishing service', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-scaffold-invalid-'));
    temporary.push(root);
    await expect(
      scaffoldPlugin({
        directory: path.join(root, 'plugin'),
        publisher: 'a'.repeat(51),
        name: 'storyboard',
        displayName: 'Storyboard',
        repository: 'https://github.com/studio/storyboard',
        fileExtension: 'storyboard',
      }),
    ).rejects.toThrow('3-50');
  });
});
