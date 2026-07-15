import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main.js';
import { scaffoldPlugin } from '../src/scaffold.js';

const temporary: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('plugin package command', () => {
  it('creates the exact local VSIX without publishing it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-package-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
      fileExtension: 'storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await run(['validate', directory]);
    await run(['package', directory, '--out', output]);

    expect((await stat(output)).size).toBeGreaterThan(100);
    expect((await readFile(output)).subarray(0, 2).toString('utf8')).toBe('PK');
    expect(log).toHaveBeenCalledWith('Validated studio.storyboard@0.1.0.');
    expect(log).toHaveBeenCalledWith('Packaged studio.storyboard@0.1.0.');
  });
});
