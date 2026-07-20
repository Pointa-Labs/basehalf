import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  it('keeps the card-projection scaffold available', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-scaffold-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
      kind: 'projection',
      fileExtension: 'story-board',
    });
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(() => validateBaseHalfPluginManifest(manifest)).not.toThrow();
    expect(manifest.contributes.basehalfCardProjections).toEqual([
      {
        id: 'studio.storyboard.project',
        label: 'Storyboard',
        extensions: ['.story-board'],
        order: 100,
        defaultPriority: 100,
      },
    ]);
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
    const developerToolsVersion = JSON.parse(
      await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
    ).version;
    expect(manifest.devDependencies).toMatchObject({
      '@basehalf/plugin-cli': `^${developerToolsVersion}`,
      '@basehalf/plugin-sdk': `^${developerToolsVersion}`,
    });
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
    expect(await readFile(path.join(directory, 'README.md'), 'utf8')).toContain('npm run publish');
    expect(await readFile(path.join(directory, 'CHANGELOG.md'), 'utf8')).toContain(
      'Initial card-detail Projection.',
    );
  });

  it('creates a recipe and template scaffold by default', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-recipe-scaffold-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });

    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(() => validateBaseHalfPluginManifest(manifest)).not.toThrow();
    expect(manifest.contributes.basehalfCardProjections).toBeUndefined();
    expect(manifest.contributes.basehalfCanvasRecipes).toHaveLength(1);
    expect(manifest.contributes.basehalfCanvasRecipes[0].outputs[0].kind).toBe('file');
    expect(manifest.contributes.basehalfCanvasTemplates).toEqual([
      expect.objectContaining({
        id: 'studio.storyboard.starter',
        resource: 'templates/starter.json',
      }),
    ]);
    const source = await readFile(path.join(directory, 'src/extension.ts'), 'utf8');
    expect(source).toContain('vscode.basehalf.registerCanvasRecipeExecutor');
    expect(source).not.toContain('registerCardProjectionProvider');
    const inputStat = source.indexOf('vscode.workspace.fs.stat(resource)');
    const inputRead = source.indexOf('vscode.workspace.fs.readFile(resource)');
    expect(inputStat).toBeGreaterThan(-1);
    expect(inputRead).toBeGreaterThan(inputStat);
    expect(source).toContain('stat.size > maximumInputBytes');
    expect(source).toContain('bytes.byteLength > maximumInputBytes');
    expect(source).not.toContain('bytes.slice(0, maximumInputBytes)');
    expect(await readFile(path.join(directory, 'CHANGELOG.md'), 'utf8')).toContain(
      'Initial canvas Recipe and starter Template.',
    );
    expect(source).toContain("'basehalf.canvas.createFromTemplate'");

    const template = JSON.parse(
      await readFile(path.join(directory, 'templates/starter.json'), 'utf8'),
    );
    expect(template.nodes[0].recipe).toMatchObject({
      recipeId: 'studio.storyboard.create-document',
      inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }],
    });
    expect(template.nodes[0].kind).toBe('file');
    expect(template.references).toEqual([
      expect.objectContaining({ from: 'brief.md', to: 'result.bhnode' }),
    ]);
  });

  it('typechecks a generated recipe project against the public SDK exports', async () => {
    const root = await mkdtemp(path.join(packageDirectory, '.tmp-scaffold-typecheck-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
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

  it('does not typecheck text or code as executable artifacts', async () => {
    const root = await mkdtemp(path.join(packageDirectory, '.tmp-scaffold-invalid-artifact-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    const sourcePath = path.join(directory, 'src/extension.ts');
    const source = await readFile(sourcePath, 'utf8');
    await writeFile(sourcePath, source.replace("kind: 'file',", "kind: 'text',"), 'utf8');

    await expect(
      execFileAsync(process.execPath, [
        path.join(packageDirectory, 'node_modules/typescript/bin/tsc'),
        '--project',
        path.join(directory, 'tsconfig.json'),
        '--pretty',
        'false',
      ]),
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("not assignable to type 'CanvasNodeKind'"),
    });
  });

  it('rejects a recipe mode combined with a projection file extension', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-scaffold-conflict-'));
    temporary.push(root);
    await expect(
      scaffoldPlugin({
        directory: path.join(root, 'plugin'),
        publisher: 'studio',
        name: 'storyboard',
        displayName: 'Storyboard',
        repository: 'https://github.com/studio/storyboard',
        kind: 'recipe',
        fileExtension: 'storyboard',
      }),
    ).rejects.toThrow('do not use a file extension');
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
