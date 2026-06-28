import { describe, expect, it } from 'vitest';
import type {
  SettingDescriptor,
  SettingInspect,
} from '../src/platform/configuration/common/configuration.js';
import {
  booleanSettingViewModel,
  groupSettingDescriptors,
  matchesSettingQuery,
  settingsSectionLabelForDescriptor,
} from '../src/workbench/contrib/preferences/common/preferencesModel.js';

const setting = (key: string, overrides: Partial<SettingDescriptor> = {}): SettingDescriptor => ({
  key,
  scope: 'workspace',
  type: 'boolean',
  default: false,
  label: key,
  description: `${key} description`,
  ...overrides,
});

describe('preferences common model', () => {
  it('matches settings by all query terms across label, description, and key', () => {
    expect(matchesSettingQuery('', ['Editor Reading Mode'])).toBe(true);
    expect(matchesSettingQuery('reading editor', ['Editor Reading Mode'])).toBe(true);
    expect(matchesSettingQuery('reading missing', ['Editor Reading Mode'])).toBe(false);
  });

  it('derives section labels from an explicit VS Code-style TOC pattern table', () => {
    expect(settingsSectionLabelForDescriptor(setting('editor.readingMode'))).toBe('Editor');
    expect(settingsSectionLabelForDescriptor(setting('github'))).toBe('GitHub');
    expect(settingsSectionLabelForDescriptor(setting('unknown.setting'))).toBe('Extensions');
  });

  it('groups filtered descriptors by TOC section while preserving registry order', () => {
    const descriptors = [
      setting('editor.readingMode', { label: 'Reading Mode' }),
      setting('window.zoom', { label: 'Window Zoom' }),
      setting('editor.inlineHints', { label: 'Inline Hints' }),
    ];

    expect(groupSettingDescriptors(descriptors).map((group) => group.label)).toEqual([
      'Editor',
      'Window',
    ]);
    expect(groupSettingDescriptors(descriptors)[0]?.descriptors.map((item) => item.key)).toEqual([
      'editor.readingMode',
      'editor.inlineHints',
    ]);
    expect(groupSettingDescriptors(descriptors, 'zoom')).toEqual([
      {
        label: 'Window',
        descriptors: [descriptors[1]],
      },
    ]);
  });

  it('computes boolean setting render state from descriptor defaults and inspect layers', () => {
    const descriptor = setting('editor.readingMode', { default: false });

    expect(booleanSettingViewModel(descriptor, null)).toEqual({
      globalOn: false,
      override: 'default',
      effective: false,
      canOverride: true,
    });

    const inspect: SettingInspect = {
      key: descriptor.key,
      scope: 'workspace',
      type: 'boolean',
      defaultValue: false,
      globalValue: true,
      workspaceValue: false,
      value: false,
    };
    expect(booleanSettingViewModel(descriptor, inspect)).toEqual({
      globalOn: true,
      override: 'off',
      effective: false,
      canOverride: true,
    });
  });
});
