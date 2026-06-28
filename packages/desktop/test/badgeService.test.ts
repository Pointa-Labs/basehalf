import { describe, expect, it } from 'vitest';
import type { BadgeChannel } from '../src/workbench/services/mirror/browser/badgeChannel.js';
import { createBadgeService } from '../src/workbench/services/mirror/browser/badgeService.js';

describe('badgeService', () => {
  it('maps badge operations to the badge channel contract', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const badge = { path: 'a.md', kind: 'file', references: [] };
    const service = createBadgeService({
      get: async (args) => {
        calls.push({ name: 'get', args });
        return badge;
      },
      set: async (args) => {
        calls.push({ name: 'set', args });
        return { ...badge, description: 'note' };
      },
      list: async (args) => {
        calls.push({ name: 'list', args });
        return { badges: [badge] };
      },
      addRef: async (args) => {
        calls.push({ name: 'addRef', args });
        return { ...badge, references: ['b.md'] };
      },
      removeRef: async (args) => {
        calls.push({ name: 'removeRef', args });
        return badge;
      },
      pruneDangling: async () => {
        calls.push({ name: 'pruneDangling' });
        return { orphaned: ['missing.md'] };
      },
      revision: async () => {
        calls.push({ name: 'revision' });
        return { count: 1, maxMtimeMs: 2 };
      },
    } as BadgeChannel);

    expect(await service.get('a.md', 'file')).toMatchObject({ path: 'a.md' });
    expect(await service.set('a.md', { kind: 'file', description: 'note' })).toMatchObject({
      description: 'note',
    });
    expect(await service.list({ query: 'a' })).toEqual([badge]);
    expect(await service.addReference('a.md', 'b.md')).toMatchObject({ references: ['b.md'] });
    expect(await service.removeReference('a.md', 'b.md', 'folder')).toEqual(badge);
    expect(await service.pruneDangling()).toEqual({ orphaned: ['missing.md'] });
    expect(await service.revision()).toEqual({ count: 1, maxMtimeMs: 2 });

    expect(calls).toEqual([
      { name: 'get', args: { file: 'a.md', kind: 'file' } },
      { name: 'set', args: { file: 'a.md', patch: { kind: 'file', description: 'note' } } },
      { name: 'list', args: { query: 'a' } },
      { name: 'addRef', args: { file: 'a.md', to: 'b.md' } },
      { name: 'removeRef', args: { file: 'a.md', to: 'b.md', kind: 'folder' } },
      { name: 'pruneDangling' },
      { name: 'revision' },
    ]);
  });

  it('omits optional fields when callers leave them out', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const badge = { path: 'a.md', kind: 'file', references: [] };
    const service = createBadgeService({
      get: async (args) => {
        calls.push({ name: 'get', args });
        return badge;
      },
      set: async (args) => {
        calls.push({ name: 'set', args });
        return badge;
      },
      list: async (args) => {
        calls.push({ name: 'list', args });
        return { badges: [] };
      },
      addRef: async (args) => {
        calls.push({ name: 'addRef', args });
        return badge;
      },
      removeRef: async (args) => {
        calls.push({ name: 'removeRef', args });
        return badge;
      },
    } as BadgeChannel);

    await service.get('a.md');
    await service.set('a.md');
    await service.list();
    await service.addReference('a.md', 'b.md');
    await service.removeReference('a.md', 'b.md');

    expect(calls).toEqual([
      { name: 'get', args: { file: 'a.md' } },
      { name: 'set', args: { file: 'a.md' } },
      { name: 'list', args: {} },
      { name: 'addRef', args: { file: 'a.md', to: 'b.md' } },
      { name: 'removeRef', args: { file: 'a.md', to: 'b.md' } },
    ]);
  });
});
