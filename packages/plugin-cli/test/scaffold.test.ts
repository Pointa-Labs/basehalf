import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateBaseHalfPluginManifest } from '@basehalf/plugin-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffoldPlugin } from '../src/scaffold.js';

const temporary: string[] = [];

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
      fileExtension: 'storyboard',
    });
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(() => validateBaseHalfPluginManifest(manifest)).not.toThrow();
    expect(manifest.contributes.viewsContainers).toBeUndefined();
    expect(await readFile(path.join(directory, 'src/extension.ts'), 'utf8')).toContain(
      'vscode.basehalf.registerCardProjectionProvider',
    );
  });
});
