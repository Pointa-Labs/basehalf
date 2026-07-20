import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main.js';
import { scaffoldPlugin } from '../src/scaffold.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ on: vi.fn(), unref: vi.fn() })),
}));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

const temporary: string[] = [];
const originalPlatform = process.platform;

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  spawnMock.mockClear();
  Object.defineProperty(process, 'platform', {
    configurable: true,
    enumerable: true,
    value: originalPlatform,
  });
  Reflect.deleteProperty(process.env, 'BASEHALF_PLUGIN_CONFIG_HOME');
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function apiResponse(data: unknown): Response {
  return new Response(JSON.stringify({ code: '00000', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('plugin init command', () => {
  it('keeps file-extension-only initialization on the projection scaffold', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-init-projection-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await run([
      'init',
      directory,
      '--publisher',
      'studio',
      '--name',
      'storyboard',
      '--display-name',
      'Storyboard',
      '--repository',
      'https://github.com/studio/storyboard',
      '--file-extension',
      'storyboard',
    ]);

    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    expect(manifest.contributes.basehalfCardProjections).toHaveLength(1);
    expect(manifest.contributes.basehalfCanvasRecipes).toBeUndefined();
  });
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

  it('rejects a generated recipe package when its declared template is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-missing-template-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await rm(path.join(directory, 'templates/starter.json'));

    await expect(run(['validate', directory])).rejects.toThrow(
      'Required canvas template is missing: templates/starter.json',
    );
  });

  it('validates and packages the generated recipe and template project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-recipe-package-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard-recipe.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');

    await run(['validate', directory]);
    await run(['package', directory, '--out', output]);

    expect((await stat(output)).size).toBeGreaterThan(100);
  });

  it('rejects malformed template JSON before packaging', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-invalid-template-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(path.join(directory, 'templates/starter.json'), '{ invalid json\n');

    await expect(run(['validate', directory])).rejects.toThrow(
      'Canvas template failed validation: templates/starter.json',
    );
  });

  it('rejects structurally invalid template JSON before packaging', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-invalid-template-shape-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    const templatePath = path.join(directory, 'templates/starter.json');
    const template = JSON.parse(await readFile(templatePath, 'utf8'));
    template.cards[0].path = 'missing.md';
    await writeFile(templatePath, JSON.stringify(template));

    await expect(run(['validate', directory])).rejects.toThrow(
      'does not have a matching file or node',
    );
  });

  it('rejects a structurally valid template that does not satisfy its declared recipe', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-invalid-template-recipe-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    const templatePath = path.join(directory, 'templates/starter.json');
    const template = JSON.parse(await readFile(templatePath, 'utf8'));
    template.nodes[0].recipe.recipeId = 'studio.storyboard.undeclared';
    await writeFile(templatePath, JSON.stringify(template));

    await expect(run(['validate', directory])).rejects.toThrow('uses undeclared recipe');
    await expect(run(['package', directory])).rejects.toThrow('uses undeclared recipe');
  });

  it('rejects a template resource that is not valid UTF-8', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-invalid-template-utf8-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(path.join(directory, 'templates/starter.json'), new Uint8Array([0xff]));

    await expect(run(['validate', directory])).rejects.toThrow(
      'Canvas template failed validation: templates/starter.json',
    );
  });

  it('rejects a VSIX when ignore rules remove its declared template', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-excluded-template-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(path.join(directory, '.vscodeignore'), 'templates/**\n');

    await expect(run(['package', directory, '--out', output])).rejects.toThrow(
      "missing 'extension/templates/starter.json'",
    );
    await expect(stat(output)).rejects.toThrow();
  });

  it('rejects a VSIX when ignore rules remove its declared entry point', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-excluded-main-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(path.join(directory, '.vscodeignore'), 'out/**\n');

    await expect(run(['package', directory, '--out', output])).rejects.toThrow(
      'extension/out/extension.js',
    );
    await expect(stat(output)).rejects.toThrow();
  });

  it('revalidates the manifest produced by the package lifecycle', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-packaged-manifest-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(
      path.join(directory, 'inject-manifest.cjs'),
      "const fs = require('node:fs'); const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8')); manifest.extensionDependencies = ['outside.extension']; fs.writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\\n');\n",
    );
    const manifestPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.scripts = { ...manifest.scripts, 'vscode:prepublish': 'node inject-manifest.cjs' };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(run(['package', directory, '--out', output])).rejects.toThrow(
      'cannot declare extensionDependencies',
    );
    await expect(stat(output)).rejects.toThrow();
  });

  it('revalidates the template bytes produced by the package lifecycle', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-packaged-template-'));
    temporary.push(root);
    const directory = path.join(root, 'storyboard');
    const output = path.join(root, 'storyboard.vsix');
    await scaffoldPlugin({
      directory,
      publisher: 'studio',
      name: 'storyboard',
      displayName: 'Storyboard',
      repository: 'https://github.com/studio/storyboard',
    });
    await mkdir(path.join(directory, 'out'), { recursive: true });
    await writeFile(path.join(directory, 'out/extension.js'), 'exports.activate = () => {};\n');
    await writeFile(
      path.join(directory, 'inject-template.cjs'),
      "const fs = require('node:fs'); const file = 'templates/starter.json'; const template = JSON.parse(fs.readFileSync(file, 'utf8')); template.nodes[0].recipe.recipeId = 'studio.storyboard.undeclared'; fs.writeFileSync(file, JSON.stringify(template) + '\\n');\n",
    );
    const manifestPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.scripts = { ...manifest.scripts, 'vscode:prepublish': 'node inject-template.cjs' };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    await expect(run(['package', directory, '--out', output])).rejects.toThrow(
      'Packaged canvas template failed validation: templates/starter.json',
    );
    await expect(stat(output)).rejects.toThrow();
  });
});

