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

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

describe('plugin publishing login', () => {
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
