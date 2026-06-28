import type { SettingDescriptor, SettingValue } from './configuration.js';

/**
 * Declarative setting registry, following VS Code's split between a
 * configuration registry and concrete configuration stores. Adding a setting
 * should normally be one registry entry plus UI copy, not new IPC plumbing.
 */
export const SETTINGS: readonly SettingDescriptor[] = Object.freeze([
  {
    key: 'editor.readingMode',
    scope: 'workspace',
    type: 'boolean',
    default: false,
    label: 'Reading mode',
    description:
      'Highlight keywords and track your place as you read a note — finished paragraphs fade so what is left stands out.',
  },
]);

const BY_KEY = new Map<string, SettingDescriptor>(
  SETTINGS.map((setting) => [setting.key, setting]),
);

export function getDescriptor(key: string): SettingDescriptor | undefined {
  return BY_KEY.get(key);
}

export function isValidValue(descriptor: SettingDescriptor, value: unknown): value is SettingValue {
  switch (descriptor.type) {
    case 'boolean':
      return typeof value === 'boolean';
    default: {
      const _exhaustive: never = descriptor.type;
      return _exhaustive;
    }
  }
}

export class UnknownSetting extends Error {
  override readonly name = 'UnknownSetting';

  constructor(readonly key: string) {
    super(`Unknown setting: ${key}`);
  }
}

export class InvalidSettingValue extends Error {
  override readonly name = 'InvalidSettingValue';
}

export function descriptorOrThrow(key: string): SettingDescriptor {
  const descriptor = getDescriptor(key);
  if (descriptor === undefined) throw new UnknownSetting(key);
  return descriptor;
}

export function assertOverridable(descriptor: SettingDescriptor): void {
  if (descriptor.scope !== 'workspace') {
    throw new InvalidSettingValue(
      `Setting "${descriptor.key}" is global-only and cannot be overridden per workspace`,
    );
  }
}
