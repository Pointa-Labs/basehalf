import type {
  SettingDescriptor,
  SettingInspect,
  SettingValue,
  SettingsDescribeResult,
  SettingsGetResult,
} from '../common/configuration.js';
import {
  SETTINGS,
  assertOverridable,
  descriptorOrThrow,
  isValidValue,
} from '../common/configurationRegistry.js';
import { type SettingsFile, readSettings, writeSettings } from './settingsStore.js';

export interface SettingsRegistryProvider {
  describe(workspaceRoot: string | null): Promise<SettingsDescribeResult>;
  inspect(workspaceRoot: string | null, key: string): Promise<SettingInspect>;
  get(workspaceRoot: string | null, key: string): Promise<SettingsGetResult>;
  setGlobal(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect>;
  setWorkspace(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect>;
  clearWorkspace(workspaceRoot: string | null, key: string): Promise<SettingInspect>;
}

export interface FileSettingsRegistryProviderOptions {
  readonly configDir: string;
}

// Serialize every read-modify-write on the single settings.json per config dir.
const withSettingsLock = createKeyedMutex();

/**
 * Main-process settings registry backed by the machine-local settings.json.
 * This is the BaseHalf-scale analogue of VS Code's configuration registry plus
 * user/workspace configuration service: IPC talks to SettingsMainService, which
 * delegates registry-layer reads/writes to this provider.
 */
export class FileSettingsRegistryProvider implements SettingsRegistryProvider {
  constructor(private readonly opts: FileSettingsRegistryProviderOptions) {}

  async describe(_workspaceRoot: string | null): Promise<SettingsDescribeResult> {
    return SETTINGS;
  }

  async inspect(workspaceRoot: string | null, key: string): Promise<SettingInspect> {
    const descriptor = descriptorOrThrow(key);
    const file = await readSettings(this.opts.configDir);
    return inspectOne(descriptor, file, workspaceRoot);
  }

  async get(workspaceRoot: string | null, key: string): Promise<SettingsGetResult> {
    const descriptor = descriptorOrThrow(key);
    const file = await readSettings(this.opts.configDir);
    return inspectOne(descriptor, file, workspaceRoot).value;
  }

  async setGlobal(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect> {
    const descriptor = descriptorOrThrow(key);
    assertValidValue(descriptor, value);
    return withSettingsLock(this.opts.configDir, async () => {
      const file = await readSettings(this.opts.configDir);
      const next: SettingsFile = {
        version: 1,
        global: { ...file.global, [descriptor.key]: value },
        workspaces: file.workspaces,
      };
      await writeSettings(this.opts.configDir, next);
      return inspectOne(descriptor, next, workspaceRoot);
    });
  }

  async setWorkspace(
    workspaceRoot: string | null,
    key: string,
    value: SettingValue,
  ): Promise<SettingInspect> {
    const descriptor = descriptorOrThrow(key);
    assertOverridable(descriptor);
    assertValidValue(descriptor, value);
    const root = requireWorkspaceRoot(workspaceRoot);
    const keyForWorkspace = workspaceKey(root);
    return withSettingsLock(this.opts.configDir, async () => {
      const file = await readSettings(this.opts.configDir);
      const next: SettingsFile = {
        version: 1,
        global: file.global,
        workspaces: {
          ...file.workspaces,
          [keyForWorkspace]: {
            ...file.workspaces[keyForWorkspace],
            [descriptor.key]: value,
          },
        },
      };
      await writeSettings(this.opts.configDir, next);
      return inspectOne(descriptor, next, root);
    });
  }

  async clearWorkspace(workspaceRoot: string | null, key: string): Promise<SettingInspect> {
    const descriptor = descriptorOrThrow(key);
    assertOverridable(descriptor);
    const root = requireWorkspaceRoot(workspaceRoot);
    const keyForWorkspace = workspaceKey(root);
    return withSettingsLock(this.opts.configDir, async () => {
      const file = await readSettings(this.opts.configDir);
      const workspaceMap = file.workspaces[keyForWorkspace];
      if (workspaceMap && descriptor.key in workspaceMap) {
        const rest: Record<string, SettingValue> = {};
        for (const [storedKey, storedValue] of Object.entries(workspaceMap)) {
          if (storedKey !== descriptor.key) rest[storedKey] = storedValue;
        }
        const workspaces = { ...file.workspaces };
        if (Object.keys(rest).length === 0) delete workspaces[keyForWorkspace];
        else workspaces[keyForWorkspace] = rest;
        const next: SettingsFile = { version: 1, global: file.global, workspaces };
        await writeSettings(this.opts.configDir, next);
        return inspectOne(descriptor, next, root);
      }
      return inspectOne(descriptor, file, root);
    });
  }
}

function workspaceKey(root: string): string {
  const stripped = root.replace(/\/+$/, '');
  return (stripped === '' ? root : stripped).toLowerCase();
}

function requireWorkspaceRoot(root: string | null): string {
  if (root === null) throw new Error('No workspace bound to this settings operation.');
  return root;
}

function assertValidValue(descriptor: SettingDescriptor, value: SettingValue): void {
  if (!isValidValue(descriptor, value)) {
    throw new Error(`Setting "${descriptor.key}" expects a ${descriptor.type}`);
  }
}

function inspectOne(
  descriptor: SettingDescriptor,
  file: SettingsFile,
  root: string | null,
): SettingInspect {
  const globalRaw = file.global[descriptor.key];
  const globalValue = isValidValue(descriptor, globalRaw) ? globalRaw : undefined;

  let workspaceValue: SettingValue | undefined;
  if (descriptor.scope === 'workspace' && root !== null) {
    const workspaceRaw = file.workspaces[workspaceKey(root)]?.[descriptor.key];
    workspaceValue = isValidValue(descriptor, workspaceRaw) ? workspaceRaw : undefined;
  }

  const value = workspaceValue ?? globalValue ?? descriptor.default;
  return {
    key: descriptor.key,
    scope: descriptor.scope,
    type: descriptor.type,
    defaultValue: descriptor.default,
    ...(globalValue !== undefined && { globalValue }),
    ...(workspaceValue !== undefined && { workspaceValue }),
    value,
  };
}

function createKeyedMutex(): <T>(key: string, op: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>();
  return <T>(key: string, op: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const result = previous.then(op, op);
    chains.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
}
