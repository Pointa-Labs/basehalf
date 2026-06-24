import { describe, expect, it } from 'vitest';
import { createCore } from '../src/index.js';
import type { SettingInspect } from '../src/modules/settings/types.js';
import { boundCore } from './helpers/bound-core.js';
import { mockFs } from './helpers/mock-fs.js';

/**
 * Settings = the registry-driven, two-layer (global default + per-workspace
 * override) preference store in `settings.json`. The one registered setting is
 * `editor.readingMode` (scope: workspace, default: false), which these tests
 * use to exercise the generic layering / scope / persistence machinery.
 */

const KEY = 'editor.readingMode';

function seed() {
  const { fs, files } = mockFs();
  const raw = createCore({ fs, configDir: '/cfg' });
  const core = boundCore(raw, '/work');
  return { fs, files, core, raw };
}

describe('settings.describe', () => {
  it('returns the registered descriptors', async () => {
    const { core } = seed();
    const descriptors = (await core.run('settings.describe', {})) as Array<{
      key: string;
      scope: string;
      default: unknown;
    }>;
    const reading = descriptors.find((d) => d.key === KEY);
    expect(reading).toBeDefined();
    expect(reading?.scope).toBe('workspace');
    expect(reading?.default).toBe(false);
  });
});

describe('settings two-layer resolution', () => {
  it('defaults when nothing is set', async () => {
    const { core } = seed();
    const got = (await core.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.value).toBe(false);
    expect(got.defaultValue).toBe(false);
    expect(got.globalValue).toBeUndefined();
    expect(got.workspaceValue).toBeUndefined();
    expect(await core.run('settings.get', { key: KEY })).toBe(false);
  });

  it('global value overrides default', async () => {
    const { core } = seed();
    await core.run('settings.setGlobal', { key: KEY, value: true });
    const got = (await core.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.globalValue).toBe(true);
    expect(got.workspaceValue).toBeUndefined();
    expect(got.value).toBe(true);
  });

  it('workspace override beats the global default', async () => {
    const { core } = seed();
    await core.run('settings.setGlobal', { key: KEY, value: true });
    await core.run('settings.setWorkspace', { key: KEY, value: false });
    const got = (await core.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.globalValue).toBe(true);
    expect(got.workspaceValue).toBe(false);
    expect(got.value).toBe(false); // override wins
  });

  it('clearWorkspace reverts to the global default and prunes the entry', async () => {
    const { core, fs } = seed();
    await core.run('settings.setGlobal', { key: KEY, value: true });
    await core.run('settings.setWorkspace', { key: KEY, value: false });
    const cleared = (await core.run('settings.clearWorkspace', { key: KEY })) as SettingInspect;
    expect(cleared.workspaceValue).toBeUndefined();
    expect(cleared.value).toBe(true); // back to global

    // Sparse: the now-empty workspace entry is pruned from disk.
    const onDisk = JSON.parse((await fs.readFile('/cfg/settings.json')) ?? '{}');
    expect(onDisk.workspaces).toEqual({});
    expect(onDisk.global).toEqual({ [KEY]: true });
  });

  it('persists across a fresh core (re-read from disk)', async () => {
    const { core, fs } = seed();
    await core.run('settings.setGlobal', { key: KEY, value: true });
    await core.run('settings.setWorkspace', { key: KEY, value: false });

    const core2 = boundCore(createCore({ fs, configDir: '/cfg' }), '/work');
    const got = (await core2.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.globalValue).toBe(true);
    expect(got.workspaceValue).toBe(false);
    expect(got.value).toBe(false);
  });
});

