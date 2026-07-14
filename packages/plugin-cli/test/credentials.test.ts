import { mkdtemp, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCredentials, removeSession, saveSession, sessionFor } from '../src/credentials.js';

const temporary: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('publisher credentials', () => {
  it('writes atomically with owner-only permissions and removes one server', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'bh-plugin-credentials-'));
    temporary.push(directory);
    const file = path.join(directory, 'credentials.json');
    await saveSession(
      'https://basehalf.com',
      {
        accessToken: 'secret',
        publisherId: '1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scopes: ['publisher:read'],
      },
      file,
    );
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await sessionFor('https://basehalf.com', file)).accessToken).toBe('secret');
    expect(await readFile(file, 'utf8')).not.toContain('.tmp');
    await removeSession('https://basehalf.com', file);
    expect((await readCredentials(file)).servers).toEqual({});
  });
});
