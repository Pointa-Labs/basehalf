import { describe, expect, it } from 'vitest';
import type { SettingsChannel } from '../src/platform/configuration/browser/settingsChannel.js';
import { createSettingsService } from '../src/platform/configuration/browser/settingsService.js';

describe('settingsService', () => {
  it('maps settings operations to the settings channel', async () => {
    const calls: Array<{ name: string; args?: unknown }> = [];
    const inspect = {
      key: 'editor.readingMode',
      scope: 'workspace',
      type: 'boolean',
      defaultValue: false,
      value: true,
    };
    const channel: SettingsChannel = {
      describe: async () => {
        calls.push({ name: 'describe' });
        return [{ key: 'editor.readingMode' }] as never;
      },
      inspect: async (key) => {
        calls.push({ name: 'inspect', args: { key } });
        return inspect as never;
      },
      get: async (key) => {
        calls.push({ name: 'get', args: { key } });
        return true;
      },
      setGlobal: async (key, value) => {
        calls.push({ name: 'setGlobal', args: { key, value } });
        return inspect as never;
      },
      setWorkspace: async (key, value) => {
        calls.push({ name: 'setWorkspace', args: { key, value } });
        return inspect as never;
      },
      clearWorkspace: async (key) => {
        calls.push({ name: 'clearWorkspace', args: { key } });
        return inspect as never;
      },
    };
    const service = createSettingsService(channel);

    expect(await service.describe()).toEqual([{ key: 'editor.readingMode' }]);
    expect(await service.inspect('editor.readingMode')).toEqual(inspect);
    expect(await service.get('editor.readingMode')).toBe(true);
    expect(await service.setGlobal('editor.readingMode', true)).toEqual(inspect);
    expect(await service.setWorkspace('editor.readingMode', false)).toEqual(inspect);
    expect(await service.clearWorkspace('editor.readingMode')).toEqual(inspect);

    expect(calls).toEqual([
      { name: 'describe' },
      { name: 'inspect', args: { key: 'editor.readingMode' } },
      { name: 'get', args: { key: 'editor.readingMode' } },
      { name: 'setGlobal', args: { key: 'editor.readingMode', value: true } },
      { name: 'setWorkspace', args: { key: 'editor.readingMode', value: false } },
      { name: 'clearWorkspace', args: { key: 'editor.readingMode' } },
    ]);
  });
});