describe('settings workspace identity', () => {
  it('keys the override by path case-insensitively', async () => {
    const { raw, fs } = seed();
    await raw.run('settings.setWorkspace', { key: KEY, value: true }, { workspaceRoot: '/Work' });
    // A differently-cased path is the SAME workspace.
    const got = (await raw.run(
      'settings.inspect',
      { key: KEY },
      {
        workspaceRoot: '/work',
      },
    )) as SettingInspect;
    expect(got.workspaceValue).toBe(true);

    // A genuinely different workspace does not see it.
    const other = (await raw.run(
      'settings.inspect',
      { key: KEY },
      {
        workspaceRoot: '/elsewhere',
      },
    )) as SettingInspect;
    expect(other.workspaceValue).toBeUndefined();
    void fs;
  });

  it('inspect tolerates no bound workspace (global + default only)', async () => {
    const { raw } = seed();
    await raw.run('settings.setGlobal', { key: KEY, value: true });
    const got = (await raw.run(
      'settings.inspect',
      { key: KEY },
      {
        workspaceRoot: null,
      },
    )) as SettingInspect;
    expect(got.workspaceValue).toBeUndefined();
    expect(got.value).toBe(true);
  });
});

describe('settings validation', () => {
  it('rejects an unknown key', async () => {
    const { core } = seed();
    await expect(core.run('settings.get', { key: 'no.such.setting' })).rejects.toThrow(
      /Unknown setting/,
    );
  });

  it('rejects a value of the wrong type', async () => {
    const { core } = seed();
    await expect(
      core.run('settings.setGlobal', { key: KEY, value: 'yes' as unknown as boolean }),
    ).rejects.toThrow(/expects a boolean/);
  });

  it('requires a bound workspace for a per-workspace write', async () => {
    const { raw } = seed();
    await expect(
      raw.run('settings.setWorkspace', { key: KEY, value: true }, { workspaceRoot: null }),
    ).rejects.toThrow();
  });

  it('ignores a corrupt stored value (falls through to the next layer)', async () => {
    const { core, fs } = seed();
    // Hand-write a garbage value into the global layer.
    await fs.writeFile(
      '/cfg/settings.json',
      JSON.stringify({ version: 1, global: { [KEY]: 'garbage' }, workspaces: {} }),
    );
    const got = (await core.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.globalValue).toBeUndefined(); // garbage discarded
    expect(got.value).toBe(false); // default
  });

  it('tolerates a corrupt settings.json (falls back to defaults)', async () => {
    const { core, fs } = seed();
    await fs.writeFile('/cfg/settings.json', '{ this is not json');
    expect(await core.run('settings.get', { key: KEY })).toBe(false);
  });
});

describe('settings durability', () => {
  it('preserves unknown / forward-version keys on a round-trip write', async () => {
    const { core, fs } = seed();
    await fs.writeFile(
      '/cfg/settings.json',
      JSON.stringify({
        version: 1,
        global: { 'future.flag': true },
        workspaces: { '/work': { 'future.ws': false } },
      }),
    );
    await core.run('settings.setGlobal', { key: KEY, value: true });
    const onDisk = JSON.parse((await fs.readFile('/cfg/settings.json')) ?? '{}');
    expect(onDisk.global['future.flag']).toBe(true); // a newer build's setting survives
    expect(onDisk.global[KEY]).toBe(true); // our write landed
    expect(onDisk.workspaces['/work']['future.ws']).toBe(false); // unknown ws key survives
  });

  it('serializes concurrent global + workspace writes without losing either', async () => {
    const { core } = seed();
    await Promise.all([
      core.run('settings.setGlobal', { key: KEY, value: true }),
      core.run('settings.setWorkspace', { key: KEY, value: false }),
    ]);
    const got = (await core.run('settings.inspect', { key: KEY })) as SettingInspect;
    expect(got.globalValue).toBe(true); // the global write survived
    expect(got.workspaceValue).toBe(false); // the workspace write survived (no lost update)
    expect(got.value).toBe(false);
  });

  it('setGlobal returns the effective value when a workspace override shadows it', async () => {
    const { core } = seed();
    await core.run('settings.setWorkspace', { key: KEY, value: false });
    const res = (await core.run('settings.setGlobal', { key: KEY, value: true })) as SettingInspect;
    expect(res.globalValue).toBe(true); // global layer updated
    expect(res.workspaceValue).toBe(false); // override still present
    expect(res.value).toBe(false); // effective = override wins, not the just-set global
  });
});
