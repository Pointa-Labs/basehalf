import type {
  SettingDescriptor,
  SettingInspect,
} from '../../../../platform/configuration/common/configuration.js';

export type SettingsAppSection = 'General' | 'About';
export type SettingOverrideMode = 'default' | 'on' | 'off';

export interface SettingsDescriptorGroup {
  readonly label: string;
  readonly descriptors: readonly SettingDescriptor[];
}

export interface BooleanSettingViewModel {
  readonly globalOn: boolean;
  readonly override: SettingOverrideMode;
  readonly effective: boolean;
  readonly canOverride: boolean;
}

export const GITHUB_ACCOUNT_SEARCH_FIELDS = [
  'GitHub',
  'pull requests',
  'reviews',
  'account',
  'sign in',
  'token',
  'personal access token',
  'PAT',
] as const;

interface SettingsTocEntry {
  readonly label: string;
  readonly patterns: readonly RegExp[];
}

const SETTINGS_TOC: readonly SettingsTocEntry[] = [
  { label: 'Editor', patterns: [/^editor\./] },
  { label: 'Window', patterns: [/^window\./] },
  { label: 'GitHub', patterns: [/^github(?:\.|$)/] },
];

export function matchesSettingQuery(query: string, fields: readonly string[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = fields.join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function settingsSectionLabelForDescriptor(descriptor: SettingDescriptor): string {
  const match = SETTINGS_TOC.find((entry) =>
    entry.patterns.some((pattern) => pattern.test(descriptor.key)),
  );
  return match?.label ?? 'Extensions';
}

export function settingDescriptorMatchesQuery(
  descriptor: SettingDescriptor,
  query: string,
): boolean {
  return matchesSettingQuery(query, [descriptor.label, descriptor.description, descriptor.key]);
}

export function groupSettingDescriptors(
  descriptors: readonly SettingDescriptor[],
  query = '',
): readonly SettingsDescriptorGroup[] {
  const groups = new Map<string, SettingDescriptor[]>();
  for (const descriptor of descriptors) {
    if (!settingDescriptorMatchesQuery(descriptor, query)) continue;
    const label = settingsSectionLabelForDescriptor(descriptor);
    groups.set(label, [...(groups.get(label) ?? []), descriptor]);
  }
  return [...groups].map(([label, groupedDescriptors]) => ({
    label,
    descriptors: groupedDescriptors,
  }));
}

export function booleanSettingViewModel(
  descriptor: SettingDescriptor,
  inspect: SettingInspect | null,
): BooleanSettingViewModel {
  const defaultOn = descriptor.default === true;
  const globalOn = inspect ? (inspect.globalValue ?? inspect.defaultValue) === true : defaultOn;
  const override: SettingOverrideMode =
    inspect?.workspaceValue === undefined ? 'default' : inspect.workspaceValue ? 'on' : 'off';
  return {
    globalOn,
    override,
    effective: inspect ? inspect.value === true : defaultOn,
    canOverride: descriptor.scope === 'workspace',
  };
}