describe('plugin publishing login', () => {
  it('rejects a verification link outside the publishing server origin', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      apiResponse({
        device_code: 'opaque-device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://unexpected.example/device',
        expires_in: 60,
        interval: 1,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(run(['login', '--server', 'http://localhost:4100'])).rejects.toThrow(
      'Publishing verification URL must use the publishing server origin.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('opens Windows verification links without a command interpreter', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-windows-login-'));
    temporary.push(root);
    process.env.BASEHALF_PLUGIN_CONFIG_HOME = root;
    Object.defineProperty(process, 'platform', {
      configurable: true,
      enumerable: true,
      value: 'win32',
    });
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        apiResponse({
          device_code: 'opaque-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'http://localhost:4100/device?next=one&value=two|three^four',
          expires_in: 60,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          status: 'approved',
          access_token: 'bhp_test-token',
          expires_at: '2099-01-01T00:00:00.000Z',
          publisher_id: '12',
          scopes: ['publisher:read', 'plugin:write', 'submission:write'],
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({ publisher: { slug: 'studio', display_name: 'Studio' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = run(['login', '--server', 'http://localhost:4100']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1_000);
    await login;

    const expectedUrl = new URL('http://localhost:4100/device?next=one&value=two|three^four');
    expectedUrl.searchParams.set('user_code', 'ABCD-EFGH');
    expect(spawnMock).toHaveBeenCalledWith('explorer.exe', [expectedUrl.href], {
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
  });

  it('opens a browser verification link and names the code clearly', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-login-'));
    temporary.push(root);
    process.env.BASEHALF_PLUGIN_CONFIG_HOME = root;
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        apiResponse({
          device_code: 'opaque-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'http://localhost:4100/device',
          expires_in: 60,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          status: 'approved',
          access_token: 'bhp_test-token',
          expires_at: '2099-01-01T00:00:00.000Z',
          publisher_id: '12',
          scopes: ['publisher:read', 'plugin:write', 'submission:write'],
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({ publisher: { slug: 'studio', display_name: 'Studio' } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const login = run([
      'login',
      '--server',
      'http://localhost:4100',
      '--client-name',
      'studio-mac',
      '--publisher',
      'studio',
    ]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1_000);
    await login;

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:4100/plugin-service/api/v1/device/authorizations',
      expect.objectContaining({
        body: JSON.stringify({
          client_name: 'Basehalf CLI on studio-mac',
          scopes: ['publisher:read', 'plugin:write', 'submission:write'],
          publisher_slug: 'studio',
        }),
      }),
    );
    expect(log).toHaveBeenCalledWith('Opening BaseHalf to confirm plugin publishing.');
    expect(log).toHaveBeenCalledWith('If prompted, verify this code: ABCD-EFGH');
    expect(log).toHaveBeenCalledWith('http://localhost:4100/device?user_code=ABCD-EFGH');
    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['http://localhost:4100/device?user_code=ABCD-EFGH']),
      expect.objectContaining({ detached: true }),
    );
    expect(log).toHaveBeenCalledWith('Publishing connected to Studio.');
    const credentials = JSON.parse(
      await readFile(path.join(root, 'plugin-publisher.json'), 'utf8'),
    );
    expect(credentials.servers['http://localhost:4100'].portalOrigin).toBe('http://localhost:4100');
  });

  it('starts browser authorization automatically on the first publish', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-first-publish-'));
    temporary.push(root);
    process.env.BASEHALF_PLUGIN_CONFIG_HOME = path.join(root, 'credentials');
    const directory = path.join(root, 'storyboard');
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

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        apiResponse({
          device_code: 'opaque-device-code',
          user_code: 'ABCD-EFGH',
          verification_uri: 'http://localhost:4100/device',
          expires_in: 60,
          interval: 1,
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          status: 'approved',
          access_token: 'bhp_test-token',
          expires_at: '2099-01-01T00:00:00.000Z',
          publisher_id: '12',
          scopes: ['publisher:read', 'plugin:write', 'submission:write'],
        }),
      )
      .mockResolvedValueOnce(apiResponse({ publisher: { slug: 'studio', display_name: 'Studio' } }))
      .mockResolvedValueOnce(apiResponse([]))
      .mockResolvedValueOnce(
        apiResponse({
          id: '20',
          extension_id: 'studio.storyboard',
          name: 'storyboard',
          display_name: 'Storyboard',
          latest_version: null,
        }),
      )
      .mockResolvedValueOnce(
        apiResponse({
          submission_id: '30',
          upload_url: 'https://upload.example/storyboard.vsix',
          method: 'PUT',
          headers: {},
          expires_at: '2099-01-01T00:00:00.000Z',
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(apiResponse({ id: '30', status: 'READY_FOR_REVIEW' }));
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const publishing = run(['publish', directory, '--server', 'http://localhost:4100']);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await publishing;

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      publisher_slug: 'studio',
    });
    expect(log).toHaveBeenCalledWith('Publishing connected to Studio.');
    expect(log).toHaveBeenCalledWith('Submitted studio.storyboard@0.1.0 (READY_FOR_REVIEW).');
    expect(log).toHaveBeenCalledWith('http://localhost:4100/publish?plugin=studio.storyboard');
  }, 10_000);
});
